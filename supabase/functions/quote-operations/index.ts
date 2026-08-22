import { withSupabase } from "@supabase/server"
import { fail, isRateLimitError, json } from "../_shared/secure.ts"

type Db = { public: { Tables: Record<string, never>; Views: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>; Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }> } }
type Action = "view" | "staffView" | "preview" | "issue" | "accept" | "reject" | "renew"

const ACTIONS = new Set<Action>(["view", "staffView", "preview", "issue", "accept", "reject", "renew"])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const KNOWN = [
  "already_accepted", "already_rejected", "invalid_amount", "invalid_order_id",
  "invalid_idempotency_key", "invalid_quote_expiry", "invalid_quote_token",
  "not_authorized", "order_closed", "order_not_found",
  "quote_expired", "quote_not_current", "quote_not_expired", "quote_not_found", "quote_not_offered",
  "quote_not_pending", "quote_requires_admin_approval", "reason_too_long",
]

function positiveId(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2_147_483_647 ? Number(value) : null
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("")
}

const handler = withSupabase<Db>({ auth: ["user", "publishable"] }, async (req, ctx) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)
  if (Number(req.headers.get("content-length") ?? 0) > 4096) return json({ error: "request_too_large" }, 413)

  let body: unknown
  try { body = await req.json() } catch { return json({ error: "invalid_json" }, 400) }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_request" }, 400)

  const input = body as Record<string, unknown>
  const action = input.action
  if (typeof action !== "string" || !ACTIONS.has(action as Action)) return json({ error: "invalid_action" }, 400)
  const safeAction = action as Action
  const orderId = positiveId(input.orderId)
  if (!orderId) return json({ error: "invalid_quote_input" }, 400)

  // Customer decisions use the existing per-order opaque tracking token. The
  // database function must verify it belongs to this exact quote/order; never
  // treat a client-supplied order ID as proof of ownership.
  const orderToken = typeof input.orderToken === "string" ? input.orderToken : null
  if ((safeAction === "view" || safeAction === "accept" || safeAction === "reject" || safeAction === "renew") && (!orderToken || !UUID.test(orderToken))) {
    return json({ error: "not_authorized" }, 403)
  }
  if ((safeAction === "staffView" || safeAction === "preview" || safeAction === "issue") && !ctx.userClaims?.id) return json({ error: "not_logged_in" }, 401)

  const identity = (safeAction === "staffView" || safeAction === "preview" || safeAction === "issue") ? ctx.userClaims!.id : orderToken!
  const identityHash = await digest(identity)
  for (const [bucket, max] of [
    [`quote-operations:${safeAction}:${identityHash}`, 10],
    [`quote-operations-global:${safeAction}`, 300],
  ] as const) {
    const { error } = await ctx.supabaseAdmin.rpc("check_rate_limit", { p_bucket: bucket, p_max: max, p_window: "10 minutes" })
    if (error) {
      if (isRateLimitError(error)) return json({ error: "rate_limited" }, 429)
      return fail("quote-operations", "rate_limit_check_failed", 500, error)
    }
  }

  let fn: string
  let args: Record<string, unknown>
  if (safeAction === "view") {
    fn = "get_current_custom_order_quote"
    args = { p_order_id: orderId, p_order_token: orderToken }
  } else if (safeAction === "staffView") {
    fn = "staff_current_custom_order_quote"
    args = { p_order_id: orderId }
  } else if (safeAction === "preview" || safeAction === "issue") {
    const subtotal = Number(input.subtotal)
    const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey : ""
    if (!Number.isFinite(subtotal) || subtotal < 0 || subtotal > 1_000_000 || (safeAction === "issue" && !UUID.test(idempotencyKey))) {
      return json({ error: "invalid_quote_input" }, 400)
    }
    fn = safeAction === "preview" ? "preview_custom_order_quote" : "issue_custom_order_quote"
    args = safeAction === "preview"
      ? { p_order_id: orderId, p_subtotal: subtotal }
      : { p_order_id: orderId, p_subtotal: subtotal, p_expires_at: null, p_idempotency_key: idempotencyKey }
  } else if (safeAction === "accept" || safeAction === "renew") {
    const quoteId = positiveId(input.quoteId)
    const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey : ""
    if (!quoteId || !UUID.test(idempotencyKey)) return json({ error: "invalid_quote_input" }, 400)
    fn = safeAction === "accept" ? "accept_custom_order_quote" : "renew_expired_custom_order_quote"
    args = { p_order_id: orderId, p_quote_id: quoteId, p_order_token: orderToken, p_idempotency_key: idempotencyKey }
  } else {
    const quoteId = positiveId(input.quoteId)
    const reason = typeof input.reason === "string" ? input.reason.trim() : ""
    const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey : ""
    if (!quoteId || reason.length > 500 || !UUID.test(idempotencyKey)) return json({ error: "invalid_quote_input" }, 400)
    fn = "reject_custom_order_quote"
    args = { p_order_id: orderId, p_quote_id: quoteId, p_order_token: orderToken, p_reason: reason, p_idempotency_key: idempotencyKey }
  }

  const result = await ctx.supabaseAdmin.rpc(fn, { ...args, p_auth_user_id: ctx.userClaims?.id ?? null })
  if (result.error) {
    const known = KNOWN.find(code => result.error?.message?.includes(code))
    if (known) return json({ error: known }, known === "not_authorized" ? 403 : known === "order_not_found" || known === "quote_not_found" ? 404 : 400)
    return fail("quote-operations", "quote_transition_failed", 500, result.error)
  }
  return json({ ok: true, data: result.data ?? null })
})

export default { fetch: handler }
