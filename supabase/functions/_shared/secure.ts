// Shared helpers for the edge functions.
//
// The repo is public, so every constant in here is known to an attacker. That is
// fine for the CSPRNG (its security is in the entropy, not the alphabet) but it
// is exactly why Math.random() was not fine: a non-cryptographic PRNG with a
// published alphabet, prefix and length is guessable.

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"   // no I or O
const LOWER = "abcdefghijkmnpqrstuvwxyz"   // no l
const DIGIT = "23456789"                   // no 0 or 1
const SYMBOL = "!@#$%*-_=+"
const ALL = UPPER + LOWER + DIGIT + SYMBOL

/**
 * Uniform random index into `max` using rejection sampling. Taking
 * `value % max` directly would bias toward the low end of the alphabet, since
 * 256 is not generally a multiple of max.
 */
function uniformIndex(max: number): number {
  // Guard the shared helper: max <= 0 makes `limit` NaN and max > 256 makes it
  // 0, either of which spins crypto.getRandomValues forever inside a request.
  if (!Number.isInteger(max) || max <= 0 || max > 256) {
    throw new RangeError(`uniformIndex: max must be an integer in 1..256, got ${max}`)
  }
  const limit = Math.floor(256 / max) * max
  const buf = new Uint8Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < limit) return buf[0] % max
  }
}

function pick(alphabet: string): string {
  return alphabet[uniformIndex(alphabet.length)]
}

function shuffle(chars: string[]): string[] {
  // Fisher-Yates with a CSPRNG source.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = uniformIndex(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars
}

/**
 * The previous generator hardcoded a "Sk9-" prefix, which incidentally
 * guaranteed one uppercase, one lowercase, one digit and one symbol in every
 * password. Dropping the prefix dropped that guarantee: a plain draw from a
 * 56-char alphabet with no symbols produced no digit 11.6% of the time
 * (measured) and no symbol 100% of the time, so under a Supabase password
 * policy requiring digits roughly one staff-account creation in nine failed
 * intermittently, and under one requiring symbols every single one failed.
 * Seed one character from each class, fill the rest, then shuffle.
 */
export function securePassword(length = 16): string {
  if (length < 8) throw new RangeError("securePassword: length must be >= 8")
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)]
  while (chars.length < length) chars.push(pick(ALL))
  return shuffle(chars).join("")
}

/**
 * Six-digit OTP in 100000..999999. Deliberately avoids a leading zero: the code
 * column is text so storage is fine, but SMS Misr's OTP template substitutes
 * `otp` into a message and we have no guarantee it does not numeric-normalise
 * it. A stripped leading zero would deliver five digits to a screen whose submit
 * button requires six, making login impossible for ~10% of codes.
 */
export function secureOtpCode(): string {
  let s = String(1 + uniformIndex(9)) // 1..9, so never a leading zero
  for (let i = 0; i < 5; i++) s += String(uniformIndex(10))
  return s
}

export function secureSlugFallback(): string {
  const buf = new Uint8Array(4)
  crypto.getRandomValues(buf)
  return Array.from(buf, b => b.toString(16).padStart(2, "0")).join("")
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
