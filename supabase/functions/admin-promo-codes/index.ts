import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
const promoCode = (value: unknown) => typeof value === "string" ? value.trim().toUpperCase() : ""
const positive = (value: unknown, allowZero = false) => typeof value === "number" && Number.isFinite(value) && (allowZero ? value >= 0 : value > 0) ? value : null
const positiveInt = (value: unknown) => Number.isInteger(value) && Number(value) > 0 ? Number(value) : null
const dateValue = (value: unknown) => value == null || value === "" ? null : typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined
// Which part of the bill the code is allowed to discount. Unset means delivery:
// the safe default is the one that never reaches into the vendor's basket.
const SCOPES = ["delivery", "service", "vendor", "platform", "all"] as const
const scopeValue = (value: unknown) => value == null || value === "" ? "delivery" : typeof value === "string" && (SCOPES as readonly string[]).includes(value) ? value : null

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers })
  if (req.method !== "POST") return reply({ ok: false, error: "method_not_allowed" }, 405)
  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "")
    if (!token) return reply({ ok: false, error: "missing_auth" }, 401)
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
    const { data: session, error: sessionError } = await admin.auth.getUser(token)
    if (sessionError || !session.user) return reply({ ok: false, error: "invalid_session" }, 401)
    const { data: profile } = await admin.from("profiles").select("role").eq("id", session.user.id).maybeSingle()
    if (profile?.role !== "admin") return reply({ ok: false, error: "admin_only" }, 403)
    const { error: limitError } = await admin.rpc("check_rate_limit", { p_bucket: "admin_promo_codes:" + session.user.id, p_max: 100, p_window: "10 minutes" })
    if (limitError) return reply({ ok: false, error: limitError.message.includes("rate_limited") ? "rate_limited" : "rate_limit_check_failed" }, limitError.message.includes("rate_limited") ? 429 : 500)
    const body = await req.json()
    if (!body || typeof body.action !== "string") return reply({ ok: false, error: "invalid_request" }, 400)

    if (body.action === "list") {
      const { data: codes, error } = await admin.from("promo_codes").select("id,code,active,discount_type,discount_value,max_discount_egp,minimum_subtotal_egp,applies_to,restaurant_id,compound_id,starts_at,ends_at,max_redemptions,max_redemptions_per_customer").order("id", { ascending: false })
      if (error) return reply({ ok: false, error: "list_failed" }, 500)
      const { data: redemptions } = await admin.from("promo_redemptions").select("promo_code_id")
      const counts: Record<string, number> = {}
      for (const row of redemptions ?? []) counts[String(row.promo_code_id)] = (counts[String(row.promo_code_id)] ?? 0) + 1
      return reply({ ok: true, codes: (codes ?? []).map(row => ({ ...row, redemption_count: counts[String(row.id)] ?? 0 })) })
    }

    const id = positiveInt(body.id)
    if (body.action === "set_active") {
      if (!id || typeof body.active !== "boolean") return reply({ ok: false, error: "invalid_input" }, 400)
      const { error } = await admin.from("promo_codes").update({ active: body.active, updated_at: new Date().toISOString() }).eq("id", id)
      return error ? reply({ ok: false, error: "update_failed" }, 500) : reply({ ok: true })
    }

    if (body.action === "create" || body.action === "update") {
      if (body.action === "update" && !id) return reply({ ok: false, error: "invalid_id" }, 400)
      const code = promoCode(body.code)
      const value = positive(body.discount_value)
      const minimum = positive(body.minimum_subtotal_egp, true)
      const maxDiscount = body.max_discount_egp == null ? null : positive(body.max_discount_egp)
      const maxRedemptions = body.max_redemptions == null ? null : positiveInt(body.max_redemptions)
      const perCustomer = positiveInt(body.max_redemptions_per_customer)
      const appliesTo = scopeValue(body.applies_to)
      const restaurantId = body.restaurant_id == null ? null : positiveInt(body.restaurant_id)
      const compoundId = body.compound_id == null ? null : positiveInt(body.compound_id)
      const startsAt = dateValue(body.starts_at), endsAt = dateValue(body.ends_at)
      if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code) || !value || minimum == null || !perCustomer || appliesTo == null || startsAt === undefined || endsAt === undefined || (body.discount_type !== "percent" && body.discount_type !== "fixed") || (body.discount_type === "percent" && value > 100) || (startsAt && endsAt && startsAt >= endsAt)) return reply({ ok: false, error: "invalid_input" }, 400)
      const row = { code, discount_type: body.discount_type, discount_value: value, max_discount_egp: maxDiscount, minimum_subtotal_egp: minimum, applies_to: appliesTo, restaurant_id: restaurantId, compound_id: compoundId, starts_at: startsAt, ends_at: endsAt, max_redemptions: maxRedemptions, max_redemptions_per_customer: perCustomer, updated_at: new Date().toISOString() }
      if (body.action === "create") {
        const { error } = await admin.from("promo_codes").insert({ ...row, active: true, created_by: session.user.id })
        if (error?.code === "23505") return reply({ ok: false, error: "duplicate_code" }, 409)
        return error ? reply({ ok: false, error: "create_failed" }, 500) : reply({ ok: true })
      }
      const { error } = await admin.from("promo_codes").update(row).eq("id", id)
      if (error?.code === "23505") return reply({ ok: false, error: "duplicate_code" }, 409)
      return error ? reply({ ok: false, error: "update_failed" }, 500) : reply({ ok: true })
    }
    return reply({ ok: false, error: "unknown_action" }, 400)
  } catch (error) {
    console.error("admin-promo-codes failed", error)
    return reply({ ok: false, error: "internal_error" }, 500)
  }
})
