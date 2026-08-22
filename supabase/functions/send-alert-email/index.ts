import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Operational alerts to staff, by email.
//
// Called by Postgres (private.notification_failure_digest) via pg_net with the
// same shared webhook secret used by send-push. The caller is the database, never
// the browser.
//
// DELIBERATELY NOT GATED BY RECEIPT_EMAIL_ENABLED. That flag exists to keep
// customer-facing receipts switched off until the sending domain is signed off.
// An internal alert has the opposite risk profile: the whole point is that it
// still arrives when push delivery is broken, so tying it to the receipts
// rollout would mean the alarm is silent exactly while the thing it watches is
// being stood up.
//
// THE SENDING DOMAIN IS app.gosalka.com, NOT gosalka.com.
// Resend has app.gosalka.com verified; the bare apex has never been added. A
// From address on the apex is rejected with HTTP 403 by Resend, which is
// exactly what was happening to send-receipt-email -- silently, because the
// only caller is a pg_net trigger that reads status codes and nothing was
// watching them. Override with ALERT_EMAIL_FROM only after adding and
// verifying whatever domain it names.
const FROM = Deno.env.get("ALERT_EMAIL_FROM") ?? "Salka Alerts <alerts@app.gosalka.com>"

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

  const expectedSecret = Deno.env.get("PUSH_WEBHOOK_SECRET")
  if (!expectedSecret || req.headers.get("x-webhook-secret") !== expectedSecret) {
    return json({ error: "invalid_webhook_secret" }, 401)
  }

  const resendKey = Deno.env.get("RESEND_API_KEY")
  if (!resendKey) {
    console.error("[send-alert-email] not_configured: RESEND_API_KEY is unset")
    return json({ error: "not_configured" }, 503)
  }

  let body: any
  try { body = await req.json() } catch { return json({ error: "invalid_json" }, 400) }

  const to = body?.to || Deno.env.get("ALERT_EMAIL_TO")
  if (!to) return json({ error: "no_recipient" }, 400)

  const subject = String(body?.subject ?? "Salka alert")
  const heading = String(body?.heading ?? subject)
  const lines: string[] = Array.isArray(body?.lines) ? body.lines.map(String) : []
  const detail = String(body?.detail ?? "")

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
    <div style="border-left:4px solid #d94040;background:#fdf3f3;padding:14px 18px;border-radius:8px;margin-bottom:18px;">
      <h2 style="margin:0;font-size:17px;">${esc(heading)}</h2>
    </div>
    ${lines.length ? `<ul style="font-size:14px;line-height:1.7;padding-left:18px;">${
      lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
    ${detail ? `<pre style="background:#f6f7f8;padding:12px;border-radius:8px;font-size:12px;white-space:pre-wrap;word-break:break-word;">${esc(detail)}</pre>` : ""}
    <p style="color:#999;font-size:11px;margin-top:22px;">
      Sent by Salka because a notification failed to reach its recipient.
      Open the admin push-health screen for the full list.
    </p>
  </div>`

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  })

  if (!res.ok) {
    const detailBody = await res.json().catch(() => null)
    console.error("[send-alert-email] resend_failed:", res.status, detailBody)
    return json({ error: "resend_failed", status: res.status, from: FROM }, 502)
  }

  return json({ ok: true })
})
