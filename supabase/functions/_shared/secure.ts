// Shared helpers for the edge functions.
//
// The repo is public, so every constant in here is known to an attacker. That is
// fine for the CSPRNG (its security is in the entropy, not the alphabet) but it
// is exactly why Math.random() was not fine: a non-cryptographic PRNG with a
// published alphabet, prefix and length is guessable.

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"

/**
 * Uniform random index into `max` using rejection sampling. Taking
 * `value % max` directly would bias toward the low end of the alphabet, since
 * 256 is not a multiple of 56.
 */
function uniformIndex(max: number): number {
  const limit = Math.floor(256 / max) * max
  const buf = new Uint8Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < limit) return buf[0] % max
  }
}

export function securePassword(length = 12): string {
  let s = ""
  for (let i = 0; i < length; i++) s += PASSWORD_ALPHABET[uniformIndex(PASSWORD_ALPHABET.length)]
  return s
}

/** Cryptographically random n-digit numeric code, zero-padded. */
export function secureNumericCode(digits = 6): string {
  let s = ""
  for (let i = 0; i < digits; i++) s += String(uniformIndex(10))
  return s
}

export function secureSlugFallback(): string {
  const buf = new Uint8Array(4)
  crypto.getRandomValues(buf)
  return Array.from(buf, b => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Best-effort client IP. Supabase sits behind a proxy, so the left-most entry of
 * x-forwarded-for is the client. It is spoofable, which is why it is used only
 * to *widen* rate limiting (an extra bucket alongside the per-phone one), never
 * to relax it.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0].trim()
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "unknown"
}

/**
 * check_rate_limit() raises 'rate_limited' when the bucket is full. Any other
 * error -- function missing, permission denied, connection lost -- is NOT a rate
 * limit, and reporting it as one told the user to "wait and try again" about a
 * problem that waiting cannot fix.
 */
export function isRateLimitError(err: { message?: string } | null): boolean {
  return !!err?.message?.includes("rate_limited")
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  })
}

/**
 * Log the detail server-side, return only the code. Raw Postgres and provider
 * messages expose schema names, constraint names and provider internals, and
 * they were being handed straight to the client in a `detail` field.
 */
export function fail(fn: string, code: string, status: number, detail?: unknown) {
  if (detail !== undefined) console.error(`[${fn}] ${code}:`, detail)
  return json({ error: code }, status)
}
