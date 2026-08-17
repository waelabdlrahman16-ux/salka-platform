import { useEffect } from 'react'

/**
 * Poll on an interval, but only while the screen is actually being looked at,
 * and refresh the moment it is looked at again.
 *
 * WHY. Every polled screen here ran at the same rate whether it was in front of
 * someone or forgotten behind twenty other tabs. Measured on the admin board:
 * one cycle moves ~407 kB, so 15s polling is ~98 MB an hour per open tab, and
 * at 01:30 with no customers ordering the platform was still serving ~1,500
 * edge calls an hour to nobody. Browsers throttle timers in a backgrounded tab
 * but do not stop them, and a tab on a second monitor is not backgrounded at
 * all.
 *
 * WHY THE IMMEDIATE REFRESH ON RETURN IS NOT OPTIONAL. Pausing without it just
 * moves the problem: someone comes back to a board that is silently as old as
 * their coffee break and acts on it. The refresh fires on visibilitychange and
 * on `online`, so returning from a tunnel counts too.
 *
 * WHERE THIS MUST NOT BE USED
 *
 *   Vendor.tsx  -- its 8s poll drives the NEW-ORDER ALARM (startRinging). A
 *                  vendor who switches to WhatsApp for a minute must still hear
 *                  an order arrive. Push would be the proper answer, but only
 *                  one vendor of fourteen has a token registered, so the poll IS
 *                  the notification. Saving its bandwidth would cost orders.
 *
 *   Driver.tsx  -- same shape of risk. A driver's phone is usually locked, and
 *                  pausing would delay a new available order appearing. It
 *                  already refreshes on visibilitychange; whether to pause it as
 *                  well is an operational call, not a performance one.
 *
 *   Admin.tsx      -- alerts on stalled orders, late unassigned orders, new
 *   Supervisor.tsx    complaints, settlement requests, escalated shifts, and
 *                     (Supervisor) every new order needing a call to the
 *                     restaurant. The first version of this change DID pause
 *                     them, which would have silenced every one of those while
 *                     the tab sat behind an inbox. They now slow to 60s when
 *                     hidden instead -- alerts still arrive, a minute late at
 *                     worst, and idle traffic still drops by three quarters.
 *
 * THE RULE: pause screens people READ. Never pause a screen that NOTIFIES --
 * slow it down instead, or not at all if the alert is time-critical.
 *
 * So this hook is for the genuinely passive ones. Before reaching for it, grep
 * the screen for ping(, pingIds(, startRinging and Notification. If any appear,
 * it does not belong here.
 */
export function usePollWhenVisible(
  load: () => void | Promise<unknown>,
  intervalMs: number,
  deps: unknown[] = [],
) {
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') load() }
    const t = setInterval(tick, intervalMs)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
