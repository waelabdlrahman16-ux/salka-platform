import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { firebaseConfig, VAPID_PUBLIC_KEY } from './firebaseConfig'
import { driverSelfService } from './driverSelfService'

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
 * Set when the server recognised the token we just sent as one FCM has already
 * rejected. See the comment on registerPush for why that happens and what the
 * caller does about it.
 */
export let lastSaveWasStale = false

// Several portal components can mount during one route transition (the page
// itself plus its explicit enable button). They all receive the same FCM token.
// Coalesce concurrent writes and do not write an already-confirmed token again
// for one minute; otherwise opening a staff portal repeatedly can exhaust the
// server's protection for the push-enrolment action.
const PUSH_SAVE_DEDUPE_MS = 60_000
const recentPushSaves = new Map<string, number>()
const inFlightPushSaves = new Map<string, Promise<boolean>>()

/**
 * For sinks that are not persistPushToken.
 *
 * saveWebTokenHealing() branches on `lastSaveWasStale` to decide whether to
 * destroy the cached registration and mint a new one. That flag was written
 * ONLY by persistPushToken, so Track's customer sink — which calls
 * save_customer_push_token instead — could never trigger the heal, and a
 * customer sitting on a dead cached token stayed unreachable forever. Worse,
 * the flag could still be carrying a value from an unrelated earlier call.
 */
export function reportSaveStale(stale: boolean): void { lastSaveWasStale = stale }

/**
 * The one place a staff push token is persisted. Every page used to inline
 * `supabase.rpc('save_my_push_token', { p_push_token })`, which meant six
 * copies that all had to learn about the platform argument at the same time or
 * silently register an APK as a browser -- and a token filed as 'web' gets a
 * data-only message the killed app will never display.
 */
export async function persistPushToken(token: string, platform: PushPlatform): Promise<boolean> {
  const key = `${platform}:${token}`
  const savedAt = recentPushSaves.get(key)
  if (savedAt && Date.now() - savedAt < PUSH_SAVE_DEDUPE_MS) return true
  const inFlight = inFlightPushSaves.get(key)
  if (inFlight) return inFlight

  const save = persistPushTokenOnce(token, platform, key)
  inFlightPushSaves.set(key, save)
  try {
    return await save
  } finally {
    inFlightPushSaves.delete(key)
  }
}

