import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

// Where each visited screen was scrolled to. Session-scoped on purpose: it
// should survive a Back within a browsing session and nothing longer.
const positions = new Map<string, number>()

/**
 * Restore scroll on Back, scroll to top on a new navigation.
 *
 * The browser does this for real page loads, but not for a single-page app:
 * on Back, React unmounts the page and remounts it with its content still
 * loading, so there is nothing to scroll to at the moment the browser tries.
 * The result was that a customer who scrolled the restaurant list, opened the
 * ninth one, and came back landed at the top and had to scroll again -- a small
 * annoyance at 12 vendors and a real one as that grows.
 *
 * <ScrollRestoration> from react-router only works with a data router
 * (createBrowserRouter); this app uses <BrowserRouter> + <Routes>, so it is
 * done by hand.
 *
 * Keyed on pathname + search, so filtering to a category is its own entry and
 * backing out of it returns you to where you were in the unfiltered list.
 */
export function useScrollRestoration() {
  const location = useLocation()
  const navType = useNavigationType()
  const key = location.pathname + location.search
  const keyRef = useRef(key)

  // Record the outgoing screen's position before the new one paints.
  useEffect(() => {
    const previous = keyRef.current
    return () => { positions.set(previous, window.scrollY) }
  }, [key])

  useEffect(() => {
    keyRef.current = key
    if (navType === 'POP') {
      const y = positions.get(key)
      if (y != null) {
        // Two frames: one for React to commit the new tree, one for the browser
        // to lay it out. Scrolling before that is a no-op, because the document
        // is still short.
        requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)))
        return
      }
    }
    window.scrollTo(0, 0)
  }, [key, navType])
}
