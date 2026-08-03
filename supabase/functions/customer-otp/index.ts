import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { secureOtpCode, isRateLimitError, CORS_HEADERS, json, fail } from "../_shared/secure.ts"

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

  try {
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
      // Ordering matters. check_rate_limit INSERTS a row on every non-limited
      // call, so a check that runs *after* another has already spent that
      // bucket's budget. The service-wide circuit breakers therefore run FIRST:
      // if the platform is being hammered, a legitimate customer gets a clean
      // "busy, try shortly" without also burning one of their own five attempts.
      //
      // The per-IP bucket that used to sit here has been removed. It was
      // bypassable (x-forwarded-for is client-supplied, so an attacker rotates
      // it freely) and harmful (Egyptian carriers run large-scale CGNAT, so
      // thousands of real subscribers share one address and would lock each
      // other out). It gave the appearance of protection while doing neither.
      for (const [bucket, max, window] of [
        ["login_otp_burst", 30, "1 minute"],
        ["login_otp_daily", 500, "24 hours"],
      ] as const) {
        const { error: limitErr } = await admin.rpc("check_rate_limit", {
          p_bucket: bucket, p_max: max, p_window: window
        })
        if (limitErr) {
          if (isRateLimitError(limitErr)) {
            // Distinct from the per-user code: this is us, not them, and it
            // needs to be loud in the logs because it caps real SMS spend.
            console.error(`[customer-otp] circuit breaker tripped: ${bucket}`)
            return json({ error: "service_busy" }, 503)
          }
          return fail("customer-otp", "rate_limit_check_failed", 500, limitErr)
        }
      }

      {
        const { error: limitErr } = await admin.rpc("check_rate_limit", {
          p_bucket: `login_otp:${cleanPhone}`, p_max: 5, p_window: "10 minutes"
        })
        if (limitErr) {
          // Only a real limit is "wait and retry". A missing function or a
          // permission error is not, and telling the user to wait about a
          // problem waiting cannot fix is worse than an honest failure.
          if (isRateLimitError(limitErr)) return json({ error: "rate_limited" }, 429)
          return fail("customer-otp", "rate_limit_check_failed", 500, limitErr)
        }
      }

      const username = Deno.env.get("SMSMISR_USERNAME")
      const password = Deno.env.get("SMSMISR_PASSWORD")
      const sender = Deno.env.get("SMSMISR_SENDER")
      const template = Deno.env.get("SMSMISR_OTP_TEMPLATE")
      const environment = Deno.env.get("SMSMISR_ENV") ?? "2"
      if (!username || !password || !sender || !template) {
        return json({ error: "sms_not_configured" }, 500)
      }

      const code = secureOtpCode()

      // Store the new code first, send second, and only invalidate the OLD ones
      // once the send is confirmed. Invalidating up front meant a provider blip
      // on a resend destroyed the code already sitting on the user's handset --
      // they would type a code they had genuinely received and be told it was
      // invalid, with the replacement never arriving. The file header notes the
      // SMSID success check is itself unreliable, which makes that path likely,
      // not theoretical.
      const { data: inserted, error: insertErr } = await admin.from("customer_otp_codes")
        .insert({ phone: cleanPhone, code, expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() })
        .select("id").single()
      if (insertErr || !inserted) return fail("customer-otp", "otp_store_failed", 500, insertErr)

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
      if (!smsRes.ok || !smsData?.SMSID) {
        // Retire the code we just stored but never delivered, leaving whatever
        // the user already holds still valid.
        await admin.from("customer_otp_codes").update({ used: true }).eq("id", inserted.id)
        // smsData was forwarded to the client verbatim, exposing the provider's
        // raw response. Log it, return the code only.
        return fail("customer-otp", "sms_send_failed", 502, smsData)
      }

      // Delivered. Now retire every earlier code so only this one verifies --
      // previously up to five were live at once against eight allowed guesses.
      const { error: invalidateErr } = await admin.from("customer_otp_codes")
        .update({ used: true })
        .eq("phone", cleanPhone).eq("used", false).neq("id", inserted.id)
      if (invalidateErr) console.error("[customer-otp] failed to retire older codes:", invalidateErr)

      return json({ ok: true })
    }

    if (action === "verify") {
      const { error: limitErr } = await admin.rpc("check_rate_limit", {
        p_bucket: `verify_otp:${cleanPhone}`, p_max: 8, p_window: "10 minutes"
      })
      if (limitErr) {
        if (isRateLimitError(limitErr)) return json({ error: "rate_limited" }, 429)
        return fail("customer-otp", "rate_limit_check_failed", 500, limitErr)
      }

      const { code, name } = body
      if (!code) return json({ error: "code_required" }, 400)

      const { data: otpRow } = await admin.from("customer_otp_codes").select("id")
        .eq("phone", cleanPhone).eq("code", code).eq("used", false)
        .gt("expires_at", new Date().toISOString())
        .order("id", { ascending: false }).limit(1).maybeSingle()
      if (!otpRow) return json({ error: "invalid_or_expired_code" }, 400)

      await admin.from("customer_otp_codes").update({ used: true }).eq("id", otpRow.id)

      let { data: customer } = await admin.from("customers").select("*").eq("phone", cleanPhone).maybeSingle()
      if (!customer) {
        const { data: created, error: createErr } = await admin.from("customers")
          .insert({ phone: cleanPhone, name: name || null }).select("*").single()
        if (createErr) return fail("customer-otp", "customer_create_failed", 500, createErr)
        customer = created
      } else if (name && !customer.name) {
        await admin.from("customers").update({ name }).eq("id", customer.id)
        customer.name = name
      }

      const { data: session, error: sessErr } = await admin.from("customer_sessions")
        .insert({ customer_id: customer.id }).select("token").single()
      if (sessErr) return fail("customer-otp", "session_create_failed", 500, sessErr)

      return json({ token: session.token, customer: { id: customer.id, phone: customer.phone, name: customer.name } })
    }

    return json({ error: "unknown_action" }, 400)
  } catch (e) {
    console.error("customer-otp unhandled error:", e)
    return json({ error: "internal_error" }, 500)
  }
})
