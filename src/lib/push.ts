import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { firebaseConfig, VAPID_PUBLIC_KEY } from './firebaseConfig'
import { supabase } from './supabase'

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

/**
 * Which kind of token this device produces. The server needs to know, because
 * the two want opposite FCM payloads: a browser must get a data-only message
 * (the service worker draws the banner; a `notification` block produces either
 * two banners or none -- both were shipped and observed), while Android needs
 * an `android.notification` block or the system shows nothing at all while the
 * app is killed. That is the exact moment a driver misses an order.
 */
export type PushPlatform = 'web' | 'android' | 'ios'

/**
 * The callback every register/enable entry point hands its result to.
 *
 * It may return a promise resolving to false to say "I could not store this".
 * That matters: minting a token from FCM and failing to save it to the server
 * leaves a driver who has been told notifications are on and whom no trigger can
 * reach -- the exact state push_tokens = 0 describes.
 */
export type PushTokenSink = (token: string, platform: PushPlatform) => void | Promise<boolean | void>

/** Where a native token came from. Web is anything that is not a Capacitor app. */
function nativePlatform(): PushPlatform {
  const p = Capacitor.getPlatform()
  return p === 'android' || p === 'ios' ? p : 'web'
}

/**
 * The one place a staff push token is persisted. Every page used to inline
 * `supabase.rpc('save_my_push_token', { p_push_token })`, which meant six
 * copies that all had to learn about the platform argument at the same time or
 * silently register an APK as a browser -- and a token filed as 'web' gets a
 * data-only message the killed app will never display.
 */
export async function persistPushToken(token: string, platform: PushPlatform): Promise<boolean> {
  const { error } = await supabase.rpc('save_my_push_token', { p_push_token: token, p_platform: platform })
  if (error) {
    // Reported, not swallowed. Every call site used to drop this promise, so a
    // rejected write produced a hidden button and a silent phone.
    lastPushError = `save_my_push_token: ${error.message}`
    console.error('saving push token failed', error)
    return false
  }
  return true
}

// Must match ANDROID_CHANNEL in supabase/functions/send-push. A message naming
// a channel that does not exist falls back to the FCM SDK's default channel at
// DEFAULT importance: no heads-up banner, no sound. That is indistinguishable
// from the push having failed, which is the bug this whole change exists to fix.
const ANDROID_CHANNEL = 'salka_orders'

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

// A phone running a release APK has no console, no DevTools and no remote
// debugging -- Capacitor only enables WebView contents debugging for debug
// builds. So when registration stalls there is literally nothing to look at.
// Every step therefore records itself here and the UI renders the trail.
export const pushDiag: string[] = []
let diagStart = 0
function diag(msg: string) {
  const t = diagStart ? `+${Date.now() - diagStart}ms ` : ''
  pushDiag.push(t + msg)
  if (pushDiag.length > 40) pushDiag.shift()
}
export function resetPushDiag() { pushDiag.length = 0; diagStart = Date.now() }

// Nothing native may be awaited unguarded. A Capacitor bridge call that never
// calls back leaves the UI in its busy state forever, which is
// indistinguishable from a dead button -- exactly the symptom this is chasing.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: no response after ${ms}ms`)), ms)),
  ])
}

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

/**
 * Native registration, and the reason this function returns a boolean.
 *
 * It used to be `async function nativeToken(): Promise<void>` and the callers
 * did `await nativeToken(onToken); return true` -- reporting success before
 * knowing whether a token had arrived, because on native the token comes back
 * through a LISTENER, not from register(). So a denied permission, a
 * registrationError from FCM, and a perfect registration were indistinguishable
 * to the UI. Combined with pushPermission() reading Notification.permission --
 * and `Notification` not existing in an Android WebView, so it always answered
 * 'unavailable' -- the button could never hide and never report anything.
 * Tapping it did nothing visible, by construction.
 *
 * Now it resolves only when FCM has actually answered, either way, and puts the
 * reason in lastPushError so the failure card can name it.
 */
// Every staff page calls registerPush() on mount AND renders EnablePushButton,
// which calls it again. Both entered nativeToken(), and each one calls
// removeAllListeners() before adding its own -- child effects run first, so the
// page's call deleted the button's listeners. The button then only ever settled
// via the 20s timeout, so it reported failure on a registration that had in fact
// succeeded and never hid itself. That is the bug we spent the night chasing.
let nativeInFlight: Promise<boolean> | null = null

function nativeToken(onToken: PushTokenSink, allowPrompt: boolean): Promise<boolean> {
  // Second caller joins the first rather than racing it.
  if (nativeInFlight) return nativeInFlight
  nativeInFlight = nativeTokenOnce(onToken, allowPrompt).finally(() => { nativeInFlight = null })
  return nativeInFlight
}

