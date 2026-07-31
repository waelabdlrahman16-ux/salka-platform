import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Sends push notifications via FCM HTTP v1 (the legacy server-key API was
// fully sunset by Google -- this service-account + OAuth approach is the
// only supported path now, for both Android and iOS devices registered
// through Firebase).
//
// Called two ways:
//  - by Postgres triggers (notify_order_status_change, notify_new_order)
//    via pg_net, authenticated with a shared secret (not a Supabase JWT,
//    since the caller is the database itself)
//  - never by the frontend directly
//
// Best-effort by design: if FCM_SERVICE_ACCOUNT_JSON isn't set yet (push
// hasn't been configured), this returns 200/not_configured rather than an
// error, so it never blocks the underlying order update that triggered it.

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input)
  let str = ""
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function getAccessToken(serviceAccount: any): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" }
  const now = Math.floor(Date.now() / 1000)
  const claim = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }
  const signInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`

  const pem = (serviceAccount.private_key as string)
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "")
  const keyBytes = Uint8Array.from(atob(pem), c => c.charCodeAt(0))

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyBytes.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  )
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(signInput))
  const jwt = `${signInput}.${base64url(signature)}`

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.access_token) throw new Error(`oauth_failed: ${res.status} ${JSON.stringify(data)}`)
  return data.access_token as string
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 })

  const expectedSecret = Deno.env.get("PUSH_WEBHOOK_SECRET")
  const gotSecret = req.headers.get("x-webhook-secret")
  if (!expectedSecret || gotSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "invalid_webhook_secret" }), { status: 401 })
  }

  const saJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON")
  if (!saJson) {
    return new Response(JSON.stringify({ error: "not_configured" }), { status: 200 })
  }

  let body: any
  try { body = await req.json() } catch { return new Response("invalid_json", { status: 400 }) }
  const { tokens, title, body: msgBody, data } = body
  if (!Array.isArray(tokens) || tokens.length === 0 || !title) {
    return new Response(JSON.stringify({ error: "tokens_and_title_required" }), { status: 400 })
  }

  let serviceAccount: any
  try { serviceAccount = JSON.parse(saJson) } catch {
    return new Response(JSON.stringify({ error: "bad_service_account_json" }), { status: 500 })
  }

  let accessToken: string
  try {
    accessToken = await getAccessToken(serviceAccount)
  } catch (e) {
    return new Response(JSON.stringify({ error: "oauth_failed", detail: String(e) }), { status: 502 })
  }

  const results: unknown[] = []
  for (const token of tokens) {
    try {
      const fwRes = await fetch(
        `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${accessToken}` },
          body: JSON.stringify({
            message: {
              token,
              notification: { title, body: msgBody },
              data: data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) : undefined
            }
          })
        }
      )
      results.push({ tokenPrefix: String(token).slice(0, 12) + "...", ok: fwRes.ok, status: fwRes.status })
    } catch (e) {
      // one bad/malformed token shouldn't abort delivery to the rest of the batch
      results.push({ tokenPrefix: String(token).slice(0, 12) + "...", ok: false, error: String(e) })
    }
  }

  return new Response(JSON.stringify({ results }), { headers: { "Content-Type": "application/json" } })
})
