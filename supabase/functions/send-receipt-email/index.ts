import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Sends a final order-receipt/invoice email once an order is Delivered.
// Called by a Postgres trigger (notify_order_delivered_receipt) via pg_net,
// authenticated with the same shared webhook secret used for send-push --
// the caller is the database itself, never the frontend.
//
// Only fires for orders tied to a logged-in customer with an email on file
// (guest/phone-only checkouts have nowhere to send a receipt).
//
// Requires RESEND_API_KEY (Supabase dashboard -> Edge Functions -> Secrets).
//
// Best-effort, but not uniformly so -- the distinction matters operationally:
//   200  nothing to do, and that is correct: no customer on the order, or no
//        email on file. Never blocks the delivery-status update that fired it.
//   503  misconfigured: RESEND_API_KEY is unset or was rotated away. This USED
//        to return 200, and because the caller is a Postgres trigger via pg_net
//        which only inspects status codes, every customer receipt could stop
//        being sent with nothing anywhere surfacing it.
//   502  Resend rejected the send. Logged server-side with the provider's
//        response; the client only ever sees the code.
// pg_net does not retry, so a non-2xx cannot cause a retry storm and the
// trigger is fire-and-forget, so it cannot block the status update either.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  })
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))
}

function buildInvoiceHtml(order: any, items: any[]): string {
  const itemRows = items.map(it => {
    // combo_name first: this is the artifact a customer forwards when they
    // dispute a charge, and without it a 130 ج.م line sits against a 75 ج.م
    // menu price with nothing explaining the difference.
    const details = [it.combo_name && `كومبو ${it.combo_name}`, it.size_name, ...(it.addon_names ?? [])].filter(Boolean).join(" · ")
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #eee;">
          <div style="font-weight:600;">${esc(it.name)} × ${esc(it.qty)}</div>
          ${details ? `<div style="font-size:12px;color:#888;">${esc(details)}</div>` : ""}
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:left;white-space:nowrap;">${esc(it.total)} ج.م</td>
      </tr>`
  }).join("")

  const row = (label: string, value: string, bold = false) => `
    <tr>
      <td style="padding:4px 0;${bold ? "font-weight:700;" : "color:#666;"}">${esc(label)}</td>
      <td style="padding:4px 0;text-align:left;${bold ? "font-weight:700;" : ""}">${esc(value)} ج.م</td>
    </tr>`

  return `
  <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a;">
    <div style="text-align:center;padding:24px 0 16px;">
      <h1 style="margin:0;font-size:20px;">سالكة</h1>
      <p style="margin:4px 0 0;color:#888;font-size:13px;">فاتورة طلب #${esc(order.id)}</p>
    </div>
    <div style="background:#f7f9f9;border-radius:12px;padding:16px 20px;margin-bottom:16px;">
      <p style="margin:0 0 4px;font-size:14px;"><b>${esc(order.restaurant_name)}</b></p>
      <p style="margin:0;font-size:12px;color:#888;">${esc(new Date(order.created_at).toLocaleString("ar-EG"))}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px;">
      ${itemRows}
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${row("المنتجات", order.subtotal)}
      ${row("التوصيل", order.delivery_fee)}
      ${row("رسوم الخدمة", order.service_fee)}
      ${order.wallet_used > 0 ? row("من رصيدك", "-" + order.wallet_used) : ""}
      <tr><td colspan="2" style="border-top:1px solid #ddd;padding-top:8px;"></td></tr>
      ${row("الإجمالي", order.total, true)}
    </table>
    <p style="text-align:center;color:#aaa;font-size:11px;margin-top:24px;">تم التوصيل بنجاح. شكرًا لطلبك من سالكة</p>
  </div>`
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

  const expectedSecret = Deno.env.get("PUSH_WEBHOOK_SECRET")
  const gotSecret = req.headers.get("x-webhook-secret")
  if (!expectedSecret || gotSecret !== expectedSecret) {
    return json({ error: "invalid_webhook_secret" }, 401)
  }

  try {
    // Receipt sending stays deliberately off until both the Resend key and the
    // gosalka.com sending domain are verified. A disabled integration is a
    // normal no-op; a supposedly enabled integration with no key remains a
    // visible 503 configuration error.
    if (Deno.env.get("RECEIPT_EMAIL_ENABLED") !== "true") {
      return json({ ok: true, skipped: "receipt_email_disabled" })
    }

    const resendKey = Deno.env.get("RESEND_API_KEY")
    // Was HTTP 200. The caller is a Postgres trigger via pg_net, which only
    // inspects status codes -- so if RESEND_API_KEY is unset or rotated, every
    // customer receipt silently stops being sent and nothing anywhere surfaces
    // it. "no customer" and "no email on file" below are genuinely fine and stay
    // 200; a missing key is a misconfiguration and must be distinguishable.
    if (!resendKey) {
      console.error("[send-receipt-email] not_configured: RESEND_API_KEY is unset")
      return json({ error: "not_configured" }, 503)
    }

    let body: any
    try { body = await req.json() } catch { return json({ error: "invalid_json" }, 400) }
    const { order_id } = body
    if (!order_id) return json({ error: "order_id_required" }, 400)

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const { data: order } = await admin.from("orders")
      .select("id, created_at, subtotal, delivery_fee, service_fee, wallet_used, total, customer_id, restaurants(name)")
      .eq("id", order_id).maybeSingle()
    if (!order) return json({ error: "order_not_found" }, 404)
    if (!order.customer_id) return json({ error: "no_customer_no_receipt" }, 200)

    const { data: customer } = await admin.from("customers").select("email, name").eq("id", order.customer_id).maybeSingle()
    if (!customer?.email) return json({ error: "no_email_no_receipt" }, 200)

    const { data: items } = await admin.from("order_items")
      .select("name, qty, total, size_name, combo_name, addon_names").eq("order_id", order_id)

    const html = buildInvoiceHtml(
      { ...order, restaurant_name: (order as any).restaurants?.name ?? "" },
      items ?? []
    )

    const sendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "سالكة <receipts@gosalka.com>",
        to: customer.email,
        subject: `فاتورة طلبك #${order.id} من سالكة`,
        html
      })
    })
    const sendData = await sendRes.json().catch(() => null)
    if (!sendRes.ok) {
      // sendData was forwarded verbatim, exposing the provider's raw response.
      console.error("[send-receipt-email] resend_failed:", sendData)
      return json({ error: "resend_failed" }, 502)
    }

    return json({ ok: true })
  } catch (e) {
    console.error("send-receipt-email unhandled error:", e)
    return json({ error: "internal_error" }, 500)
  }
})