async function nativeTokenOnce(onToken: PushTokenSink, allowPrompt: boolean): Promise<boolean> {
  diag(`platform=${Capacitor.getPlatform()} native=${Capacitor.isNativePlatform()}`)

  // If the plugin is not in the APK, or the bridge did not attach to the remote
  // URL, every call below hangs rather than throwing. Check first and say so.
  if (!Capacitor.isPluginAvailable('PushNotifications')) {
    lastPushError = 'PushNotifications plugin not available in this build'
    diag(lastPushError)
    return false
  }
  diag('plugin available')

  let granted = false
  try {
    const current = await withTimeout(PushNotifications.checkPermissions(), 8000, 'checkPermissions')
    diag(`checkPermissions -> ${current.receive}`)
    granted = current.receive === 'granted'
  } catch (e) {
    lastPushError = (e as Error).message
    diag(lastPushError)
    return false
  }

  if (!granted) {
    // registerPush() promises never to prompt. On native that promise was
    // broken -- it called requestPermissions() like enablePush() did.
    if (!allowPrompt) { lastPushError = 'لسه محدش سمح بالتنبيهات'; diag('no prompt allowed, stopping'); return false }
    try {
      const requested = await withTimeout(PushNotifications.requestPermissions(), 60000, 'requestPermissions')
      diag(`requestPermissions -> ${requested.receive}`)
      granted = requested.receive === 'granted'
    } catch (e) {
      lastPushError = (e as Error).message
      diag(lastPushError)
      return false
    }
  }
  if (!granted) { lastPushError = 'الإذن اترفض من إعدادات الجهاز'; diag(lastPushError); return false }

  // Android 8+ takes importance, sound and vibration from the CHANNEL, not from
  // the message. A high-priority message on a DEFAULT-importance channel is
  // still a silent line in the shade -- which is what a driver with the phone
  // in his pocket would never notice.
  //
  // A channel's importance is fixed at creation and cannot be raised later. If
  // this ever needs to get louder, ship a NEW channel id; editing this one has
  // no effect on a phone that already installed the app.
  if (Capacitor.getPlatform() === 'android') {
    try {
      await withTimeout(PushNotifications.createChannel({
        id: ANDROID_CHANNEL,
        name: 'طلبات سالكة',
        description: 'تنبيه صوتي لكل طلب جديد أو تغيير في طلب شغال',
        importance: 5,      // MAX -- heads-up banner over whatever is on screen
        visibility: 1,      // PUBLIC -- readable on the lock screen
        vibration: true,
        lights: true,
      }), 8000, 'createChannel')
      diag('channel created')
    } catch (e) {
      // A missing channel degrades to a quiet notification, not to no app.
      diag(`createChannel failed (continuing): ${(e as Error).message}`)
    }
  }

  try {
    await withTimeout(PushNotifications.removeAllListeners(), 8000, 'removeAllListeners')
    diag('listeners cleared')
  } catch (e) {
    diag(`removeAllListeners failed (continuing): ${(e as Error).message}`)
  }

  return await new Promise<boolean>(resolve => {
    let settled = false
    const finish = (ok: boolean) => { if (!settled) { settled = true; resolve(ok) } }

    PushNotifications.addListener('registration', t => {
      diag(`registration -> token ${t.value.slice(0, 12)}… (${t.value.length} chars)`)
      // The token existing is not the same as the server holding it.
      void Promise.resolve(onToken(t.value, nativePlatform()))
        .then(saved => {
          diag(saved === false ? 'server did NOT store the token' : 'token stored on the server')
          finish(saved !== false)
        })
        .catch(e => { lastPushError = `store: ${(e as Error).message}`; diag(lastPushError); finish(false) })
    })
    // This is the message that actually diagnoses a broken setup -- a wrong
    // google-services.json, an API key restricted away from FCM, no Play
    // Services. It used to go to console.error on a phone with no console.
    PushNotifications.addListener('registrationError', err => {
      lastPushError = `registrationError: ${(err as any)?.error ?? JSON.stringify(err)}`
      diag(lastPushError)
      finish(false)
    })

    diag('calling register()')
    PushNotifications.register()
      .then(() => diag('register() returned'))
      .catch(e => {
        lastPushError = `register: ${(e as Error)?.message ?? String(e)}`
        diag(lastPushError)
        finish(false)
      })

    // FCM can simply never answer -- no Play Services, no network. Without this
    // the button would spin forever, which reads exactly like doing nothing.
    setTimeout(() => {
      if (!settled) {
        if (!lastPushError) lastPushError = 'FCM مارجعش توكن خلال ٢٠ ثانية'
        diag('timed out waiting for the registration listener')
      }
      finish(false)
    }, 20000)
  })
}

/**
 * Refresh the push token when permission is already granted. Never prompts, so
 * it is safe to call on mount. FCM tokens rotate, so re-registering on each
 * load is what keeps a driver reachable weeks later.
 */
export async function registerPush(onToken: PushTokenSink): Promise<boolean> {
  try {
    const support = pushSupport()
    if (support === 'native') return await nativeToken(onToken, false)
    if (support !== 'web') return false
    if (Notification.permission !== 'granted') return false

    const token = await webToken()
    if (!token) return false
    return (await onToken(token, 'web')) !== false
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
export async function enablePush(onToken: PushTokenSink): Promise<boolean> {
  try {
    const support = pushSupport()
    if (support === 'native') return await nativeToken(onToken, true)
    if (support !== 'web') return false

    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission()
    if (permission !== 'granted') { lastPushError = 'الإذن اترفض'; return false }

    const token = await webToken()
    if (!token) return false
    return (await onToken(token, 'web')) !== false
  } catch (e) {
    lastPushError = `enablePush: ${(e as Error)?.message ?? String(e)}`
    console.error('push enable failed', e)
    return false
  }
}
