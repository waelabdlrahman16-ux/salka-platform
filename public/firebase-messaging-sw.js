/* Firebase Cloud Messaging background handler.
 *
 * This is a SEPARATE service worker from sw.js. Firebase requires this exact
 * filename at the origin root -- getToken() looks for it by convention. sw.js
 * keeps doing the app-shell caching; this one only handles push while the tab
 * is closed or backgrounded, which is the case that matters for a driver whose
 * screen has gone to sleep.
 *
 * It uses the compat build deliberately: service workers cannot use bare module
 * specifiers, and importScripts is the supported path for FCM in a worker.
 *
 * The config is duplicated from src/lib/firebaseConfig.ts because a service
 * worker cannot import from the app bundle. These are public values, but if
 * the project ever changes, BOTH files have to change -- exactly the duplicated
 * -source-of-truth shape that caused today's pricing bugs, so it is called out
 * here rather than left to be discovered.
 */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'AIzaSyA3UH_5TZ2oWDcI6LRTcAl04QI3bKpsslI',
  authDomain: 'salka-38d81.firebaseapp.com',
  projectId: 'salka-38d81',
  storageBucket: 'salka-38d81.firebasestorage.app',
  messagingSenderId: '298864964514',
  appId: '1:298864964514:web:ffa48ef7432992fdc538fb',
})

// Deliberately NOT calling showNotification here.
//
// A message carrying a `notification` block is auto-displayed by the browser,
// and onBackgroundMessage fires for that same message. Displaying it here as
// well produced TWO banners per order -- confirmed by sending one message and
// reading back two entries from registration.getNotifications(): one bare
// (tag "", dir "auto", no icon) from the SDK, one styled from this handler.
//
// The styling now travels with the message instead, in send-push's `webpush`
// block (icon, badge, dir rtl, lang ar, tag order-<id>, renotify), so the
// single auto-displayed banner is the correct-looking one. See send-push v10.
//
// Registering firebase.messaging() at all is still required: without it the
// SDK does not install its push listener and background messages are dropped.
firebase.messaging()

// Tapping the banner should land on the relevant screen, and should focus an
// already-open tab rather than opening a second copy of the app.
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const orderId = event.notification?.data?.order_id
  const target = orderId ? `/driver?order=${orderId}` : '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(target).catch(() => {})
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    })
  )
})
