import { useEffect, useState } from 'react'
import { publicCatalog } from './publicCatalog'

// The delivery fee is owned by the server. place_order / submit_custom_order /
// request_pickup all read it from compounds.delivery_fee and ignore whatever the
// client sends, so the ONLY safe way to show a price is to ask.
//
// It is a per-compound number, not a distance band. Do not render distance_km
// next to the fee -- it is still returned because the SLA is derived from it,
// but showing kilometres beside a price tells the customer the price is
// computed from them, which it no longer is.
//
// This deliberately replaces the old lib/deliveryFee.ts, which kept a local copy
// of the pricing formula. That copy silently drifted the moment the server tiers
// changed and quoted customers up to 150 EGP under what they were charged. Never
// mirror server pricing in the client again -- fetch it.

export type DeliveryQuote = {
  compound_id: number
  compound_name: string
  distance_km: number
  delivery_fee: number
  /** Lower bound of the promise: this vendor's prep time PLUS travel. */
  sla_minutes: number
  /** Upper bound. Widens with distance -- see sla_max_minutes() in the DB. */
  sla_max_minutes: number
  /** Both halves, so a screen can explain the number rather than assert it. */
  prep_minutes: number
  travel_minutes: number
}

// Fees change rarely (an admin edits a settings row), so a session-lifetime
// cache is fine and keeps the checkout snappy. inflight dedupes the burst of
// concurrent callers you get when several components mount at once.
// "Session-lifetime" was written for a browser tab. The app is a Capacitor
// WebView now and a session lasts days, so a compound moved from 65 to 120 left
// every warm session quoting 65 while place_order charged 120.
// clearDeliveryQuoteCache() exists and is called from nowhere, so nothing else
// would ever have expired it.
const TTL_MS = 5 * 60 * 1000

// The quote now depends on the VENDOR as well as the compound, because the SLA
// is prep + travel and prep is per vendor -- سوبرماركت takes 45 minutes,
// ماكدونالدز takes 10. Keying the cache on compound alone would have served
// McDonald's 27-minute promise for a supermarket order placed from the same
// address a minute later. Vendor-less lookups (Home, where no single vendor is
// chosen yet) key on 0 and get the server's default-prep answer.
const keyFor = (compoundId: number, restaurantId?: number | null) =>
  `${compoundId}:${restaurantId ?? 0}`

const cache = new Map<string, { at: number; quote: DeliveryQuote }>()
const inflight = new Map<string, Promise<DeliveryQuote | null>>()

export async function fetchDeliveryQuote(
  compoundId: number,
  restaurantId?: number | null,
): Promise<DeliveryQuote | null> {
  const key = keyFor(compoundId, restaurantId)
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < TTL_MS) return cached.quote

  const pending = inflight.get(key)
  if (pending) return pending

  const request = (async () => {
    const result = await publicCatalog<DeliveryQuote | null>('deliveryQuote', {
      compoundId,
      // Defaulted to null server-side, so omitting it stays valid -- but any
      // screen that knows the vendor should pass it, or the customer is quoted
      // the fallback prep instead of the real one.
      restaurantId: restaurantId ?? null,
    })
    if (!result.ok || !result.data) return null
    const quote = result.data
    cache.set(key, { at: Date.now(), quote })
    return quote
  })()

  inflight.set(key, request)
  try {
    return await request
  } finally {
    inflight.delete(key)
  }
}

export function clearDeliveryQuoteCache() {
  cache.clear()
}

export type UseDeliveryQuote = {
  quote: DeliveryQuote | null
  /** fee in EGP, or null while unknown -- never fall back to 0 or a guess */
  fee: number | null
  loading: boolean
  failed: boolean
  retry: () => void
}

export function useDeliveryQuote(
  compoundId: number | null | undefined,
  /** Pass it wherever the vendor is known -- without it the SLA falls back to
   *  the default prep time rather than this kitchen's real one. */
  restaurantId?: number | null,
): UseDeliveryQuote {
  const [quote, setQuote] = useState<DeliveryQuote | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!compoundId) {
      setQuote(null); setLoading(false); setFailed(false)
      return
    }
    let cancelled = false
    setLoading(true); setFailed(false)
    fetchDeliveryQuote(compoundId, restaurantId).then(result => {
      if (cancelled) return
      setQuote(result)
      setFailed(result === null)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [compoundId, restaurantId, attempt])

  return {
    quote,
    fee: quote ? quote.delivery_fee : null,
    loading,
    failed,
    retry: () => {
      // Must delete the SAME key fetch wrote, or "جرب تاني" clears nothing and
      // hands back the identical failed-then-cached state.
      if (compoundId) cache.delete(keyFor(compoundId, restaurantId))
      setAttempt(a => a + 1)
    }
  }
}
