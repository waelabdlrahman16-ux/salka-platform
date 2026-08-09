import { withSupabase } from "@supabase/server"
import { fail, isRateLimitError, json } from "../_shared/secure.ts"

type EditingDatabase = {
  public: {
    Tables: Record<string, never>
    Views: Record<string, never>
    Functions: {
      check_rate_limit: {
        Args: { p_bucket: string; p_max: number; p_window: string }
        Returns: undefined
      }
      append_request_items: {
        Args: { p_token: string; p_items: Array<{ name: string; qty: number }>; p_rate_key: string }
        Returns: Record<string, unknown>
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

async function tokenDigest(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
}

const editOrder = withSupabase<EditingDatabase>({ auth: "publishable" }, async (req, ctx) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

  const contentLength = Number(req.headers.get("content-length") ?? 0)
  if (contentLength > 16384) return json({ error: "request_too_large" }, 413)

  let body: unknown
  try { body = await req.json() } catch { return json({ error: "invalid_json" }, 400) }
  if (!body || typeof body !== "object") return json({ error: "invalid_request" }, 400)

  const { token, items } = body as Record<string, unknown>
  if (typeof token !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    return json({ error: "not_authorized" }, 403)
  }
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    return json({ error: "invalid_item_count" }, 400)
  }
  const validItems = items.every(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false
    const { name, qty } = item as Record<string, unknown>
    return typeof name === "string" && name.trim().length >= 1 && name.trim().length <= 200
      && Number.isInteger(qty) && Number(qty) >= 1 && Number(qty) <= 100
  })
  if (!validItems) return json({ error: "invalid_item" }, 400)

  for (const [bucket, max, window] of [
    ["customer_order_edit_burst", 120, "1 minute"],
    ["customer_order_edit_daily", 5000, "24 hours"],
  ] as const) {
    const { error } = await ctx.supabaseAdmin.rpc("check_rate_limit", {
      p_bucket: bucket,
      p_max: max,
      p_window: window,
    })
    if (error) {
      if (isRateLimitError(error)) return json({ error: "rate_limited" }, 429)
      return fail("customer-order-editing", "rate_limit_check_failed", 500, error)
    }
  }

  const { data, error } = await ctx.supabaseAdmin.rpc("append_request_items", {
    p_token: token,
    p_items: items as Array<{ name: string; qty: number }>,
    p_rate_key: await tokenDigest(token),
  })
  if (error) {
    const known = [
      "order_not_found", "order_closed", "order_not_priced", "wrong_stage", "already_assigned",
      "invalid_items", "invalid_item_count", "invalid_item", "empty_order", "too_many_order_items",
      "invalid_merged_item", "order_edit_rate_limit", "daily_order_edit_limit",
    ].find(code => error.message?.includes(code))
    if (known) {
      const status = known === "order_not_found" ? 404
        : known.startsWith("invalid_") || known === "empty_order" ? 400
        : known === "order_edit_rate_limit" || known === "daily_order_edit_limit" ? 429 : 409
      return json({ error: known }, status)
    }
    return fail("customer-order-editing", "order_edit_failed", 500, error)
  }

  return json({ ok: true, data })
})

export default { fetch: editOrder }
