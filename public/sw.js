// Minimal service worker: exists mainly so Chrome/Android consider the app
// installable, plus a basic network-first cache so the app shell still opens
// (showing whatever was last loaded) if the phone briefly loses signal.
// This intentionally does NOT try to cache/serve API calls to Supabase --
// order data must always be fresh, never served stale from cache.

const CACHE = 'salka-shell-v2'

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// This worker now also DISPLAYS notifications, not just caches.
//
// lib/notify.ts used to call `new Notification(...)` directly. Chrome on
// Android has never implemented that constructor -- it throws "Illegal
// constructor. Use ServiceWorkerRegistration.showNotification() instead." --
// so in-app alerts worked on desktop and silently did nothing on every phone.
// notify.ts now calls registration.showNotification(), which lands here, so
// the tap has to be handled here too or the banner does nothing when pressed.
//
// firebase-messaging-sw.js has its own copy of this for background push. The
// two workers cannot share code (separate scopes, no imports), so if the
// routing rule changes, it changes in both files.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const target = data.link || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          // Already open -- focus it where it is. These alerts fire while the
          // person is using the app, so yanking them to another route would
          // interrupt whatever they were doing.
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    })
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Never cache API/data calls -- only same-origin app shell requests.
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
