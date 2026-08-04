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
    data: d,
  })
})

// Tapping the banner should land on the relevant screen, and should focus an
// already-open tab rather than opening a second copy of the app.
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const orderId = event.notification?.data?.order_id
  const target = event.notification?.data?.link || (orderId ? `/driver?order=${orderId}` : '/')

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
