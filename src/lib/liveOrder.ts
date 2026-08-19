// The order token was never persisted anywhere. Checkout did
// nav(`/track/${token}`) and that was the end of it: the token existed only in
// the URL, so a guest who closed the tab had no route back to their own order,
// and the home screen had no idea an order was in flight.
//
// One key, written at checkout and cleared the moment the order reaches a
// terminal state. Home reads it synchronously -- so a visitor with nothing in
// flight, which is almost every visit, costs ZERO network. Only a stored token
// triggers a lookup.
const KEY = 'salka_live_order'

export interface LiveOrderRef { token: string; at: number }

// A token older than this is not worth a request. Nothing on this platform
// takes twelve hours, and a stale key would otherwise poll forever on a device
// whose owner never came back.
const MAX_AGE_MS = 12 * 60 * 60 * 1000

export function rememberLiveOrder(token: string): void {
  try { localStorage.setItem(KEY, JSON.stringify({ token, at: Date.now() })) }
  catch { /* private mode */ }
}

export function readLiveOrder(): LiveOrderRef | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as LiveOrderRef
    if (typeof v?.token !== 'string' || !v.token) { forgetLiveOrder(); return null }
    if (Date.now() - (v.at ?? 0) > MAX_AGE_MS) { forgetLiveOrder(); return null }
    return v
  } catch { return null }
}

export function forgetLiveOrder(): void {
  try { localStorage.removeItem(KEY) } catch { /* private mode */ }
}

// Terminal in the sense that matters here: nothing further will happen that the
// customer needs the home screen to tell them about.
export const LIVE_ORDER_DONE = ['Delivered', 'Cancelled', 'Failed_Delivery']
