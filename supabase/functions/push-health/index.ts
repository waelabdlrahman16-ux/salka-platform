import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// DIAGNOSTIC ONLY. Sends nothing.
//
// FCM's HTTP v1 API accepts `validate_only: true`, which runs the full
// validation path -- including whether the registration token is still
// registered -- and returns the same errors a real send would, without
// delivering anything. So this can tell you which of your stored tokens are
// dead at 2pm on a trading day without buzzing a single driver mid-delivery.
//
// Reads push_tokens itself with the service role and reports per token.

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input)
  let str = ""
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function getAccessToken(sa: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  }
  const signInput = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(claim))}`
  const pem = (sa.private_key as string)
    .replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s/g, "")
  const keyBytes = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey("pkcs8", keyBytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"])
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signInput))
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signInput}.${base64url(sig)}`,
    }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.access_token) throw new Error(`oauth_failed ${res.status} ${JSON.stringify(data)}`)
  return data.access_token as string
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("PUSH_WEBHOOK_SECRET")
  if (!expected || req.headers.get("x-webhook-secret") !== expected) {
    return new Response(JSON.stringify({ error: "invalid_webhook_secret" }), { status: 401 })
  }

  const saJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON")
  if (!saJson) return new Response(JSON.stringify({ error: "not_configured" }), { status: 200 })
  const sa = JSON.parse(saJson)

  const url = Deno.env.get("SUPABASE_URL")
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !srk) return new Response(JSON.stringify({ error: "no_db_access" }), { status: 200 })

  const rowsRes = await fetch(`${url}/rest/v1/push_tokens?select=id,profile_id,token,platform,updated_at`, {
    headers: { apikey: srk, Authorization: `Bearer ${srk}` },
  })
  const rows = await rowsRes.json()
  if (!Array.isArray(rows)) {
    return new Response(JSON.stringify({ error: "read_failed", detail: rows }), { status: 200 })
  }

  let accessToken: string
  try { accessToken = await getAccessToken(sa) }
  catch (e) { return new Response(JSON.stringify({ error: "oauth_failed", detail: String(e) }), { status: 200 }) }

  const out: unknown[] = []
  for (const r of rows) {
    let status = 0, errCode = "", ok = false
    try {
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          // validate_only -- nothing is delivered.
          body: JSON.stringify({
            validate_only: true,
            message: { token: r.token, data: { probe: "1" } },
          }),
        })
      status = res.status
      ok = res.ok
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        errCode = j?.error?.details?.[0]?.errorCode || j?.error?.status || j?.error?.message || ""
      }
    } catch (e) { errCode = String(e) }
    out.push({
      id: r.id, profile_id: r.profile_id, platform: r.platform,
      updated_at: r.updated_at, tokenPrefix: String(r.token).slice(0, 12) + "...",
      alive: ok, status, errCode,
    })
  }
  return new Response(JSON.stringify({ checked: out.length, results: out }, null, 2),
    { headers: { "Content-Type": "application/json" } })
})
