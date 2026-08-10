import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { listenForInstallPrompt } from './lib/installPrompt'
import './index.css'

// Error monitoring: only activates if VITE_SENTRY_DSN is set (Vercel/Cloudflare
// env var, or a local .env file) -- completely inert otherwise, so nothing
// is ever sent anywhere without an explicit DSN being configured.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: import.meta.env.MODE,

    // Sentry's global onerror handler catches EVERY uncaught error on the page,
    // including ones thrown by code Salka never shipped. Facebook's in-app
    // browser injects its own telemetry script into every page it opens, and on
    // some iOS builds that script throws on first paint:
    //
    //   TypeError: undefined is not an object
    //     (evaluating 'window.webkit.messageHandlers')
    //     at sendDataToNative
    //     at processLargestContentfulPaintEvent
    //
    // That is Meta's code, running in Meta's browser, failing to reach Meta's
    // native bridge. Salka is not involved and the page renders fine. Left
    // unfiltered it drowns the real errors -- which is the actual cost, because
    // an alert nobody reads is the same as no alerting at all.
    // Same reasoning as the stale-chunk auto-reload in ErrorBoundary.tsx:
    // every route past Home is code-split, so a deploy landing between a tab
    // loading index.html and it lazily fetching a route chunk throws this --
    // not a Salka bug, a version race any deploy can trigger. ErrorBoundary
    // now reloads through it silently, so the error still fires (and Sentry
    // still sees it) but nothing is actually broken for the user -- filtering
    // it here stops it from paging anyone for something already self-healed.
    ignoreErrors: [
      /window\.webkit\.messageHandlers/,
      /webkit\.messageHandlers/,
      /fetch dynamically imported module/,
      /loading dynamically imported module/,
      /Unable to preload CSS/,
      /Loading chunk/,
    ],

    // The structural filter, and the one that will still hold when Meta renames
    // the function next month.
    //
    // index.html ships exactly one <script>, external, with an empty body --
    // Salka has NO inline JavaScript at all. So every frame of every error we
    // are responsible for resolves to a built chunk under /assets/. A stack
    // whose frames all point at the bare document URL cannot be ours: it was
    // injected after the fact by an in-app browser, an extension, or a
    // rewriting proxy.
    //
    // Deliberately conservative in two places. An error with NO frames (the
    // usual shape of "Non-Error promise rejection captured") is kept, because
    // absence of a stack is not evidence of foreign code. And this only drops
    // when EVERY frame is foreign -- one frame of ours anywhere in the stack
    // means we want to see it.
    //
    // Except that check alone missed a real one: Sentry patches
    // window.addEventListener globally for its own instrumentation, so an
    // error thrown INSIDE a listener Facebook's in-app browser registered
    // still shows one frame pointing at our bundle (the wrapped
    // addEventListener call itself, mechanism
    // "auto.browser.browserapierrors.addEventListener") even though every
    // OTHER frame -- the actual failure -- is entirely Facebook's injected
    // script. Seen live: "Error invoking enableDidUserTypeOnKeyboardLogging:
    // Java object is gone" at iabjs://navigation_performance_logger_android,
    // kept by the /assets/ check alone. `iabjs://` is Facebook's own protocol
    // scheme for that injected script -- unambiguous regardless of which
    // frame Sentry's own wrapper adds on top, so it overrides the /assets/
    // check rather than needing every individual function name enumerated.
    beforeSend(event) {
      const frames = event.exception?.values?.flatMap(v => v.stacktrace?.frames ?? []) ?? []
      if (frames.length === 0) return event
      if (frames.some(f => (f.filename ?? '').startsWith('iabjs://'))) return null
      const touchesOurCode = frames.some(f => (f.filename ?? '').includes('/assets/'))
      return touchesOurCode ? event : null
    },
  })
}

// Before React mounts. Chrome fires beforeinstallprompt once and early, and it
// is not replayed for a listener that attaches later — which is why the offer
// itself lives on Track but the CATCH has to be here.
listenForInstallPrompt()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // One root-scoped worker must own both the app shell and FCM. Registering
    // sw.js here and firebase-messaging-sw.js in push.ts made the two workers
    // replace each other, leaving iOS with a valid token but no FCM handler.
    navigator.serviceWorker.register('/firebase-messaging-sw.js').catch(() => {
      // installability/offline-shell is a nice-to-have, never block the app on it
    })
  })
}
