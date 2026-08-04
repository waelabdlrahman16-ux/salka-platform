// Free, no external service: browser notification + beep when new work arrives.
import { getAudioContext } from './audioUnlock'

let prev: Record<string, number> = {}
const seenIds: Record<string, Set<number>> = {}

export function ping(key: string, count: number, title: string, body: string) {
  const last = prev[key]
  prev[key] = count
  if (last === undefined || count <= last) return
  alert_(title, body)
}

// Count-based ping is blind to churn: if one order is claimed by another driver
// and a different one appears in the same poll window, the count is unchanged
// and nobody is alerted. Track identities instead and fire on genuinely new ids.
//
// The first call seeds the baseline without alerting, so opening the app does
// not immediately buzz for orders that were already sitting in the pool -- pass
// `alertOnFirstSeen` when you do want that (the driver has just arrived and
// should know there is work).
export function pingIds(
  key: string,
  ids: number[],
  title: string,
  body: string,
  alertOnFirstSeen = false
) {
  const known = seenIds[key]
  const incoming = new Set(ids)

  if (!known) {
    seenIds[key] = incoming
    if (alertOnFirstSeen && ids.length > 0) alert_(title, body)
    return
  }

  const fresh = ids.filter(x => !known.has(x))
  seenIds[key] = incoming
  if (fresh.length > 0) alert_(title, body)
}

export function resetPingState(key: string) {
  delete seenIds[key]
  delete prev[key]
}

function alert_(title: string, body: string) {
  try {
    const ctx = getAudioContext()
    const osc = ctx.createOscillator(); const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.value = 880; gain.gain.value = 0.15
    osc.start(); osc.stop(ctx.currentTime + 0.18)
  } catch { /* audio blocked until first tap - fine */ }

  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  } catch { /* unsupported */ }
}

export function askNotificationPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  } catch { /* unsupported */ }
}