async function persistPushTokenOnce(token: string, platform: PushPlatform, key: string): Promise<boolean> {
  lastSaveWasStale = false
  const res = await driverSelfService<{ stored: boolean; stale: boolean }>('savePushToken', { pushToken: token, platform }, {
    rate_limited: 'في محاولات تفعيل تنبيهات كثيرة من الجهاز ده. اقفل وافتح سالكة مرة واحدة بعد دقيقة، من غير ما تغيّر إعدادات حسابك أو رقمك.',
  })
  if (!res.ok) {
    // Reported, not swallowed. Every call site used to drop this promise, so a
    // rejected write produced a hidden button and a silent phone.
    lastPushError = `save_my_push_token: ${res.error}`
    console.error('saving push token failed', res.error)
    return false
  }
  // The server keeps every token FCM has answered UNREGISTERED for. If this is
  // one of them, it refused to store it -- storing it again is the loop that
  // kept the admin unreachable for a whole day.
  if (res.data && typeof res.data === 'object' && (res.data as any).stale) {
    lastSaveWasStale = true
    lastPushError = 'التوكن ده اتلغى من فايربيز — بنجيب واحد جديد'
    return false
  }
  recentPushSaves.set(key, Date.now())
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

/**
 * @param force  Throw away the browser's cached registration and mint a new one.
 *
 * THE CACHE IS THE BUG. getToken() returns whatever is in IndexedDB for this
 * service worker + VAPID key; it does NOT ask FCM whether that token is still
 * registered. So once FCM unregisters a token -- storage cleared, PWA
 * reinstalled, subscription revoked, a long idle -- the browser keeps handing
 * back the same dead string, registerPush() re-saves it on every mount, and
 * updated_at keeps refreshing. The row looks healthy and nothing is delivered.
 *
 * Measured on 2026-08-07: the admin's token was re-saved at 13:06 and was still
 * UNREGISTERED at 13:34. Turning notifications off and on again could not fix
 * it, because the same cached string came back every time.
 *
 * deleteToken() is the only way out: it drops the local registration so the
 * next getToken() has to mint a fresh one.
 */
async function webToken(force = false): Promise<string | null> {
  // Loaded on demand: firebase/messaging is ~90KB and the main bundle is
  // already over Vite's size warning, so it must not ship to every customer.
  const [{ initializeApp, getApps, getApp }, { getMessaging, getToken, deleteToken, isSupported }] =
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
    const messaging = getMessaging(app)
    if (force) {
      // Best effort. If there is nothing to delete, or the delete fails, the
      // getToken below is still worth attempting.
      try { await deleteToken(messaging) } catch (e) { console.warn('deleteToken failed', e) }
    }
    const token = await getToken(messaging, {
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
 * THE FOREGROUND HANDLER, AND WHY ITS ABSENCE WAS INVISIBLE.
 *
 * FCM splits delivery in two. When the page is backgrounded or closed, the
 * message wakes the service worker and `onBackgroundMessage` in
 * firebase-messaging-sw.js draws the banner. When the page is FOCUSED, FCM
 * routes the message to `onMessage` in the page instead and **deliberately
 * does not wake the service worker at all**.
 *
 * There was no `onMessage` handler anywhere in this app. So a push arriving
 * while someone was looking at the screen was delivered -- FCM returned 200,
 * push_send_log recorded ok:true, every server-side check said "sent" -- and
 * then silently discarded by the SDK. No banner, no sound, nothing in the
 * console.
 *
 * That is the exact shape of order #87: «طلب جديد 🔔» accepted by FCM at
 * 17:46:41, and Wael, sitting on the admin screen where he spends his whole
 * day, saw nothing. The dead-token bug fixed earlier the same day was real but
 * it was not the only cause, and it hid this one: whenever push "worked" it was
 * because the phone was locked.
 *
 * Attached from registerPush() rather than from each page, for the same reason
 * `persist` is derived in send-push instead of passed: the failure mode of
 * something every caller must remember is the one caller who does not.
 */
let foregroundAttached = false

async function attachForegroundHandler(): Promise<void> {
  if (foregroundAttached) return
  if (pushSupport() !== 'web') return
  if (typeof window === 'undefined') return
  foregroundAttached = true

  try {
    const [{ initializeApp, getApps, getApp }, { getMessaging, onMessage, isSupported }] =
      await Promise.all([import('firebase/app'), import('firebase/messaging')])
    if (!(await isSupported())) return

    const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
    const messaging = getMessaging(app)

    const [{ showNotification }, { ringBurst }] =
      await Promise.all([import('./notify'), import('./ring')])

    onMessage(messaging, payload => {
      const d = (payload?.data ?? {}) as Record<string, string>
      diag(`foreground message: ${d.title ?? '(no title)'}`)

      // Same tag the service worker uses, so an order cannot produce two
      // banners just because delivery switched paths mid-order.
      showNotification(d.title || 'سالكة', d.body || '', {
        tag: d.order_id ? `order-${d.order_id}` : 'salka',
        // Staff banners stick; a customer's does not. `persist` is set by
        // send-push from whether the token is a staff token.
        requireInteraction: d.persist === '1',
      })

      // A banner is not enough for someone already staring at a screen full of
      // orders -- it renders in a corner they are not looking at. Staff get
      // sound. Customers deliberately do not: a noise they cannot stop, about
      // an order they cannot speed up, is a reason to uninstall the app.
      if (d.persist === '1') ringBurst()
    })
  } catch (e) {
    // A missing foreground banner must never break the page it sits on.
    foregroundAttached = false
    lastPushError = `onMessage: ${(e as Error)?.message ?? String(e)}`
    console.error('foreground push handler failed', e)
  }
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

    void attachForegroundHandler()
    return await saveWebTokenHealing(onToken)
  } catch (e) {
    // Push is an enhancement. It must never break the page it sits on.
    lastPushError = `registerPush: ${(e as Error)?.message ?? String(e)}`
    console.error('push refresh failed', e)
    return false
  }
}

/**
 * Mint a web token, store it, and if the server says that token is one FCM has
 * already rejected, throw away the browser's cached registration and mint a
 * genuinely new one -- once.
 *
 * This is the half of the fix that lives on the device. The server can delete a
 * dead row, but only the browser can produce a live token, and it will not do so
 * while it believes its cached one is fine.
 */
async function saveWebTokenHealing(onToken: PushTokenSink): Promise<boolean> {
  const token = await webToken()
  if (!token) return false

  const stored = await onToken(token, 'web')
  if (stored !== false) return true
  if (!lastSaveWasStale) return false

  const fresh = await webToken(true)
  // A brand new registration that produces the identical string means the
  // delete did not take effect -- retrying would just loop.
  if (!fresh || fresh === token) {
    lastPushError = 'مش قادرين نجدد التوكن — امسح بيانات الموقع وجرب تاني'
    return false
  }
  return (await onToken(fresh, 'web')) !== false
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

    void attachForegroundHandler()
    return await saveWebTokenHealing(onToken)
  } catch (e) {
    lastPushError = `enablePush: ${(e as Error)?.message ?? String(e)}`
    console.error('push enable failed', e)
    return false
  }
}
