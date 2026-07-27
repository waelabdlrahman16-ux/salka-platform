import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Public endpoint — Fawaterak's servers call this directly, so there's no
// Supabase JWT to check. Security instead comes from verifying hashKey, an
// HMAC-SHA256 of the invoice fields signed with our Fawaterak vendor key.
// This must exactly match Fawaterak's documented PHP reference implementation:
//   queryParam = "InvoiceId={id}&InvoiceKey={key}&PaymentMethod={method}"
//   hash = hash_hmac('sha256', queryParam, vendorKey, false)  // hex digest

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("")
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response("invalid_json", { status: 400 })
  }

  const { hashKey, invoice_id, invoice_key, payment_method, invoice_status } = body
  let payLoad = body.pay_load
  if (typeof payLoad === "string") {
    try { payLoad = JSON.parse(payLoad) } catch { payLoad = null }
  }

  const vendorKey = Deno.env.get("FAWATERAK_VENDOR_KEY")
  if (!vendorKey) return new Response("not_configured", { status: 500 })

  if (!hashKey || !invoice_id || !invoice_key || !payment_method) {
    return new Response("missing_fields", { status: 400 })
  }

  const queryParam = `InvoiceId=${invoice_id}&InvoiceKey=${invoice_key}&PaymentMethod=${payment_method}`
  const expected = await hmacSha256Hex(vendorKey, queryParam)

  if (!timingSafeEqual(expected, String(hashKey))) {
    return new Response("invalid_signature", { status: 401 })
  }

  // Only the "paid" webhook activates an order. Failed/expired webhooks are
  // acknowledged but don't need action — the order just stays in
  // 'awaiting_payment' and the customer can retry.
  if (invoice_status !== "paid") {
    return new Response("ok", { status: 200 })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  let orderId: number | null = null
  if (payLoad && typeof payLoad === "object" && payLoad.order_id) {
    orderId = Number(payLoad.order_id)
  } else {
    const { data } = await supabase
      .from("orders")
      .select("id")
      .eq("fawaterak_invoice_id", String(invoice_id))
      .maybeSingle()
    orderId = data?.id ?? null
  }

  if (!orderId) return new Response("order_not_found", { status: 404 })

  const { error } = await supabase.rpc("activate_paid_order", { p_order_id: orderId })
  if (error) return new Response("activation_failed", { status: 500 })

  return new Response("ok", { status: 200 })
})
