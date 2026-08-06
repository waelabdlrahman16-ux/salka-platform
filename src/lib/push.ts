import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { firebaseConfig, VAPID_PUBLIC_KEY } from './firebaseConfig'

// Push used to be native-only: this file opened with
//   if (!Capacitor.isNativePlatform()) return
// and there is no native build. Everyone uses Salka in a browser, so no token
// was ever registered, push_tokens stayed empty, and all five notify_* triggers
// short-circuited on `if jsonb_array_length(v_tokens) = 0 then return new`.
//
// That -- not a missing server -- is why push had never fired for anyone. The
// backend was already complete: send-push is deployed, FCM_SERVICE_ACCOUNT_JSON
// is set (a diagnostic call reached FCM and got a per-token 404, not
// "not_configured"), and the triggers post through pg_net with the webhook
// secret out of Vault.
//
// FCM's HTTP v1 API accepts a web registration token in the same `token` field
// as a native one, so supporting browsers needs no server change at all.
//
// Two entry points, deliberately:
//   registerPush()  refresh the token when permission is ALREADY granted.
//                   Safe in a mount effect -- it never prompts.
//   enablePush()    ask for permission. Must come from a user gesture; a
//                   prompt fired on page load is bad practice and Chrome
//                   penalises origins that do it.

export type PushSupport =
  | 'native'        // Capacitor app
  | 'web'           // browser that can do web push
  | 'unsupported'   // no service worker / Notification / PushManager
  | 'unconfigured'  // VAPID key not set yet

export function pushSupport(): PushSupport {
  if (Capacitor.isNativePlatform()) return 'native'
  if (typeof window === 'undefined') return 'unsupported'
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) {
    return 'unsupported'
  }
  if (!VAPID_PUBLIC_KEY) return 'unconfigured'
  return 'web'
}

export function pushPermission(): NotificationPermission | 'unavailable' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unavailable'
  return Notification.permission
}

/** Set by webToken() when registration fails, so the UI can name the step. */
export let lastPushError = ''

async function webToken(): Promise<string | null> {
  // Loaded on demand: firebase/messaging is ~90KB and the main bundle is
  // already over Vite's size warning, so it must not ship to every customer.
  const [{ initializeApp, getApps, getApp }, { getMessaging, getToken, isSupported }] =
    await Promise.all([import('firebase/app'), import('firebase/messaging')])

  if (!(await isSupported())) { lastPushError = 'المتصفح ده مش بيدعم التنبيهات'; return null }

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
  let registration: ServiceWorkerRegistration
  try {
    registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
  } catch (e) {
    lastPushError = `فشل تسجيل الـ service worker: ${(e as Error)?.message ?? e}`
    return null
  }
  try {
    const token = await getToken(getMessaging(app), {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: registration,
    })
    if (!token) { lastPushError = 'getToken رجع فاضي'; return null }
    return token
  } catch (e) {
    // The message Firebase returns here is the whole diagnosis: a wrong-project
    // VAPID key, a blocked Installations API, and an unreachable FCM endpoint
    // all say different things -- and all of them used to surface as a button
    // that quietly vanished.
    lastPushError = `getToken: ${(e as Error)?.message ?? String(e)}`
    return null
  }
}

async function nativeToken(onToken: (token: string) => void): Promise<void> {
  const current = await PushNotifications.checkPermissions()
  let granted = current.receive === 'granted'
  if (!granted) {
    const requested = await PushNotifications.requestPermissions()
    granted = requested.receive === 'granted'
  }
  if (!granted) return

  await PushNotifications.removeAllListeners()
  PushNotifications.addListener('registration', t => onToken(t.value))
  PushNotifications.addListener('registrationError', err => console.error('push registration error', err))
  await PushNotifications.register()
}

/**
 * Refresh the push token when permission is already granted. Never prompts, so
 * it is safe to call on mount. FCM tokens rotate, so re-registering on each
 * load is what keeps a driver reachable weeks later.
 */
export async function registerPush(onToken: (token: string) => void): Promise<boolean> {
  try {
    const support = pushSupport()
    if (support === 'native') { await nativeToken(onToken); return true }
    if (support !== 'web') return false
    if (Notification.permission !== 'granted') return false

    const token = await webToken()
    if (!token) return false
    onToken(token)
    return true
  } catch (e) {
    // Push is an enhancement. It must never break the page it sits on.
    lastPushError = `registerPush: ${(e as Error)?.message ?? String(e)}`
    console.error('push refresh failed', e)
    return false
  }
}

/**
 * Ask for notification permission and register. Call from a click handler.
 * Resolves true only when a token was actually obtained and handed back.
 */
export async function enablePush(onToken: (token: string) => void): Promise<boolean> {
  try {
    const support = pushSupport()
    if (support === 'native') { await nativeToken(onToken); return true }
    if (support !== 'web') return false

    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission()
    if (permission !== 'granted') { lastPushError = 'الإذن اترفض'; return false }

    const token = await webToken()
    if (!token) return false
    onToken(token)
    return true
  } catch (e) {
    lastPushError = `enablePush: ${(e as Error)?.message ?? String(e)}`
    console.error('push enable failed', e)
    return false
  }
}
