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
export function showNotification(
  title: string,
  body: string,
  extra: { tag?: string; requireInteraction?: boolean } = {},
) {
  if (typeof window === 'undefined') return
  if (!('Notification' in window) || Notification.permission !== 'granted') return

  const options: NotificationOptions = {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    // Default kept as 'salka-work' so the existing poll-based callers behave
    // exactly as before. A push passes `order-<id>` to match what
    // firebase-messaging-sw.js uses, so the same order never shows two banners
    // just because one arrived in the foreground and one in the background.
    tag: extra.tag ?? 'salka-work',
    requireInteraction: extra.requireInteraction ?? false,
    // Not in the TS DOM lib yet, but honoured by Chrome on Android.
    ...({ renotify: true } as object),
  }

  if ('serviceWorker' in navigator) {
    // RACED AGAINST A TIMEOUT, deliberately.
    //
    // `serviceWorker.ready` never rejects. With no registration it stays
    // pending forever -- so a plain `.catch()` here is dead code, and the
    // fallback below could never run. That is not theoretical: main.tsx
    // registers /sw.js inside a `load` handler and swallows the error, so a
    // 404 on sw.js, a storage-blocked context or a private window all leave
    // `ready` hanging. The driver would get the beep, no banner, and nothing
    // in the console -- the exact silent failure this whole file was rewritten
    // to remove, reintroduced one layer down.
    //
    // 1.5s is generous: the worker is registered on page load and these alerts
    // fire minutes later, so on any healthy install it is already active and
    // `ready` resolves in the same tick.
    let settled = false
    const done = () => { settled = true }

    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 1500))
    Promise.race([navigator.serviceWorker.ready, timeout])
      .then(reg => {
        if (!reg) {
          console.warn('notification: service worker not ready in time, using constructor')
          fallbackNotification(title, options)
          return
        }
        done()
        return reg.showNotification(title, options)
      })
      .catch(e => {
        // showNotification() itself can reject (permission revoked mid-flight).
        if (!settled) fallbackNotification(title, options)
        else console.warn('notification failed', e)
      })
    return
  }
  fallbackNotification(title, options)
}

function fallbackNotification(title: string, options: NotificationOptions) {
  try {
    // Throws on Android Chrome ("Illegal constructor") -- which is fine, this
    // is only reached when the service worker path was unavailable, and on
    // Android that means there was no way to show it at all. Log rather than
    // swallow, so the next person sees why.
    new Notification(title, options)
  } catch (e) {
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
