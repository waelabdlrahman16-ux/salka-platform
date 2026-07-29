import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Customer login via SMS OTP -- no password, no Supabase Auth account.
// action=request  -> generates a code, stores it, sends it via SMS Misr's OTP API.
// action=verify   -> checks the code, creates/finds the customer, issues a session token.
//
// Requires these secrets (set in Supabase dashboard -> Edge Functions -> Secrets)
// once a SMS Misr account exists and a Sender ID + OTP template are approved:
//   SMSMISR_USERNAME      -- SMS Misr account username
//   SMSMISR_PASSWORD      -- SMS Misr account password
//   SMSMISR_SENDER        -- approved Sender ID / token
//   SMSMISR_OTP_TEMPLATE  -- approved OTP template token (contact SMS Misr to set
//                            up an Arabic template like "كود تأكيد سالكة: {otp}")
//   SMSMISR_ENV           -- "2" for their test environment, "1" for live once
//                            everything is approved. Defaults to "2" (test) if unset,
//                            so nothing can accidentally go live before you're ready.
// Until SMSMISR_USERNAME/PASSWORD/SENDER/OTP_TEMPLATE are all set, action=request
// returns sms_not_configured rather than silently pretending to succeed.
//
// NOTE: success/failure is currently detected via presence of an SMSID in the
// response. SMS Misr's docs show a success code of "4901" for their OTP
// endpoint -- worth tightening this check against their full response-code
// table once a real account is live, in case other codes should also count
// as success or need distinct handling (e.g. insufficient balance vs bad
// template vs bad number).
//
// Both request and verify are rate-limited per phone number (via check_rate_limit).
// verify is limited separately and more tightly than request, since a 6-digit code
// is guessable if an attacker gets unlimited attempts within the 5-minute TTL.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  })
}

function normalizePhone(raw: string): string {
  return raw.replace(/[^0-9]/g, "").slice(-10)
}

function toE164Egypt(raw: string): string {
  // local Egyptian format is 01xxxxxxxxx (11 digits) -> 20 1xxxxxxxxx (no plus,
  // SMS Misr's examples use the bare "2011XXXXXXX" form)
  const digits = raw.replace(/[^0-9]/g, "")
  const local = digits.slice(-10) // drop leading 0
  return `20${local}`
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  let body: any
  try { body = await req.json() } catch { return json({ error: "invalid_json" }, 400) }
  const { action, phone } = body

  if (!phone || typeof phone !== "string") return json({ error: "phone_required" }, 400)
  const cleanPhone = normalizePhone(phone)
  if (cleanPhone.length !== 10) return json({ error: "invalid_phone" }, 400)

  if (action === "request") {
    const { error: limitErr } = await admin.rpc("check_rate_limit", {
      p_bucket: `login_otp:${cleanPhone}`, p_max: 5, p_window: "10 minutes"
    })
    if (limitErr) return json({ error: "rate_limited" }, 429)

    const code = Math.floor(100000 + Math.random() * 900000).toString()

    const { error: insertErr } = await admin.from("wallet_otp").insert({
      phone: cleanPhone, code, expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    })
    if (insertErr) return json({ error: "otp_store_failed", detail: insertErr.message }, 500)

    const username = Deno.env.get("SMSMISR_USERNAME")
    const password = Deno.env.get("SMSMISR_PASSWORD")
    const sender = Deno.env.get("SMSMISR_SENDER")
    const template = Deno.env.get("SMSMISR_OTP_TEMPLATE")
    const environment = Deno.env.get("SMSMISR_ENV") ?? "2"
    if (!username || !password || !sender || !template) {
      return json({ error: "sms_not_configured" }, 500)
    }

    const form = new URLSearchParams({
      environment, username, password, sender,
      mobile: toE164Egypt(cleanPhone),
      template, otp: code
    })
    const smsRes = await fetch("https://smsmisr.com/api/OTP/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form
    })
    const smsData = await smsRes.json().catch(() => null)
    if (!smsRes.ok || !smsData?.SMSID) return json({ error: "sms_send_failed", detail: smsData }, 502)

    return json({ ok: true })
  }

  if (action === "verify") {
    const { error: limitErr } = await admin.rpc("check_rate_limit", {
      p_bucket: `verify_otp:${cleanPhone}`, p_max: 8, p_window: "10 minutes"
    })
    if (limitErr) return json({ error: "rate_limited" }, 429)

    const { code, name } = body
    if (!code) return json({ error: "code_required" }, 400)

    const { data: otpRow } = await admin.from("wallet_otp").select("id")
      .eq("phone", cleanPhone).eq("code", code).eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .order("id", { ascending: false }).limit(1).maybeSingle()
    if (!otpRow) return json({ error: "invalid_or_expired_code" }, 400)

    await admin.from("wallet_otp").update({ used: true }).eq("id", otpRow.id)

    let { data: customer } = await admin.from("customers").select("*").eq("phone", cleanPhone).maybeSingle()
    if (!customer) {
      const { data: created, error: createErr } = await admin.from("customers")
        .insert({ phone: cleanPhone, name: name || null }).select("*").single()
      if (createErr) return json({ error: "customer_create_failed", detail: createErr.message }, 500)
      customer = created
    } else if (name && !customer.name) {
      await admin.from("customers").update({ name }).eq("id", customer.id)
      customer.name = name
    }

    const { data: session, error: sessErr } = await admin.from("customer_sessions")
      .insert({ customer_id: customer.id }).select("token").single()
    if (sessErr) return json({ error: "session_create_failed", detail: sessErr.message }, 500)

    return json({ token: session.token, customer: { id: customer.id, phone: customer.phone, name: customer.name } })
  }

  return json({ error: "unknown_action" }, 400)
})
