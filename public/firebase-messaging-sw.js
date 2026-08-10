/* Firebase Cloud Messaging and app-shell service worker.
 *
 * This is the ONE root-scoped service worker for the application. A service
 * worker scope can only have one active registration: registering sw.js for
 * caching and this file for FCM made them replace each other. The browser
 * could therefore keep a valid FCM token while the active worker had no
 * background-message handler. Keep install, cache, and push behavior together.
 *
 * It uses the compat build deliberately: service workers cannot use bare module
 * specifiers, and importScripts is the supported path for FCM in a worker.
 *
 * The config is duplicated from src/lib/firebaseConfig.ts because a service
 * worker cannot import from the app bundle. These are public values, but if
 * the project ever changes, BOTH files have to change -- exactly the duplicated
 * -source-of-truth shape that caused today's pricing bugs, so it is called out
 * here rather than left to be discovered.
 *
 * THE SDK VERSION BELOW MUST MATCH `firebase` IN package.json.
 *
 * It did not, and that was the whole push bug. The bundle ships firebase
 * 12.17.0; this file pinned compat 10.14.1. Both halves share one IndexedDB on
 * the origin, and they disagree about its schema version: the page's v12 opens
 * `firebase-messaging-database` at version 2, and 10.14.1 then asks for version
 * 1 and throws
 *
 *     VersionError: The requested version (1) is less than the existing version (2)
 *
 * Reproduced live on app.gosalka.com, 2026-08-05: getToken() under 10.14.1
 * threw exactly that; under 12.17.0, against this same origin and the same
 * VAPID key, it returned a 142-character token immediately. Nothing else about
 * the setup was wrong -- not the key, not the service worker MIME type, not the
 * permission, not send-push, not the triggers.
 *
 * The failure is also order-dependent, which is why it could look intermittent:
 * whichever half opens the database first sets its version, so a browser that
 * loads the worker before the page fails in the opposite direction. Do not
 * "fix" a future recurrence by clearing site data -- bump the version here.
 *
 * scripts/check-firebase-sw-version.mjs runs on every build and fails it if
 * these drift again. Reading a warning was not enough the first time.
 */
importScripts('https://www.gstatic.com/firebasejs/12.17.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/12.17.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'AIzaSyA3UH_5TZ2oWDcI6LRTcAl04QI3bKpsslI',
  authDomain: 'salka-38d81.firebaseapp.com',
  projectId: 'salka-38d81',
  storageBucket: 'salka-38d81.firebasestorage.app',
  messagingSenderId: '298864964514',
  appId: '1:298864964514:web:ffa48ef7432992fdc538fb',
})

// Keep the app installable and let its shell reopen through a brief connection
// loss. API calls are deliberately never cached: order state must stay fresh.
const CACHE = 'salka-shell-v3'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/storage/')) return

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok) {
          const clone = response.clone()
          caches.open(CACHE).then(cache => cache.put(request, clone))
        }
        return response
      })
      .catch(() => caches.match(request).then(cached => cached || caches.match('/index.html')))
  )
})

// This worker owns the display, and send-push (v12+) sends DATA-ONLY messages
// so that it is the only thing displaying. Established by testing delivery:
//
//   * `notification` block + showNotification here -> TWO banners per message,
//     read back from registration.getNotifications(): one bare (tag "",
//     dir "auto", no icon) and one styled.
//   * `notification` block + no showNotification here -> FCM returns ok:true
//     and the browser displays NOTHING, with or without title/body repeated
//     under webpush.notification.
//
// Data-only removes the ambiguity: the SDK never displays anything itself, it
// just wakes this handler, and exactly one correctly-styled banner appears.
// Title and body therefore arrive in payload.data, not payload.notification.
firebase.messaging().onBackgroundMessage(payload => {
  const d = payload?.data || {}
  self.registration.showNotification(d.title || 'سالكة', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    // Orders are the only thing that pushes. Tagging by order id means a
    // status change replaces that order's banner rather than stacking five of
    // them on a driver's lock screen.
    tag: d.order_id ? `order-${d.order_id}` : 'salka',
    renotify: true,
    // STAFF BANNERS STICK. A vendor or a rider must not be able to lose an
    // order by glancing away: requireInteraction keeps the banner on screen
    // until they actually act on it, and the server re-sends every minute until
    // the order is accepted (push_nudge_sweep).
    //
    // A CUSTOMER'S DOES NOT, deliberately. A notification they cannot dismiss,
    // about an order they cannot speed up, is a reason to uninstall the app.
    // `persist` is set by send-push from whether the token is a staff token --
    // derived from the database rather than passed by each caller, because the
    // failure mode of a flag is the one function nobody remembered to update.
    requireInteraction: d.persist === '1',
    vibrate: d.persist === '1' ? [300, 150, 300, 150, 300] : [200],
    data: d,
  })
})

// Tapping the banner should land on the relevant screen, and should focus an
// already-open tab rather than opening a second copy of the app.
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const orderId = event.notification?.data?.order_id
  const target = event.notification?.data?.link || (orderId ? `/driver?order=${orderId}` : '/')

  // client.navigate() always performs a full navigation -- i.e. a reload --
  // even when the target URL is identical to what the tab is already showing.
  // Tapping a notification while already sitting on the right screen (a
  // driver mid-delivery, an admin on the right order) reloaded the whole app
  // for no reason. Only navigate when an open client isn't already there;
  // otherwise just focus it.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const targetUrl = new URL(target, self.location.origin).href
      const already = list.find(c => c.url === targetUrl && 'focus' in c)
      if (already) return already.focus()

      const client = list.find(c => 'focus' in c)
      if (client) return client.navigate(target).then(() => client.focus()).catch(() => client.focus())

      return self.clients.openWindow(target)
    })
  )
})
