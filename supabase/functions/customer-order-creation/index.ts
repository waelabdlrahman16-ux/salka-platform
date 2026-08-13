import { withSupabase } from "@supabase/server"
import { fail, isRateLimitError, json } from "../_shared/secure.ts"

type OrderDatabase = {
  public: {
    Tables: Record<string, never>
    Views: Record<string, never>
    Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

type Action = "catalog" | "custom" | "pickup"
const ACTION_LIMITS: Record<Action, number> = { catalog: 10, custom: 10, pickup: 10 }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ORDER_ERRORS = [
  "account_blocked", "addon_group_max_exceeded", "addon_group_min_not_met",
  "collect_amount_required", "compound_id_required", "compound_missing_distance",
  "compound_missing_fee", "daily_order_limit", "empty_order", "invalid_addon",
  "invalid_collect_amount", "invalid_combo", "invalid_customer_name", "invalid_item",
  "invalid_item_count", "invalid_item_quantity", "invalid_items", "invalid_payment_method",
  "invalid_payment_mode", "invalid_phone", "invalid_prescription_path", "invalid_size",
  "invalid_unit_number", "invalid_zone", "item_not_available_now", "item_unavailable",
  "login_required", "menu_item_not_found", "missing_customer_details", "not_a_custom_order_vendor",
  "not_your_restaurant", "notes_too_long", "order_rate_limit", "restaurant_closed",
  "restaurant_not_found", "size_required", "slot_full", "slot_unavailable",
  "vendor_not_covering_compound", "promo_invalid", "promo_expired",
  "promo_not_available", "promo_minimum_not_met", "promo_limit_reached",
  "promo_already_used", "promo_customer_missing",
].sort((a, b) => b.length - a.length)

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
function positiveId(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2_147_483_647
    ? Number(value) : null
}
function text(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null
  const result = value.trim()
  return result.length >= min && result.length <= max ? result : null
}
function optionalText(value: unknown, max: number): string | null | undefined {
  if (value == null || value === "") return null
  return typeof value === "string" && value.length <= max ? value.trim() : undefined
}
function nullablePositiveId(value: unknown): number | null | undefined {
  return value == null ? null : positiveId(value) ?? undefined
}
function sessionToken(value: unknown): string | null | undefined {
  if (value == null || value === "") return null
  return typeof value === "string" && UUID.test(value) ? value : undefined
}
async function digest(value: string): Promise<string> {
  const pepper = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!pepper) throw new Error("missing_rate_limit_pepper")
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("")
}
function publicError(message?: string): string | null {
  return ORDER_ERRORS.find(code => message?.includes(code)) ?? null
}

const customerOrderCreation = withSupabase<OrderDatabase>(
  { auth: ["user", "publishable"] },
  async (req, ctx) => {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)
    const contentLength = Number(req.headers.get("content-length") ?? 0)
    if (contentLength > 65_536) return json({ error: "request_too_large" }, 413)

    let body: unknown
    try { body = await req.json() } catch { return json({ error: "invalid_json" }, 400) }
    if (!object(body)) return json({ error: "invalid_request" }, 400)
    const action = body.action
    if (typeof action !== "string" || !(action in ACTION_LIMITS)) return json({ error: "invalid_action" }, 400)
    const safeAction = action as Action
    const restaurantId = positiveId(body.restaurantId)
    const name = text(body.customerName, 2, 100)
    const phone = text(body.customerPhone, 8, 24)
    const zone = text(body.zone, 1, 120)
    const unit = text(body.unitNumber, 1, 100)
    const addressNotes = optionalText(body.addressNotes, 1000)
    const compoundId = positiveId(body.compoundId)
    const token = sessionToken(body.sessionToken)
    if (!restaurantId || !name || !phone || !zone || !unit || !compoundId || addressNotes === undefined || token === undefined) {
      return json({ error: "invalid_customer_input" }, 400)
    }
    if (safeAction === "pickup" && !ctx.userClaims?.id) return json({ error: "not_logged_in" }, 401)

    let rateKey: string
    // Match normalize_phone() exactly so 01..., +201..., and spaced forms share
    // one limit without storing the recoverable phone number in rate_limit_log.
    try { rateKey = await digest(phone.replace(/\D/g, "").slice(-10)) } catch (error) {
      return fail("customer-order-creation", "rate_limit_identity_failed", 500, error)
    }
    for (const [bucket, max, window] of [
      [`order-edge:${safeAction}:${rateKey}`, ACTION_LIMITS[safeAction], "15 minutes"],
      [`order-edge-global:${safeAction}`, 5000, "15 minutes"],
    ] as const) {
      const { error } = await ctx.supabaseAdmin.rpc("check_rate_limit", { p_bucket: bucket, p_max: max, p_window: window })
      if (error) {
        if (isRateLimitError(error)) return json({ error: "rate_limited" }, 429)
        return fail("customer-order-creation", "rate_limit_check_failed", 500, error)
      }
    }

    const common = {
      p_restaurant_id: restaurantId, p_customer_name: name, p_customer_phone: phone,
      p_zone: zone, p_unit_number: unit, p_address_notes: addressNotes ?? "",
      p_delivery_fee: typeof body.deliveryFee === "number" ? body.deliveryFee : 0,
      p_compound_id: compoundId, p_session_token: token,
    }
    let fn: string
    let args: Record<string, unknown>
    if (safeAction === "catalog") {
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) return json({ error: "invalid_items" }, 400)
      const slotId = nullablePositiveId(body.slotId)
      const note = optionalText(body.customerNote, 1000)
      const promoCode = optionalText(body.promoCode, 32)
      if (slotId === undefined || note === undefined || promoCode === undefined || (body.scheduledDate != null && typeof body.scheduledDate !== "string")) {
        return json({ error: "invalid_order_input" }, 400)
      }
      fn = "place_order"
      args = { ...common, p_items: body.items, p_slot_id: slotId, p_scheduled_date: body.scheduledDate ?? null,
        p_payment_method: body.paymentMethod, p_use_wallet: body.useWallet === true, p_customer_note: note,
        p_promo_code: promoCode?.toUpperCase() ?? null }
    } else if (safeAction === "custom") {
      if (!Array.isArray(body.items) || body.items.length > 50) return json({ error: "invalid_items" }, 400)
      const slotId = nullablePositiveId(body.slotId)
      const notes = optionalText(body.requestNotes, 2000)
      const rx = optionalText(body.prescriptionPath, 120)
      if (slotId === undefined || notes === undefined || rx === undefined || (body.scheduledDate != null && typeof body.scheduledDate !== "string")) {
        return json({ error: "invalid_order_input" }, 400)
      }
      fn = "submit_custom_order"
      args = { ...common, p_request_items: body.items, p_request_notes: notes ?? "", p_slot_id: slotId,
        p_scheduled_date: body.scheduledDate ?? null, p_prescription_path: rx }
    } else {
      const notes = optionalText(body.requestNotes, 2000)
      const collect = body.collectAmount == null ? null : Number(body.collectAmount)
      if (notes === undefined || (collect !== null && (!Number.isFinite(collect) || collect < 0 || collect > 1_000_000))) {
        return json({ error: "invalid_order_input" }, 400)
      }
      fn = "request_pickup"
      args = { ...common, p_payment_mode: body.paymentMode, p_collect_amount: collect, p_request_notes: notes ?? "" }
    }

    const result = await ctx.supabaseAdmin.rpc(fn, { ...args, p_rate_key: rateKey, p_auth_user_id: ctx.userClaims?.id ?? null })
    if (result.error) {
      const code = publicError(result.error.message)
      if (code) return json({ error: code }, code.includes("rate_limit") ? 429 : 400)
      return fail("customer-order-creation", "order_creation_failed", 500, result.error)
    }
    return json({ ok: true, data: result.data })
  },
)

export default { fetch: customerOrderCreation }
