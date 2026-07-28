import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Creates a Fawaterak hosted-payment invoice for an order that's already been
// placed (via place_order with p_payment_method='online') and is sitting in
// 'awaiting_payment' — it never enters the driver pool until the webhook
// confirms payment and calls activate_paid_order().
//
// Auth: this account uses OAuth2 client_credentials (not the older static
// Bearer API key some Fawaterak docs describe) — we exchange
// FAWATERAK_CLIENT_ID/SECRET at the token URL for a short-lived access token,
// then use that as the Bearer token for the invoice-creation call.

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

async function getAccessToken(): Promise<string> {
  const clientId = Deno.env.get("FAWATERAK_CLIENT_ID")
  const clientSecret = Deno.env.get("FAWATERAK_CLIENT_SECRET")
  if (!clientId || !clientSecret) throw new Error("fawaterak_oauth_not_configured")

  const res = await fetch("https://app.fawaterk.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret
    })
  })

  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.access_token) {
    throw new Error(`oauth_token_failed: ${res.status} ${JSON.stringify(data)}`)
  }
  return data.access_token as string
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

  let order_id: number
  try {
    const body = await req.json()
    order_id = Number(body.order_id)
    if (!order_id) throw new Error()
  } catch {
    return json({ error: "order_id_required" }, 400)
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  const { data: order, error } = await supabase
    .from("orders")
    .select("id, total, customer_name, customer_phone, zone, status, public_token")
    .eq("id", order_id)
    .single()

  if (error || !order) return json({ error: "order_not_found" }, 404)
  if (order.status !== "awaiting_payment") return json({ error: "order_not_awaiting_payment" }, 400)

  let accessToken: string
  try {
    accessToken = await getAccessToken()
  } catch (e) {
    return json({ error: "oauth_failed", detail: String(e) }, 502)
  }

  const nameParts = (order.customer_name || "Customer").trim().split(/\s+/)
  const first_name = nameParts[0] || "Customer"
  const last_name = nameParts.slice(1).join(" ") || first_name

  // NOTE: SITE_URL should be set in Supabase project secrets (Edge Functions ->
  // Secrets) to https://app.gosalka.com. The fallback below is just a safety
  // net so this never throws if that secret is missing.
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://app.gosalka.com"
  const trackUrl = `${siteUrl}/track/${order.public_token}`

  const fwRes = await fetch("https://app.fawaterk.com/api/v2/createInvoiceLink", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      cartTotal: String(order.total),
      currency: "EGP",
      customer: {
        first_name,
        last_name,
        phone: order.customer_phone,
        address: order.zone || "Ain Sokhna"
      },
      cartItems: [
        { name: `طلب سالكة #${order.id}`, price: String(order.total), quantity: "1" }
      ],
      payLoad: { order_id: order.id },
      redirectionUrls: {
        successUrl: trackUrl,
        failUrl: trackUrl,
        pendingUrl: trackUrl
      }
    })
  })

  const fwData = await fwRes.json().catch(() => null)

  if (!fwRes.ok || !fwData || fwData.status !== "success") {
    return json({ error: "fawaterak_error", detail: fwData, httpStatus: fwRes.status }, 502)
  }

  await supabase.from("orders").update({
    fawaterak_invoice_id: String(fwData.data.invoiceId),
    fawaterak_invoice_key: fwData.data.invoiceKey
  }).eq("id", order_id)

  return json({ url: fwData.data.url })
})
