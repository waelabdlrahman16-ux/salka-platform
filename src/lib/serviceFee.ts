import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// The service fee percentage is owned by the server. place_order reads
// settings.service_fee_percent and computes
//   service_fee := round(subtotal * pct / 100)
// ignoring anything the client thinks the fee is.
//
// CartPage and CheckoutPage used to hardcode `Math.round(subtotal * 0.02)`.
// That was invisible for as long as the setting also said 2, and became a
// silent overcharge the moment an admin changed it: at service_fee_percent=15
// a 500 EGP order displayed 10 EGP of service fee and was billed 75.
//
// This is the same failure that lib/deliveryFee.ts caused for delivery pricing,
// and it is fixed the same way -- ask the server, and show nothing until it
// answers. Never mirror server pricing in the client.

const SETTING_KEY = 'service_fee_percent'

let cache: number | null = null
let inflight: Promise<number | null> | null = null

export async function fetchServiceFeePct(): Promise<number | null> {
  if (cache !== null) return cache
  if (inflight) return inflight

  const request = (async () => {
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', SETTING_KEY)
      .maybeSingle()
    if (error) return null
    // A missing row is a real answer: place_order coalesces it to 0, so 0 is
    // what the customer will actually be charged. Only a failed read is null.
    if (!data) { cache = 0; return 0 }
    const pct = Number(data.value)
    if (!Number.isFinite(pct) || pct < 0) return null
    cache = pct
    return pct
  })()

  inflight = request
  try {
    return await request
  } finally {
    inflight = null
  }
}

export function clearServiceFeeCache() {
  cache = null
}

/**
 * Mirrors the server's arithmetic exactly:
 *   round(subtotal * pct / 100)
 * Returns null when the percentage is not known yet -- callers must not
 * substitute 0 or a guess.
 */
export function serviceFeeFor(subtotal: number, pct: number | null): number | null {
  if (pct === null) return null
  return Math.round((subtotal * pct) / 100)
}

export type UseServiceFeePct = {
  /** percentage, or null while unknown -- never fall back to a guess */
  pct: number | null
  loading: boolean
  failed: boolean
  retry: () => void
}

export function useServiceFeePct(): UseServiceFeePct {
  const [pct, setPct] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setFailed(false)
    fetchServiceFeePct().then(result => {
      if (cancelled) return
      setPct(result)
      setFailed(result === null)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [attempt])

  return {
    pct,
    loading,
    failed,
    retry: () => { clearServiceFeeCache(); setAttempt(a => a + 1) }
  }
}
