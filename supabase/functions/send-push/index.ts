import "jsr:@supabase/functions-js/edge-runtime.d.ts"

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input)
  let str = ""
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function getAccessToken(serviceAccount: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const claim = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600
  }
  const signInput = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(claim))}`
  const pem = (serviceAccount.private_key as string)
    .replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s/g, "")
  const keyBytes = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyBytes.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"])
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(signInput))
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signInput}.${base64url(signature)}`
    })
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.access_token) throw new Error(`oauth_failed: ${res.status} ${JSON.stringify(data)}`)
  return data.access_token as string
}

const APP_ORIGIN = "https://app.gosalka.com"
const ANDROID_CHANNEL = "salka_orders"

type Platform = "web" | "android" | "ios"
type Target = { token: string; platform: Platform }

function toTarget(raw: unknown): Target | null {
  if (typeof raw === "string") return raw ? { token: raw, platform: "web" } : null
  if (raw && typeof raw === "object") {
    const t = (raw as any).token
    const p = (raw as any).platform
    if (typeof t === "string" && t) {
      return { token: t, platform: p === "android" || p === "ios" ? p : "web" }
    }
  }
  return null
}

async function recordResult(
  supabaseUrl: string, serviceKey: string,
  token: string, ok: boolean, status: number, errCode: string, title: string,
) {
  try {
    await fetch(`${supabaseUrl}/rest/v1/rpc/record_push_result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        p_token: token, p_ok: ok, p_status: status, p_err_code: errCode, p_title: title,
      }),
    })
  } catch (_e) { /* bookkeeping must never break delivery for tokens that work */ }
}

// WHICH BANNERS STICK, AND WHY IT IS DERIVED RATHER THAN PASSED.
//
// A vendor or a rider must not be able to miss an alert by glancing away: their
// banner stays on screen until they act on it (requireInteraction in the service
// worker). A customer must NOT get that -- a notification they cannot dismiss,
// about an order they cannot speed up, is a reason to uninstall the app.
//
// Staff tokens live in push_tokens. Customer tokens live on orders.push_token.
// So "is this staff?" is a fact already in the database, and reading it here
// means no caller has to remember to pass a flag -- the failure mode of a flag
// is that the one function nobody updated silently gets it wrong, which is
// exactly how the vendor path ended up sending bare tokens for months.
async function staffTokenSet(supabaseUrl: string, serviceKey: string): Promise<Set<string>> {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/push_tokens?select=token`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    })
    const rows = await res.json()
    if (!Array.isArray(rows)) return new Set()
    return new Set(rows.map((r: any) => r.token))
  } catch { return new Set() }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 })

  const expectedSecret = Deno.env.get("PUSH_WEBHOOK_SECRET")
  if (!expectedSecret || req.headers.get("x-webhook-secret") !== expectedSecret) {
    return new Response(JSON.stringify({ error: "invalid_webhook_secret" }), { status: 401 })
  }

  const saJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON")
  if (!saJson) return new Response(JSON.stringify({ error: "not_configured" }), { status: 200 })
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

  let body: any
  try { body = await req.json() } catch { return new Response("invalid_json", { status: 400 }) }
  const { tokens, title, body: msgBody, data, link } = body
  if (!Array.isArray(tokens) || tokens.length === 0 || !title) {
    return new Response(JSON.stringify({ error: "tokens_and_title_required" }), { status: 400 })
  }

  const targets = (tokens as unknown[]).map(toTarget).filter((t): t is Target => t !== null)
  if (targets.length === 0) {
    return new Response(JSON.stringify({ error: "no_usable_tokens" }), { status: 400 })
  }

  let serviceAccount: any
  try { serviceAccount = JSON.parse(saJson) } catch {
    return new Response(JSON.stringify({ error: "bad_service_account_json" }), { status: 500 })
  }

  let accessToken: string
  try { accessToken = await getAccessToken(serviceAccount) }
  catch (e) {
    return new Response(JSON.stringify({ error: "oauth_failed", detail: String(e) }), { status: 502 })
  }

  const staff = (supabaseUrl && serviceKey) ? await staffTokenSet(supabaseUrl, serviceKey) : new Set<string>()

  // WEB IS DATA-ONLY, ON PURPOSE -- with a `notification` block the browser
  // showed either two banners or none, both observed in production. The worker
  // owns the display. ANDROID IS THE OPPOSITE: a data-only message goes to an
  // app process that does not exist when the app is killed, which is exactly
  // when a driver misses an order.
  const baseData: Record<string, string> = {
    title: String(title),
    body: String(msgBody ?? ""),
    link: String(link || APP_ORIGIN),
    ...(data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) : {})
  }

  const tag = baseData.order_id ? `order-${baseData.order_id}` : "salka"

  function messageFor(target: Target) {
    const persist = staff.has(target.token)
    const payloadData = { ...baseData, persist: persist ? "1" : "0" }
    const base: Record<string, unknown> = {
      token: target.token,
      data: payloadData,
      webpush: { headers: { Urgency: "high", TTL: "1800" } },
      android: { priority: "high" }
    }
    if (target.platform === "android") {
      base.android = {
        priority: "high",
        ttl: "1800s",
        notification: {
          title: String(title),
          body: String(msgBody ?? ""),
          channel_id: ANDROID_CHANNEL,
          sound: "default",
          default_vibrate_timings: true,
          notification_priority: "PRIORITY_MAX",
          visibility: "PUBLIC",
          // Staff alerts are sticky: the rider cannot swipe the order away by
          // accident, and it survives until they open the app and act.
          sticky: persist,
          tag
        }
      }
    }
    return base
  }

  const results: unknown[] = []
  for (const target of targets) {
    let status = 0, ok = false, errCode = ""
    try {
      const fwRes = await fetch(
        `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${accessToken}` },
          body: JSON.stringify({ message: messageFor(target) })
        })
      status = fwRes.status
      ok = fwRes.ok
      if (!ok) {
        // UNREGISTERED means the device is gone for good; UNAVAILABLE means try
        // again later. Treating them the same would either keep a dead token
        // forever or throw away a live one during an FCM blip.
        const j = await fwRes.json().catch(() => null)
        errCode = j?.error?.details?.[0]?.errorCode || j?.error?.status || ""
      }
    } catch (e) { errCode = String(e) }

    if (supabaseUrl && serviceKey) {
      await recordResult(supabaseUrl, serviceKey, target.token, ok, status, errCode, String(title))
    }

    results.push({
      tokenPrefix: target.token.slice(0, 12) + "...",
      platform: target.platform, ok, status,
      ...(errCode ? { errCode } : {}),
    })
  }

  return new Response(JSON.stringify({ results }), { headers: { "Content-Type": "application/json" } })
})
