import { Component, type ReactNode } from 'react'
import Icon from './Icon'
import * as Sentry from '@sentry/react'

interface Props { children: ReactNode }
interface State { hasError: boolean }

// Every route past Home is code-split (App.tsx), so a deploy that lands
// between a tab loading index.html and it lazily fetching a route chunk
// leaves that tab referencing asset hashes the new deploy already replaced --
// "Failed to fetch dynamically imported module", "Unable to preload CSS for
// ...", or Vite's "error loading dynamically imported module". Seen live in
// Sentry (2026-08-10, /admin, iPhone Safari) right after a run of several
// deploys in quick succession -- not a code bug, a version race any deploy
// can trigger. A fresh load of the CURRENT index.html fixes it, so reload
// once automatically instead of leaving a driver/vendor/admin mid-shift
// staring at "حصل خطأ غير متوقع" and expected to know what a refresh means
// here. Guarded by sessionStorage so a genuinely broken build (or the
// original error recurring after reload) shows the real fallback instead of
// loop-reloading forever.
const STALE_ASSET_ERROR = /fetch dynamically imported module|loading dynamically imported module|Unable to preload CSS|Loading chunk/i
const RELOAD_GUARD_KEY = 'salka_stale_asset_reload'

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    const message = error?.message ?? ''
    if (STALE_ASSET_ERROR.test(message) && !sessionStorage.getItem(RELOAD_GUARD_KEY)) {
      sessionStorage.setItem(RELOAD_GUARD_KEY, '1')
      window.location.reload()
      // Stay on the pre-crash tree while the reload is in flight rather than
      // flashing the error screen for the split second before navigation.
      return { hasError: false }
    }
    return { hasError: true }
  }

  componentDidMount() {
    // Reaching a normal mount means whatever we're showing right now loaded
    // successfully -- clear the guard so a LATER, unrelated deploy race can
    // still trigger one automatic reload rather than being permanently
    // silenced for the rest of this tab's session.
    sessionStorage.removeItem(RELOAD_GUARD_KEY)
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen grid place-items-center p-6 text-center">
          <div>
            <p className="text-4xl mb-3"><Icon name="warning" size="xl" className="mx-auto" /></p>
            <h1 className="font-bold text-lg mb-1">حصل خطأ غير متوقع</h1>
            <p className="text-mist text-sm mb-4">جرب تحدّث الصفحة، ولو استمرت المشكلة كلّم الدعم</p>
            <button className="btn-sea" onClick={() => window.location.reload()}>تحديث الصفحة</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
