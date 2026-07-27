import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// NOTE (security): this function has verify_jwt=false, meaning it is
// publicly callable with no authentication at all. It only exposes a
// truncated access-token prefix and Fawaterak's own payment-methods
// response, not secrets directly — but it does let anyone trigger OAuth
// calls against our Fawaterak credentials. This was built as a one-time
// diagnostic to discover which payment methods are enabled on the account.
// Recommend deleting this function (or flipping verify_jwt to true and
// adding an is_admin() check) once that's confirmed — it has no ongoing
// purpose after Fawaterak activation is complete.

Deno.serve(async () => {
  const clientId = Deno.env.get("FAWATERAK_CLIENT_ID")
  const clientSecret = Deno.env.get("FAWATERAK_CLIENT_SECRET")
  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: "secrets_not_set_yet" }), { status: 500 })
  }

  const tokenRes = await fetch("https://app.fawaterk.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret })
  })
  const tokenData = await tokenRes.json().catch(() => null)
  if (!tokenRes.ok || !tokenData?.access_token) {
    return new Response(JSON.stringify({ step: "oauth", status: tokenRes.status, body: tokenData }), { status: 502 })
  }

  const methodsRes = await fetch("https://app.fawaterk.com/api/v2/getPaymentmethods", {
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tokenData.access_token}` }
  })
  const methodsData = await methodsRes.json().catch(() => null)

  return new Response(JSON.stringify({
    oauth_ok: true,
    oauth_token_type: tokenData.token_type ?? null,
    oauth_expires_in: tokenData.expires_in ?? null,
    oauth_scope: tokenData.scope ?? null,
    access_token_prefix: (tokenData.access_token as string).slice(0, 12) + '...',
    step: "getPaymentmethods", status: methodsRes.status, body: methodsData
  }, null, 2), {
    headers: { "Content-Type": "application/json" }
  })
})
