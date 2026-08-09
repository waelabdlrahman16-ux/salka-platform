import { withSupabase } from "@supabase/server"
import { fail, isRateLimitError, json } from "../_shared/secure.ts"

type Db = { public: { Tables: Record<string, never>; Views: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>; Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }> } }
type Action = "complaint" | "push" | "rating" | "track"
const LIMITS: Record<Action, number> = { complaint: 6, push: 10, rating: 6, track: 30 }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const KNOWN = ["bad_platform","comment_too_long","complaint_limit_reached","complaint_too_long","complaint_too_short","empty_token","invalid_driver_rating","invalid_restaurant_rating","order_not_delivered","order_not_found","rating_already_submitted","rating_required","rating_window_closed","token_too_long"]

async function tokenDigest(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("")
}
function missingOverload(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "PGRST202" || !!error?.message?.includes("Could not find the function")
}

const handler = withSupabase<Db>({ auth: ["user", "publishable"] }, async (req, ctx) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)
  if (Number(req.headers.get("content-length") ?? 0) > 8192) return json({ error: "request_too_large" }, 413)
  let body: unknown
  try { body = await req.json() } catch { return json({ error: "invalid_json" }, 400) }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_request" }, 400)
  const input = body as Record<string, unknown>
  const action = input.action
  const token = input.token
  if (typeof action !== "string" || !(action in LIMITS)) return json({ error: "invalid_action" }, 400)
  if (typeof token !== "string" || !UUID.test(token)) return json({ error: "not_authorized" }, 403)
  const safeAction = action as Action
  const digest = await tokenDigest(token)

  for (const [bucket, max, window] of [
    [`customer-order-access:${safeAction}:${digest}`, LIMITS[safeAction], "1 minute"],
    [`customer-order-access-global:${safeAction}`, 5000, "1 minute"],
  ] as const) {
    const { error } = await ctx.supabaseAdmin.rpc("check_rate_limit", { p_bucket: bucket, p_max: max, p_window: window })
    if (error) {
      if (isRateLimitError(error)) return json({ error: "rate_limited" }, 429)
      return fail("customer-order-access", "rate_limit_check_failed", 500, error)
    }
  }

  let result: { data: unknown; error: { code?: string; message?: string } | null }
  if (safeAction === "track") {
    result = await ctx.supabaseAdmin.rpc("track_order", { p_token: token })
  } else if (safeAction === "push") {
    const pushToken = typeof input.pushToken === "string" ? input.pushToken.trim() : ""
    const platform = input.platform
    if (!pushToken || pushToken.length > 4096 || !["web","android","ios"].includes(String(platform))) return json({ error: "invalid_push_input" }, 400)
    result = await ctx.supabaseAdmin.rpc("save_customer_push_token", { p_token: token, p_push_token: pushToken, p_platform: platform, p_auth_user_id: ctx.userClaims?.id ?? null })
    if (missingOverload(result.error)) result = await ctx.supabase.rpc("save_customer_push_token", { p_token: token, p_push_token: pushToken, p_platform: platform })
  } else if (safeAction === "rating") {
    const driver = input.driverRating == null ? null : Number(input.driverRating)
    const restaurant = input.restaurantRating == null ? null : Number(input.restaurantRating)
    const comment = typeof input.comment === "string" ? input.comment.trim() : ""
    if ((driver == null && restaurant == null) || (driver != null && (!Number.isInteger(driver) || driver < 1 || driver > 5)) || (restaurant != null && (!Number.isInteger(restaurant) || restaurant < 1 || restaurant > 5)) || comment.length > 1000) return json({ error: "invalid_rating_input" }, 400)
    result = await ctx.supabaseAdmin.rpc("submit_rating", { p_token: token, p_driver_rating: driver, p_restaurant_rating: restaurant, p_comment: comment, p_auth_user_id: ctx.userClaims?.id ?? null })
    if (missingOverload(result.error)) result = await ctx.supabase.rpc("submit_rating", { p_token: token, p_driver_rating: driver, p_restaurant_rating: restaurant, p_comment: comment })
  } else {
    const description = typeof input.description === "string" ? input.description.trim() : ""
    const category = typeof input.category === "string" ? input.category : "other"
    if (description.length < 5 || description.length > 2000) return json({ error: "invalid_complaint_input" }, 400)
    result = await ctx.supabaseAdmin.rpc("submit_complaint", { p_token: token, p_description: description, p_category: category })
  }
  if (result.error) {
    const known = KNOWN.find(code => result.error?.message?.includes(code))
    if (known) return json({ error: known }, known === "order_not_found" ? 404 : known.includes("limit") ? 429 : 400)
    return fail("customer-order-access", "customer_order_access_failed", 500, result.error)
  }
  return json({ ok: true, data: result.data ?? null })
})

export default { fetch: handler }
