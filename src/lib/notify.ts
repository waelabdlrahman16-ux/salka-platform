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

  showNotification(title, body)
}

/**
 * Why this is not just `new Notification(title, { body })`.
 *
 * That is what it used to be, and it is the whole reason notifications fired on
 * a laptop and never on an Android phone. Chrome on Android does not implement
 * the Notification *constructor* at all -- it throws
 *
 *     TypeError: Failed to construct 'Notification': Illegal constructor.
 *                Use ServiceWorkerRegistration.showNotification() instead.
 *
 * on every call, on every Chrome for Android since 42, in a tab and in an
 * installed home-screen app alike. Desktop Chrome does implement it, so the
 * same line looked healthy on the machine it was written on. The old `catch {}`
 * swallowed the TypeError, so there was nothing in the console either: the beep
 * played, no banner appeared, and nothing said why.
 *
 * So: go through the service worker, which is the only supported path on
 * Android and works everywhere else too. `sw.js` is already registered at the
 * origin root from main.tsx, so `.ready` resolves on every platform we ship to.
 * The constructor stays as a last-resort fallback for the case where no worker
 * ever registers (private windows, some embedded webviews).
 *
 * `tag` collapses repeats: two orders eight seconds apart should replace one
 * banner, not stack two. `renotify` re-alerts anyway, because a silently
 * replaced banner is the same as no banner to a driver looking at the road.
 */
function showNotification(title: string, body: string) {
  if (typeof window === 'undefined') return
  if (!('Notification' in window) || Notification.permission !== 'granted') return

  const options: NotificationOptions = {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'salka-work',
    // Not in the TS DOM lib yet, but honoured by Chrome on Android.
    ...({ renotify: true } as object),
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(title, options))
      .catch(() => fallbackNotification(title, options))
    return
  }
  fallbackNotification(title, options)
}

function fallbackNotification(title: string, options: NotificationOptions) {
  try {
    new Notification(title, options)
  } catch (e) {
    // Android reaches here only when the service worker never became ready.
    // Log it -- the previous silent catch is what hid this for a week.
    console.warn('notification failed', e)
  }
}

export function askNotificationPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  } catch { /* unsupported */ }
}
