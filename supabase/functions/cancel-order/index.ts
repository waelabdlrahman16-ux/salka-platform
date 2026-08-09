import { withSupabase } from "@supabase/server"
import { fail, isRateLimitError, json } from "../_shared/secure.ts"

const REASONS = new Set([
  "customer_waiting_too_long",
  "customer_price_too_high",
  "customer_payment_problem",
  "customer_ordered_by_mistake",
  "customer_changed_mind",
  "customer_other",
])

type CancelDatabase = {
  public: {
    Tables: Record<string, never>
    Views: Record<string, never>
    Functions: {
      check_rate_limit: {
        Args: { p_bucket: string; p_max: number; p_window: string }
        Returns: undefined
      }
      cancel_order: {
        Args: { p_order_id: number; p_reason?: string; p_token?: string }
        Returns: undefined
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

async function tokenBucket(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
}

const cancel = withSupabase<CancelDatabase>({ auth: "publishable" }, async (req, ctx) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

  const contentLength = Number(req.headers.get("content-length") ?? 0)
  if (contentLength > 2048) return json({ error: "request_too_large" }, 413)

  let body: unknown
  try { body = await req.json() } catch { return json({ error: "invalid_json" }, 400) }
  if (!body || typeof body !== "object") return json({ error: "invalid_request" }, 400)

  const { order_id, token, reason } = body as Record<string, unknown>
  if (!Number.isInteger(order_id) || Number(order_id) <= 0 || Number(order_id) > 2147483647) {
    return json({ error: "invalid_order_id" }, 400)
  }
  if (typeof token !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    return json({ error: "not_authorized" }, 403)
  }
  if (typeof reason !== "string" || !REASONS.has(reason)) {
    return json({ error: "invalid_cancel_reason" }, 400)
  }

  // Circuit breakers stop random-token floods from growing rate_limit_log or
  // consuming unbounded database work. The per-order bucket limits retries but
  // stores only a one-way digest, never the bearer token itself.
  const limits: Array<[string, number, string]> = [
    ["cancel_order_edge_burst", 120, "1 minute"],
    ["cancel_order_edge_daily", 5000, "24 hours"],
    [`cancel_order:${await tokenBucket(token)}`, 6, "10 minutes"],
  ]
  for (const [bucket, max, window] of limits) {
    const { error } = await ctx.supabaseAdmin.rpc("check_rate_limit", {
      p_bucket: bucket,
      p_max: max,
      p_window: window,
    })
    if (error) {
      if (isRateLimitError(error)) return json({ error: "rate_limited" }, 429)
      return fail("cancel-order", "rate_limit_check_failed", 500, error)
    }
  }

  const { error } = await ctx.supabaseAdmin.rpc("cancel_order", {
    p_order_id: Number(order_id),
    p_reason: reason,
    p_token: token,
  })
  if (error) {
    const known = ["order_not_found", "not_authorized", "too_late_to_cancel", "order_closed"]
      .find(code => error.message?.includes(code))
    if (known) {
      const status = known === "order_not_found" ? 404 : known === "not_authorized" ? 403 : 409
      return json({ error: known }, status)
    }
    return fail("cancel-order", "cancel_failed", 500, error)
  }

  return json({ ok: true })
})

export default { fetch: cancel }
