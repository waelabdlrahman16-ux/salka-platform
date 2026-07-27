// Minimal service worker: exists mainly so Chrome/Android consider the app
// installable, plus a basic network-first cache so the app shell still opens
// (showing whatever was last loaded) if the phone briefly loses signal.
// This intentionally does NOT try to cache/serve API calls to Supabase --
// order data must always be fresh, never served stale from cache.

const CACHE = 'salka-shell-v1'

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
