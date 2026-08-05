import { useEffect, useState } from 'react'
import { supabase } from './supabase'

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
  sla_minutes: number
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

const cache = new Map<number, { at: number; quote: DeliveryQuote }>()
const inflight = new Map<number, Promise<DeliveryQuote | null>>()

export async function fetchDeliveryQuote(compoundId: number): Promise<DeliveryQuote | null> {
  const cached = cache.get(compoundId)
  if (cached && Date.now() - cached.at < TTL_MS) return cached.quote

  const pending = inflight.get(compoundId)
  if (pending) return pending

  const request = (async () => {
    const { data, error } = await supabase.rpc('delivery_quote', { p_compound_id: compoundId })
    if (error || !data) return null
    const quote = data as DeliveryQuote
    cache.set(compoundId, { at: Date.now(), quote })
    return quote
  })()

  inflight.set(compoundId, request)
  try {
    return await request
  } finally {
    inflight.delete(compoundId)
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

export function useDeliveryQuote(compoundId: number | null | undefined): UseDeliveryQuote {
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
    fetchDeliveryQuote(compoundId).then(result => {
      if (cancelled) return
      setQuote(result)
      setFailed(result === null)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [compoundId, attempt])

  return {
    quote,
    fee: quote ? quote.delivery_fee : null,
    loading,
    failed,
    retry: () => {
      if (compoundId) cache.delete(compoundId)
      setAttempt(a => a + 1)
    }
  }
}
