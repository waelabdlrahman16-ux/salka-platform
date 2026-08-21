import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// The service fee is owned by the server. private.service_fee_for() reads
// settings.service_fee_percent and settings.service_fee_max_egp and computes
//   service_fee := least(round(subtotal * pct / 100), max)
// ignoring anything the client thinks the fee is.
//
// The ceiling matters as much as the percentage: at 8% with a 199 EGP cap, a
// 5,000 EGP هنجبلك order is charged 199, and a client that mirrored only the
// percentage would display 400 and be billed 199 -- the same class of drift as
// hardcoding the percentage, just in the customer's favour instead of ours.
//
// CartPage and CheckoutPage used to hardcode `Math.round(subtotal * 0.02)`.
// That was invisible for as long as the setting also said 2, and became a
// silent overcharge the moment an admin changed it: at service_fee_percent=15
// a 500 EGP order displayed 10 EGP of service fee and was billed 75.
//
// This is the same failure that lib/deliveryFee.ts caused for delivery pricing,
// and it is fixed the same way -- ask the server, and show nothing until it
// answers. Never mirror server pricing in the client.

const PCT_KEY = 'service_fee_percent'
const MAX_KEY = 'service_fee_max_egp'

/** The whole server-side fee policy. Both halves, or neither. */
export type ServiceFeePolicy = { pct: number; max: number }

// A session-lifetime cache was fine for a browser tab. It is NOT fine for a
// Capacitor WebView, whose session lasts days -- and the driver/customer app is
// one now. An admin raising service_fee_percent mid-day left every warm session
// quoting the old number and being billed the new one, which is exactly the
// client/server drift this whole module exists to prevent, reintroduced one
// layer down as a cache lifetime.
const TTL_MS = 5 * 60 * 1000

let cache: ServiceFeePolicy | null = null
let cachedAt = 0
let inflight: Promise<ServiceFeePolicy | null> | null = null

export async function fetchServiceFeePolicy(): Promise<ServiceFeePolicy | null> {
  if (cache !== null && Date.now() - cachedAt < TTL_MS) return cache
  if (inflight) return inflight

  const request = (async () => {
    const { data, error } = await supabase
      .from('settings')
      .select('key,value')
      .in('key', [PCT_KEY, MAX_KEY])
    if (error || !data) return null

    const read = (key: string) => {
      const row = data.find(r => r.key === key)
      return row ? Number(row.value) : null
    }
    const pct = read(PCT_KEY)
    const max = read(MAX_KEY)

    // Both rows are CLASS A required and undeletable, and service_fee_for()
    // raises rather than guessing if either is missing. So a missing row here is
    // not "charge nothing" -- it is a checkout that will fail server-side, and
    // showing a number for it would be a lie. Unknown, not zero.
    if (pct === null || !Number.isFinite(pct) || pct < 0) return null
    if (max === null || !Number.isFinite(max) || max < 0) return null

    cache = { pct, max }
    cachedAt = Date.now()
    return cache
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
 * Mirrors private.service_fee_for() exactly:
 *   least(round(subtotal * pct / 100), max)
 * Returns null when the policy is not known yet -- callers must not substitute
 * 0 or a guess.
 */
export function serviceFeeFor(subtotal: number, policy: ServiceFeePolicy | null): number | null {
  if (policy === null) return null
  return Math.min(Math.round((Math.max(subtotal, 0) * policy.pct) / 100), policy.max)
}

export type UseServiceFeePolicy = {
  /** the server's fee policy, or null while unknown -- never fall back to a guess */
  policy: ServiceFeePolicy | null
  loading: boolean
  failed: boolean
  retry: () => void
}

export function useServiceFeePolicy(): UseServiceFeePolicy {
  const [policy, setPolicy] = useState<ServiceFeePolicy | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setFailed(false)
    fetchServiceFeePolicy().then(result => {
      if (cancelled) return
      setPolicy(result)
      setFailed(result === null)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [attempt])

  return {
    policy,
    loading,
    failed,
    retry: () => { clearServiceFeeCache(); setAttempt(a => a + 1) }
  }
}
