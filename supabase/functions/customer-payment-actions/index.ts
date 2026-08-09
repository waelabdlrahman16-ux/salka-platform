import { withSupabase } from "@supabase/server"
import { fail, isRateLimitError, json } from "../_shared/secure.ts"

const ACTIONS = new Set(["claim_instapay", "switch_to_cash", "submit_tip"])

type PaymentDatabase = {
  public: {
    Tables: Record<string, never>
    Views: Record<string, never>
    Functions: {
      check_rate_limit: {
        Args: { p_bucket: string; p_max: number; p_window: string }
        Returns: undefined
      }
      mark_instapay_claimed: { Args: { p_token: string }; Returns: undefined }
      switch_to_cash: { Args: { p_token: string }; Returns: Record<string, unknown> }
      submit_tip: { Args: { p_token: string; p_amount: number }; Returns: undefined }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

async function tokenBucket(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
}

const paymentAction = withSupabase<PaymentDatabase>({ auth: "publishable" }, async (req, ctx) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

  const contentLength = Number(req.headers.get("content-length") ?? 0)
  if (contentLength > 2048) return json({ error: "request_too_large" }, 413)

  let body: unknown
  try { body = await req.json() } catch { return json({ error: "invalid_json" }, 400) }
  if (!body || typeof body !== "object") return json({ error: "invalid_request" }, 400)

  const { action, token, amount } = body as Record<string, unknown>
  if (typeof action !== "string" || !ACTIONS.has(action)) return json({ error: "invalid_action" }, 400)
  if (typeof token !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    return json({ error: "not_authorized" }, 403)
  }
  if (action === "submit_tip" && (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 1000)) {
    return json({ error: "invalid_amount" }, 400)
  }

  const digest = await tokenBucket(token)
  const limits: Array<[string, number, string]> = [
    ["customer_payment_action_burst", 120, "1 minute"],
    ["customer_payment_action_daily", 5000, "24 hours"],
    [`customer_payment_action:${action}:${digest}`, 6, "10 minutes"],
  ]
  for (const [bucket, max, window] of limits) {
    const { error } = await ctx.supabaseAdmin.rpc("check_rate_limit", {
      p_bucket: bucket,
      p_max: max,
      p_window: window,
    })
    if (error) {
      if (isRateLimitError(error)) return json({ error: "rate_limited" }, 429)
      return fail("customer-payment-actions", "rate_limit_check_failed", 500, error)
    }
  }

  let data: unknown
  let error: { message?: string } | null = null
  if (action === "claim_instapay") {
    ;({ error } = await ctx.supabaseAdmin.rpc("mark_instapay_claimed", { p_token: token }))
  } else if (action === "switch_to_cash") {
    ;({ data, error } = await ctx.supabaseAdmin.rpc("switch_to_cash", { p_token: token }))
  } else {
    ;({ error } = await ctx.supabaseAdmin.rpc("submit_tip", { p_token: token, p_amount: Number(amount) }))
  }

  if (error) {
    const known = [
      "order_not_awaiting_payment", "order_not_found", "wrong_stage", "already_cash",
      "payment_already_claimed", "already_assigned", "invalid_amount", "order_not_delivered",
      "no_driver_on_this_order", "driver_instapay_unavailable",
    ].find(code => error?.message?.includes(code))
    if (known) {
      const status = known === "order_not_found" ? 404 : known === "invalid_amount" ? 400 : 409
      return json({ error: known }, status)
    }
    return fail("customer-payment-actions", "payment_action_failed", 500, error)
  }

  return json({ ok: true, data: data ?? null })
})

export default { fetch: paymentAction }
