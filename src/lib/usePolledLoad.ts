import { useRef, useCallback } from 'react'

/**
 * Wrap a polled loader so two runs can never be in flight at once.
 *
 * THE PROBLEM. A screen that refreshes on a timer will, sooner or later, start
 * a second refresh before the first has answered -- a request slower than the
 * interval is all it takes, and on a mobile connection in Sokhna an 8-second
 * interval meets that regularly. Nothing then orders the two replies. The slow
 * one can land last and overwrite the screen with the OLDER answer, so a vendor
 * watching a ticket board sees a ticket they have already accepted come back as
 * new, or a completed order reappear.
 *
 * It is not a crash and it produces no error. It just quietly shows the past.
 *
 * THE FIX, and why this one. Driver.tsx already solved this with an in-flight
 * promise: concurrent callers get handed the promise that is already running
 * instead of starting a second request. Three triggers -- the timer, the screen
 * waking, the network reconnecting -- collapse into one fetch, and with only
 * one reply there is nothing to arrive out of order.
 *
 * That pattern is proven in this codebase, so this hook is that pattern made
 * reusable rather than a second, different mechanism sitting beside it. An
 * abort-and-ignore approach would work too, but two idioms for one problem is
 * how the next person ends up unsure which is authoritative.
 *
 * `force` is for after a mutation: the in-flight read was issued before your
 * write landed, so reusing its answer would show state you have just changed.
 * It waits for that read to finish and then issues a fresh one.
 */
export function usePolledLoad(run: () => Promise<void>) {
  const inFlight = useRef<Promise<void> | null>(null)
  const runRef = useRef(run)
  // Keep the latest closure without re-creating `load`, so an effect can depend
  // on `load` without resubscribing its timer on every render.
  runRef.current = run

  return useCallback(async function load(force = false): Promise<void> {
    if (inFlight.current) {
      if (!force) return inFlight.current
      await inFlight.current.catch(() => {})
    }
    // .finally clears the slot, and the identity check matters: without it a
    // slow run finishing after a newer one started would clear the NEWER
    // promise, leaving the ref pointing at nothing while a request is still
    // running -- reintroducing exactly the overlap this exists to prevent.
    const p = runRef.current()
      .finally(() => { if (inFlight.current === p) inFlight.current = null })
    inFlight.current = p
    return p
  }, [])
}
