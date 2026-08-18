import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useDismissable } from '../lib/useDismissable'
import { useAuth } from '../lib/auth'
import { pingIds } from '../lib/notify'
import { registerPush, persistPushToken } from '../lib/push'
import EnablePushButton from '../components/EnablePushButton'
import EnableSoundButton from '../components/EnableSoundButton'
import { startLocationReporting, stopLocationReporting, reportPosition } from '../lib/geolocation'
import type { Assignment, Driver, Shift, SwapRequest } from '../lib/types'
import Icon from '../components/Icon'
import DriverActiveMap from '../components/DriverActiveMap'
import DriverPoolMap from '../components/DriverPoolMap'
import SwipeToConfirm from '../components/SwipeToConfirm'
import Toggle from '../components/Toggle'
import { useSheets } from '../components/ActionSheets'
import { staffOperation } from '../lib/staffOperations'
import { driverAssignmentAction } from '../lib/driverAssignmentActions'
import { driverSelfService } from '../lib/driverSelfService'
import { haversineKm } from '../lib/geo'
import { vendorNoun } from '../lib/vendorWords'
import { SkeletonBlock, SkeletonCard } from '../components/Skeleton'
import { getDeviceId, getDeviceLabel } from '../lib/deviceId'
import { assignmentStatusLabel, driverStatusLabel } from '../lib/statusLabels'
import { cairoToday, cairoDayKey, shiftDayKey } from '../lib/cairoTime'

interface PoolOrder {
  id: number; total: number; zone: string
  kitchen_status: string; restaurant_name: string; vendor_type: string | null; created_at: string
  ready_at: string | null; dispatch_at: string | null
  dest_lat: number | null; dest_lng: number | null
}

interface BonusInfo {
  tiers: { orders: number; amount: number }[]
  current_tier: number
  earned_today: number
  next_orders: number | null
  next_amount: number | null
  orders_to_next: number | null
}

interface DriverStats {
  total_deliveries: number
  streak_days: number
  today_orders: number
  today_earnings: number
  today_tips: number
  today_reported_tips?: number
  unpaid_earnings: number
  cash_held: number
  bonus: BonusInfo
}

// How long since the last successful sync before we tell the driver the screen
// may be stale. Two missed polls.
// The daily bonus panel. Off until check_and_award_shift_bonus() is actually
// called by something -- see the block it guards.
// How long a finished-against-the-driver assignment (Cancelled / Failed) stays
// on screen. These rows are in the query on purpose -- an order an admin pulls
// must not silently vanish from under a driver who may be holding the food --
// but "on purpose" was doing all the work and nothing was ageing them out.
// Driver 1 finished today with SIX dead cards stacked above the live one.
const TERMINAL_GRACE_MS = 30 * 60 * 1000

/**
 * Should this dead assignment still be shown, and how should it read?
 *
 * Returns null when the answer is "not at all", which is the common case and
 * the one that was missing.
 *
 * Two distinctions that matter and were being collapsed into one red banner
 * saying "الطلب اتلغى — متكملش توصيله":
 *
 *  - HELD: the driver arrived at the vendor or took the food. They are standing
 *    somewhere holding something. Always tell them, however old the row is.
 *  - MOVED: rejection_reason = 'admin_unassigned' means the job went to another
 *    driver -- the order was NOT cancelled. Telling a driver who never touched
 *    it that "the order was cancelled" is simply false, and it is what put a
 *    full card for order #15 on أشرف's screen after it was reassigned.
 *
 * Note on the clock: delivery_assignments has no cancelled_at, and offered_at
 * is set to the same value as responded_at by admin_assign_order (a direct
 * assignment is not an offer anyone answered), so responded_at cannot be used
 * to detect acceptance. offered_at is the only timestamp available and an
 * assignment is short-lived, so it is a fair proxy for "recent".
 */
function terminalNotice(a: Assignment): { held: boolean; moved: boolean } | null {
  if (a.status !== 'Cancelled' && a.status !== 'Failed') return null

  const held = !!(a.picked_up_at || a.arrived_at_restaurant_at)
  const moved = a.rejection_reason === 'admin_unassigned'

  if (held) return { held, moved }
  // Never touched it and it merely changed hands: nothing happened to them.
  if (moved) return null

  const at = a.offered_at ? new Date(a.offered_at).getTime() : 0
  if (!at || Date.now() - at > TERMINAL_GRACE_MS) return null
  return { held, moved }
}

const SHOW_BONUS = false

const STALE_AFTER_MS = 25000
// Per-request ceiling inside a load cycle -- see the comment at withTimeout.
const LOAD_TIMEOUT_MS = 15000

export default function DriverPage() {
  const { profile } = useAuth()
  const { confirmSheet, promptSheet, alertSheet, sheetElement } = useSheets()
  const id = profile?.driver_id
  const [driver, setDriver] = useState<Driver | null>(null)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  // Delivered runs pile up under the live ones and every completed card looked
  // exactly like a job still needing work -- same header, same progress bar,
  // same call/maps buttons. Four finished orders and one live one meant hunting
  // for the live one. Two tabs; finished work is one tap away, never in the way.
  const [tab, setTab] = useState<'active' | 'done'>('active')
  const [rejecting, setRejecting] = useState<Assignment | null>(null)
  const rejectingRef = useDismissable(() => setRejecting(null), !!rejecting)
  const [reason, setReason] = useState('')
  const [cashConfirmed, setCashConfirmed] = useState<Set<number>>(new Set())
  const [pool, setPool] = useState<PoolOrder[]>([])
  const [selectedPoolId, setSelectedPoolId] = useState<number | null>(null)
  const [claiming, setClaiming] = useState<number | null>(null)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [swaps, setSwaps] = useState<SwapRequest[]>([])
  const [myOpenRequests, setMyOpenRequests] = useState<Map<number, number>>(new Map())
  const [myEscalated, setMyEscalated] = useState<Set<number>>(new Set())
  const [swapReason, setSwapReason] = useState<Record<number, string>>({})
  const [requestingSettlement, setRequestingSettlement] = useState(false)
  const [settlementSent, setSettlementSent] = useState(false)
  const [stats, setStats] = useState<DriverStats | null>(null)
  const [justDelivered, setJustDelivered] = useState<{ orderId: number } | null>(null)
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null)
  const [gpsDenied, setGpsDenied] = useState(false)
  const [syncFailed, setSyncFailed] = useState(false)
  /** null = not checked yet, true = another phone owns this account. */
  const [deviceLocked, setDeviceLocked] = useState<boolean | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // A single global slot meant that acting on order A silently swallowed every
  // action on orders B and C (a driver holds up to 4). The worst case was two
  // orders at the same compound: confirming cash on A made B's cash checkbox
  // no-op after the driver had already agreed to the irreversible dialog, and B's
  // delivery swipe stayed disabled with nothing on screen explaining why.
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const isBusy = (key: string) => busy.has(key)
  const justDeliveredTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef<Promise<void> | null>(null)
  // Mirrors `busy` so runAction's guard reads the current value rather than a
  // value captured when the handler was created.
  const busyRef = useRef<Set<string>>(new Set())

  // Whether the earnings/shifts panel is expanded. Latched from the first load
  // that actually returned data: a driver with nothing to deliver gets it open,
  // a driver mid-delivery gets it closed. After that it is theirs -- see the
  // comment at the <details> for why this cannot be a derived prop.
  const [refsOpen, setRefsOpen] = useState(false)
  const refsInitialised = useRef(false)

  // Every money figure on this screen comes from my_driver_stats. If that call
  // fails -- or the server predates the migration that widened its shape -- a
  // `?? 0` default turns the failure into a confident lie: "0 ج.م" and "0 طلبات"
  // after a full shift, with early settlement disabled because unpaid === 0.
  // Render an em dash instead, and let coreFailed raise the banner.
  const haveStats = stats !== null
  const unpaidEarnings = stats?.unpaid_earnings ?? 0
  const streakDays = stats?.streak_days ?? 0
  const todayEarnings = stats?.today_earnings ?? 0
  const todayOrders = stats?.today_orders ?? 0
  const todayTips = stats?.today_tips ?? 0
  const todayReportedTips = stats?.today_reported_tips ?? 0
  const bonus = stats?.bonus ?? null
  const money = (n: number) => (haveStats ? `${n} ج.م` : '، ج.م')

  useEffect(() => {
    return () => { if (justDeliveredTimeoutRef.current) clearTimeout(justDeliveredTimeoutRef.current) }
  }, [])

  // Declared here, not further down, because the effect below reads
  // liveAssignments.length in its dependency array -- which is evaluated during
  // render, so a const defined later would still be in its temporal dead zone.
  // Offered needs an immediate accept/reject before it goes to someone else --
  // always most urgent regardless of anything else. Among assignments already
  // taken, further-along stages are closer to a customer/cash action, so they
  // sort ahead of one just accepted and not yet moving. With 2-3 concurrent
  // orders, this used to be plain id-desc (arrival order), so a driver had to
  // read every stage bar to find which one needed them next.
  const URGENCY_RANK: Record<string, number> = {
    Offered: 0, Out_for_Delivery: 1, Picked_Up: 2, Accepted: 3,
  }
  const liveAssignments = assignments.filter(a =>
    a.status !== 'Delivered' &&
    // Dead rows only survive here if terminalNotice() says they are still worth
    // the driver's attention. Everything else drops off the screen on the next
    // poll, which is what a driver expects of a job that is no longer theirs.
    (a.status !== 'Cancelled' && a.status !== 'Failed' ? true : terminalNotice(a) !== null)
  ).sort((a, b) => (URGENCY_RANK[a.status] ?? 9) - (URGENCY_RANK[b.status] ?? 9))
  const doneAssignments = assignments.filter(a => a.status === 'Delivered')
  // Never strand the driver on an empty history tab -- the tab bar hides itself
  // when there is nothing finished, and the selection has to follow it.
  const activeTab = doneAssignments.length === 0 ? 'active' : tab
  const shown = activeTab === 'active' ? liveAssignments : doneAssignments

  // Anything new to claim pulls the driver back to the live tab: an offer
  // addressed to them, OR an unclaimed pool order -- the pool sends its own
  // push ("في طلب جديد متاح للاستلام"), and it only renders on the live tab, so
  // without this the notification lands someone on a board where the order it
  // is about does not appear at all. Both expire.
  //
  // Compared as a SET of ids, not a count. A count only moves on a net
  // increase, so an offer expiring in the same poll as a new one arrives reads
  // as 1 -> 1 and nothing switches -- the exact case where a missed switch
  // costs the order.
  const claimableKey = [
    ...liveAssignments.filter(a => a.status === 'Offered').map(a => `a${a.id}`),
    ...pool.map(o => `p${o.id}`),
  ].sort().join(',')
  const seenClaimableRef = useRef<Set<string> | null>(null)
  // A new Offered assignment now sorts to the top of `shown` (see
  // URGENCY_RANK above), but the header, push-enable button, and any
  // stale-sync/GPS banners can still push it below the fold on a short
  // screen -- tapping a notification landed on the right tab but not
  // necessarily on the thing to act on. Scroll the list into view whenever
  // something new to claim shows up, notification-driven or not.
  const orderListRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const ids = new Set(claimableKey ? claimableKey.split(',') : [])
    const prev = seenClaimableRef.current
    seenClaimableRef.current = ids
    // null on first run: everything is "new" on mount, which is not a reason to
    // yank the tab -- the driver has not been shown anything yet.
    if (prev === null) return
    for (const k of ids) if (!prev.has(k)) {
      setTab('active')
      orderListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
  }, [claimableKey])

  // Reset rather than mask. `activeTab` falls back to 'live' while the tab bar
  // is hidden, but `tab` itself stayed 'done' -- so the next delivered order
  // re-showed the bar and dropped the driver straight back onto the finished
  // board without touching anything.
  useEffect(() => {
    if (doneAssignments.length === 0) setTab('active')
  }, [doneAssignments.length])

  useEffect(() => {
    if (refsInitialised.current || !haveStats) return
    refsInitialised.current = true
    setRefsOpen(liveAssignments.length === 0)
  }, [haveStats, liveAssignments.length])

  // Every query used to destructure only `data`, so a dropped request on weak
  // signal set state to [] -- wiping the driver's in-progress delivery, the
  // customer's address and phone, and every action button off the screen, and
  // replacing it with "no orders". Indistinguishable from having no work.
  //
  // Now: errors are inspected, state is only replaced when the query actually
  // succeeded, and a failed sync surfaces a banner instead of pretending the
  // board is empty. The 12 sequential round trips are also parallelised -- on
  // mobile data they routinely took longer than the 10s poll interval.
  // A plain `if (inFlight) return` guard turns every `await load()` after a
  // mutation into a silent no-op whenever the 10s poll happens to be running --
  // which on weak data is most of the time. That left stale cards (a card still
  // offering قبول for an order the driver had just accepted), a refresh button
  // that spun for one frame and did nothing, and a post-delivery overlay showing
  // pre-delivery totals. Callers that need fresh data pass force.
  async function load(force = false): Promise<void> {
    if (inFlightRef.current) {
      if (!force) return inFlightRef.current
      // Wait out the in-flight poll, then fetch again -- its snapshot predates
      // the mutation we just made, so reusing it would show stale state.
      await inFlightRef.current.catch(() => {})
    }
    const p = runLoad().finally(() => { if (inFlightRef.current === p) inFlightRef.current = null })
    inFlightRef.current = p
    return p
  }

  async function runLoad() {
    if (!id) return
    try {
      const today = cairoToday()
      // supabase-js is created with no timeout, so a request that never settles
      // would pin inFlightRef forever: every later load() would wait on a dead
      // promise, no setState would run, the component would never re-render, and
      // the staleness banner (which is computed during render) would never
      // appear. The driver would be staring at a frozen but confident-looking
      // board with a dead refresh button.
      const withTimeout = <T,>(p: PromiseLike<T>): Promise<T | { error: Error; data: null }> =>
        Promise.race([
          Promise.resolve(p),
          new Promise<{ error: Error; data: null }>(resolve =>
            setTimeout(() => resolve({ error: new Error('timeout'), data: null }), LOAD_TIMEOUT_MS)),
        ]) as Promise<T | { error: Error; data: null }>

      const [dRes, statsRes, aRes, pRes, shRes, swRes, mineRes, escRes, reqRes] = await Promise.all([
        withTimeout(supabase.from('drivers').select('*').eq('id', id).single()),
        withTimeout(driverSelfService('myStats').then(r => r.ok ? { data: r.data, error: null } : { data: null, error: new Error(r.error) })),
        withTimeout(supabase.from('delivery_assignments')
          .select('*, orders(*, restaurants(name, vendor_type), compounds(name, latitude, longitude))').eq('driver_id', id)
          // Cancelled and Failed are here on purpose. Without them, an order
          // an admin pulls disappears from the driver's screen on the next
          // 10-second poll -- address, phone, the whole task -- while the driver
          // may be holding the food. The only other signal was a push the
          // trigger swallows on any error, to a token most drivers do not have.
          .in('status', ['Offered', 'Accepted', 'Picked_Up', 'Out_for_Delivery', 'Delivered', 'Cancelled', 'Failed'])
          .order('id', { ascending: false }).limit(20)),
        withTimeout(driverSelfService('availableOrders').then(r => r.ok ? { data: r.data, error: null } : { data: null, error: new Error(r.error) })),
        withTimeout(supabase.from('shifts').select('*')
          .eq('driver_id', id).gte('shift_date', today)
          .neq('status', 'cancelled').order('shift_date').limit(10)),
        // Mapped back to supabase's { data, error } shape on purpose: this row
        // is one of nine destructured together below, and the swap board reads
        // swRes.error like every sibling.
        withTimeout(staffOperation<SwapRequest[]>('openSwaps')
          .then(r => r.ok ? { data: r.data, error: null } : { data: null, error: new Error(r.code) })),
        withTimeout(supabase.from('shift_swap_requests').select('id, shift_id').eq('requested_by', id).eq('status', 'open')),
        withTimeout(supabase.from('shift_swap_requests').select('shift_id').eq('requested_by', id).eq('status', 'escalated')),
        withTimeout(supabase.from('settlement_requests').select('id').eq('driver_id', id).eq('status', 'pending').limit(1)),
      ])

      // The driver's own work and their money must never be silently emptied.
      // Shifts and swaps failing is cosmetic; assignments, the pool, or stats
      // failing is not -- every earnings figure now comes from stats, so a
      // failure there would otherwise render a confident 0 ج.م.
      const coreFailed = !!(dRes.error || aRes.error || pRes.error || statsRes.error)

      if (!dRes.error && dRes.data) setDriver(dRes.data)
      if (!statsRes.error && statsRes.data) setStats(statsRes.data as unknown as DriverStats)
      if (!aRes.error) setAssignments(aRes.data ?? [])
      if (!pRes.error) {
        const p = (pRes.data as PoolOrder[]) ?? []
        setPool(p)
        pingIds('pool', p.map(o => o.id), 'طلب متاح', 'في طلب جديد متاح للاستلام', true)
      }
      if (!shRes.error) setShifts(shRes.data ?? [])
      if (!swRes.error) setSwaps((swRes.data as SwapRequest[]) ?? [])
      if (!mineRes.error) setMyOpenRequests(new Map((mineRes.data ?? []).map((x: any) => [x.shift_id, x.id])))
      if (!escRes.error) setMyEscalated(new Set((escRes.data ?? []).map((x: any) => x.shift_id)))
      if (!reqRes.error) setSettlementSent((reqRes.data ?? []).length > 0)

      setSyncFailed(coreFailed)
      if (!coreFailed) setLastSyncAt(Date.now())
    } catch {
      setSyncFailed(true)
    }
  }

  async function manualRefresh() {
    setRefreshing(true)
    await load(true)
    setRefreshing(false)
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    // Browsers throttle or suspend timers in a backgrounded tab, and push does
    // not work yet, so a driver returning to the app could be looking at a
    // minutes-old board. Re-sync the moment the screen comes back.
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (!id) return
    // ORDER MATTERS between these two, and it did not used to.
    //
    // push_tokens has UNIQUE(profile_id) and save_my_push_token upserts on it,
    // so a driver profile holds exactly ONE token -- the most recent device
    // wins. These two calls used to fire together with no ordering, so opening
    // the app on a second phone overwrote the token with phone B's, and THEN
    // driver_claim_device refused phone B and locked its screen. Net result:
    // the device the driver is forbidden to use owned the only push token, the
    // bound phone went silent, and the driver simply stopped receiving offers.
    // admin_reset_driver_device does not clear push_tokens, so it survived a
    // reset too.
    //
    // Claim first; only register for push once this phone is the one allowed
    // to work.
    driverSelfService('claimDevice', { deviceId: getDeviceId(), label: getDeviceLabel() })
      .then(res => {
        const locked = !res.ok && res.code === 'device_locked'
        setDeviceLocked(locked)
        if (res.ok) {
          registerPush(persistPushToken)
        }
      })
  }, [id])

  // Only run the map/ETA watcher while there is something to navigate to.
  // It previously ran for the whole time the page was mounted, including while
  // idle with no orders, which is the dominant battery cost on a shift-long shift.
  const hasActiveAssignment = assignments.some(
    a => a.status === 'Accepted' || a.status === 'Picked_Up' || a.status === 'Out_for_Delivery'
  )

  // Watch while there is anything to position against. Gating on an active
  // assignment alone blinded the pool map: an idle driver browsing available
  // orders had no 🛵 marker, which is the one thing that tells them which order
  // is worth claiming, and accepting one then started the watch cold.
  const needsPosition = hasActiveAssignment || pool.length > 0

  useEffect(() => {
    if (!navigator.geolocation || !needsPosition) return
    const watchId = navigator.geolocation.watchPosition(
      pos => {
        setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setGpsDenied(false)
        // The same fix that draws the 🛵 on this driver's own map is what
        // dispatch sees. It is handed over unconditionally; geolocation.ts
        // decides whether we are currently reporting, and the server ignores it
        // unless there is a live Picked_Up / Out_for_Delivery assignment.
        reportPosition(pos.coords.latitude, pos.coords.longitude)
      },
      err => {
        // Permission denied is actionable by the driver and must be visible;
        // a momentary loss of fix is not. Previously all three were an empty
        // callback, so "location off" looked identical to "still locating".
        if (err.code === err.PERMISSION_DENIED) setGpsDenied(true)
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    )
    return () => {
      navigator.geolocation.clearWatch(watchId)
      // Otherwise the last fix keeps rendering as the driver's live position
      // long after the watch stopped -- a 🛵 pin sitting at the previous
      // customer's door while they ride away.
      setMyPos(null)
    }
  }, [needsPosition])

  // Depend on the derived boolean, not the assignments array. `assignments` is a
  // fresh array object on every 10s poll, so this effect used to tear down and
  // restart location reporting every single poll -- which is what let
  // startLocationReporting orphan intervals.
  const isOutDelivering = assignments.some(a => a.status === 'Picked_Up' || a.status === 'Out_for_Delivery')

  useEffect(() => {
    if (!isOutDelivering) { stopLocationReporting(); return }
    startLocationReporting()
    // The 60s retry that used to sit here existed because start() could fail
    // silently -- it awaited a permission grant and then a 15s GPS fix before
    // it could install its interval, so one dismissed prompt froze the driver
    // on dispatch's map for the rest of the block. start() no longer waits for
    // anything: it installs the timer immediately and reportPosition() feeds it
    // from the watch that is already running. There is nothing left to retry.
    return () => { stopLocationReporting() }
  }, [isOutDelivering])

  // Every stage button used to fire its RPC with no pending state. On a 3-5s
  // mobile round trip the natural reaction is to tap again, which double-fires.
  // runAction serialises them and gives the UI something to disable on.
  async function runAction(key: string, fn: () => Promise<void>) {
    if (busyRef.current.has(key)) return // same action, not the whole page
    busyRef.current.add(key)
    setBusy(new Set(busyRef.current))
    try { await fn() } finally {
      busyRef.current.delete(key)
      setBusy(new Set(busyRef.current))
    }
  }

  async function setStatus(a: Assignment, status: string) {
    if (!id) return
    if (status === 'Accepted') {
      await runAction(`accept:${a.id}`, async () => {
        const res = await driverAssignmentAction('acceptAssignment', { assignmentId: a.id, orderId: a.order_id })
        if (!res.ok) {
          await alertSheet(res.code === 'dispatch_rule_blocked'
            ? 'وصلت للحد الأقصى (٤ طلبات) أو الطلب ده في اتجاه مختلف عن طلباتك الحالية'
            : 'حصل خطأ، جرب تاني')
          return
        }
        await load(true)
      })
      return
    }
    if (status === 'Delivered') {
      await runAction(`deliver:${a.id}`, async () => {
        const res = await driverAssignmentAction('markDelivered', { assignmentId: a.id, orderId: a.order_id })
        if (!res.ok) { await alertSheet(res.error); return }
        // Show it immediately -- gating on load() left the driver swiping a
        // control that gave no sign of life for several seconds on mobile data.
        // The totals inside refresh when the reload lands, still within the 3s.
        setJustDelivered({ orderId: a.order_id })
        load(true)
        if (justDeliveredTimeoutRef.current) clearTimeout(justDeliveredTimeoutRef.current)
        justDeliveredTimeoutRef.current = setTimeout(() => setJustDelivered(null), 3000)
      })
    }
  }

  async function markArrived(a: Assignment) {
    await runAction(`arrived:${a.id}`, async () => {
      if (navigator.vibrate) navigator.vibrate(15)
      const res = await driverAssignmentAction('arrivedAtRestaurant', { assignmentId: a.id })
      if (!res.ok) { await alertSheet(res.error); return }
      await load(true)
    })
  }

  async function markPickedUp(a: Assignment) {
    await runAction(`pickup:${a.id}`, async () => {
      if (navigator.vibrate) navigator.vibrate(15)
      const res = await driverAssignmentAction('markPickedUp', { assignmentId: a.id })
      if (!res.ok) {
        await alertSheet(
          res.code === 'order_not_ready' ? 'الطلب لسه بيتجهز. استنى لحد ما يبقى جاهز'
          : res.code === 'must_arrive_first' ? 'لازم تسجل إنك وصلت المكان الأول'
          : 'حصل خطأ، جرب تاني'
        )
        return
      }
      await load(true)
    })
  }

  async function markOutForDelivery(a: Assignment) {
    await runAction(`out:${a.id}`, async () => {
      if (navigator.vibrate) navigator.vibrate(15)
      const res = await driverAssignmentAction('markOutForDelivery', { assignmentId: a.id })
      if (!res.ok) { await alertSheet(res.error); return }
      await load(true)
    })
  }

  // Irreversible and financial: it permanently increases the driver's cash_held
  // liability. A single mis-tap with three stacked order cards, one-handed, used
  // to be enough. reportNoAnswer -- a far cheaper action -- already confirmed.
  async function confirmCash(a: Assignment, cashDue: number) {
    const ok = await confirmSheet({
      title: `تأكيد إنك استلمت ${cashDue} ج.م كاش من العميل؟`,
      body: 'المبلغ ده هيتسجل عليك لحد ما تسلّمه للإدارة، ومش هينفع تتراجع عنه.',
      danger: true,
    })
    if (!ok) return
    await runAction(`cash:${a.id}`, async () => {
      if (navigator.vibrate) navigator.vibrate(15)
      setCashConfirmed(s => new Set(s).add(a.id)) // optimistic
      const res = await driverAssignmentAction('confirmCashReceived', { assignmentId: a.id })
      if (!res.ok) {
        setCashConfirmed(s => { const next = new Set(s); next.delete(a.id); return next })
        await alertSheet(res.error)
        return
      }
      await load(true)
    })
  }

  // The customer's last update is "مندوبك في الطريق إليك", sent when the order
  // goes Out_for_Delivery. In a compound the final stretch -- gate, block,
  // chalet -- is the slow part, and the driver's only tool for it was a phone
  // call. One tap here pushes "المندوب وصل عندك" instead.
  async function markArrivedAtCustomer(a: Assignment) {
    await runAction(`arrived:${a.id}`, async () => {
      if (navigator.vibrate) navigator.vibrate(15)
      const res = await driverAssignmentAction('arrivedAtCustomer', { assignmentId: a.id })
      if (!res.ok) { await alertSheet(res.error); return }
      await load(true)
    })
  }

  // The only escalation a driver had was "اتصلت ومردش", gated behind a call and
  // a five-minute wait. A wrong address, a customer refusing the order, a gate
  // that will not let them in -- none of those are "no answer", and the honest
  // driver's only option was to claim a call they had not made.
  async function reportProblem(a: Assignment) {
    const reason = await promptSheet({
      title: 'في مشكلة في الطلب ده؟ اكتبها والإدارة هتشوفها فورًا',
      body: 'مثال: العنوان غلط · العميل رفض الطلب · البوابة مش بتدخلني',
      multiline: true,
      placeholder: 'اكتب المشكلة…',
    })
    if (!reason?.trim()) return
    await runAction(`problem:${a.id}`, async () => {
      const res = await driverAssignmentAction('reportProblem', {
        assignmentId: a.id, reason: reason.trim(),
      })
      if (!res.ok) { await alertSheet(res.error); return }
      await load(true)
    })
  }

  // `available` was written only by the admin screen. A driver starting a shift
  // had no way to say they were ready, and one ending a shift had no way to stop
  // getting offers -- while the badge beside their name looked exactly like the
  // admin's toggle and did nothing. The colour also came from `available` while
  // the text came from `status`, so an unavailable driver on a delivery got a
  // red badge reading "في توصيل".
  async function toggleAvailable() {
    const next = !driver?.available
    await runAction('availability', async () => {
      const res = await driverSelfService('setAvailable', { available: next }, {
        finish_your_orders_first: 'خلّص الطلبات اللي معاك الأول',
        driver_suspended: 'حسابك موقوف. كلّم الإدارة',
      })
      if (!res.ok) { await alertSheet(res.error); return }
      await load(true)
    })
  }

  async function markCalledCustomer(a: Assignment) {
    await runAction(`called:${a.id}`, async () => {
      if (navigator.vibrate) navigator.vibrate(15)
      const res = await driverAssignmentAction('calledCustomer', { assignmentId: a.id })
      if (!res.ok) { await alertSheet(res.error); return }
      await load(true)
    })
  }

  async function reportNoAnswer(a: Assignment) {
    if (!await confirmSheet({ title: 'العميل فعلاً ما ردش بعد ما اتصلت؟', body: 'الإدارة هتشوف الطلب وتقرر.' })) return
    const res = await driverAssignmentAction('reportNoAnswer', { assignmentId: a.id })
    if (!res.ok) {
      await alertSheet(
        res.code === 'must_call_customer_first' ? 'لازم تتصل بالعميل الأول'
        : res.code === 'too_early' ? 'لسه بدري، استنى 5 دقايق من وقت خروجك للتوصيل'
        : 'حصل خطأ، جرب تاني'
      )
      return
    }
    await alertSheet('تم إبلاغ الإدارة، هيتواصلوا معاك بقرار')
    load(true)
  }

  async function requestSettlement() {
    setRequestingSettlement(true)
    // The error was never read, so a failed request still showed the success
    // message and hid the button until the next poll.
    const res = await staffOperation('requestEarlySettlement')
    setRequestingSettlement(false)
    if (!res.ok) { await alertSheet('مش قادرين نبعت طلب التسوية دلوقتي، جرب تاني'); return }
    setSettlementSent(true)
  }

  async function requestSwap(shiftId: number) {
    const res = await staffOperation('requestSwap', {
      shiftId, reason: swapReason[shiftId] || ''
    })
    if (!res.ok) await alertSheet(res.error)
    load(true)
  }

  async function acceptSwap(requestId: number) {
    const res = await staffOperation('acceptSwap', { requestId })
    if (!res.ok) await alertSheet(res.code === 'request_unavailable' ? 'حد تاني سبقك' : 'حصل خطأ')
    load(true)
  }

  async function escalate(requestId: number) {
    const res = await staffOperation('escalateSwap', { requestId })
    if (!res.ok) { await alertSheet(res.error); return }
    load(true)
  }

  async function claim(orderId: number) {
    // `claiming` held a single id, so while one claim was in flight every other
    // pool card stayed enabled and two quick taps could land two orders.
    if (claiming !== null) return
    setClaiming(orderId)
    const claimRes = await driverAssignmentAction('claimOrder', { orderId })
    if (!claimRes.ok) {
      await alertSheet(
        claimRes.code === 'already_taken' ? 'الطلب اتاخد من مندوب تاني'
        : claimRes.code === 'wrong_vehicle_type' ? 'الطلب ده محتاج فان'
        : claimRes.code === 'not_ready_yet' ? 'الطلب لسه بيتحضر، استنى شوية'
        : 'حصل خطأ، جرب تاني'
      )
    } else {
      // Only on success. Between the RPC returning and load() finishing, the
      // just-claimed order was still rendered with an enabled button; tapping it
      // again hit the server's already_taken branch and told the driver "another
      // driver took it" about an order they now own. Dropping it on failure too
      // would make a rejected claim (e.g. not_ready_yet) read as "someone else
      // got it" until the next poll put it back.
      setPool(p => p.filter(o => o.id !== orderId))
    }
    await load(true)
    setClaiming(null)
  }


  async function reject() {
    if (!rejecting) return
    const a = rejecting
    await runAction(`reject:${a.id}`, async () => {
      const res = await driverAssignmentAction('rejectAssignment', { assignmentId: a.id, reason: reason.trim() })
      if (!res.ok) { await alertSheet(res.error); return }
      setRejecting(null); setReason(''); load(true)
    })
  }

  // Shown INSTEAD of the board, not over it: the point is that this phone must
  // not see live orders, customer phone numbers or addresses at all.
  if (deviceLocked) {
    return (
      <div className="max-w-sm mx-auto text-center pt-16">
        <p className="text-5xl mb-4">📵</p>
        <h1 className="text-xl font-bold mb-2">حسابك مربوط بموبايل تاني</h1>
        <p className="text-sm text-mist leading-relaxed">
          كل حساب مندوب بيشتغل من موبايل واحد بس. لو ده موبايلك الجديد أو غيّرت
          التليفون، كلّم الإدارة عشان يفكّوا الربط ويشتغل من هنا.
        </p>
        <a href="tel:+201150068077" className="btn-sea w-full !flex items-center justify-center mt-6">
          📞 كلّم الإدارة
        </a>
        <button className="btn-ghost w-full mt-2.5" onClick={() => supabase.auth.signOut()}>
          تسجيل خروج
        </button>
      </div>
    )
  }

  if (!id) return <p className="text-mist text-center py-10">حسابك غير مرتبط بمندوب. تواصل مع الإدارة.</p>
  // `driver` is null until the first load() resolves, which doubles as the
  // initial-load flag -- there is no separate loading state for it. A plain
  // "جاري التحميل…" line here left the page looking blank on slow cellular
  // for up to LOAD_TIMEOUT_MS; a skeleton roughly matching the real layout
  // (header + card list) at least shows something is happening.
  //
  // deviceLocked === null (not yet checked) also holds here, not just !driver.
  // claimDevice() and load() fire in separate effects and race: without this,
  // a phone an admin had just unbound could render the full board -- customer
  // names, phones, addresses -- for however long claimDevice() took to answer,
  // on the exact device the block above exists to keep all of that away from.
  if (!driver || deviceLocked === null) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-3">
          <SkeletonBlock className="h-6 w-32" />
          <SkeletonBlock className="h-8 w-20" />
        </div>
        <SkeletonBlock className="h-16 w-full mb-3" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    )
  }

  const fmt = (t: string | null) => t ? new Date(t).toLocaleTimeString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' }) : ''

  // The assignment query is not filtered by date -- it is the last 20 rows. So
  // تم التوصيل can hold yesterday's runs alongside today's, and a bare 21:40
  // against a cash figure the driver is accountable for is not enough to tell
  // them apart.
  const fmtWhen = (t: string | null) => {
    if (!t) return ''
    // Compared as CAIRO calendar days, not the device's own -- a phone left on
    // UTC (or a driver who just landed from travel) would otherwise mislabel
    // an order delivered right after Cairo midnight as "today" a device-day
    // early, or the reverse.
    const key = cairoDayKey(t)
    const today = cairoToday()
    const yday = shiftDayKey(today, -1)
    const day = key === today ? ''
      : key === yday ? 'امبارح '
      : `${new Date(t).toLocaleDateString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', day: '2-digit', month: '2-digit' })} `
    return day + fmt(t)
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">🛵 {driver.name}</h1>
          <p className="text-sm text-mist">★ {driver.rating} · {driver.total_deliveries} توصيلة{streakDays >= 2 ? ` · 🔥 ${streakDays} أيام متتالية` : ''}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Toggle
            on={!!driver.available}
            onChange={toggleAvailable}
            disabled={isBusy('availability')}
            label={driverStatusLabel(driver.status)}
            labelOff="مش متاح دلوقتي"
          />
          {/* Kept even now that push works: a backgrounded tab still gets its
              timers throttled, and a driver who declined notifications has no
              other way to force a check. */}
          <button
            className="w-11 h-11 rounded-full bg-shellup grid place-items-center text-lg disabled:opacity-50"
            aria-label="تحديث"
            disabled={refreshing}
            onClick={manualRefresh}>
            <span className={refreshing ? 'inline-block animate-spin' : ''}>⟳</span>
          </button>
        </div>
      </div>

      {/* The only other cash_held display lives inside the "الأرباح والورديات"
          accordion below, which stays closed by default once a driver has
          live deliveries -- exactly when the number right after confirming a
          cash order matters most. This chip is always visible regardless of
          that accordion's state. seadeep at the normal level for the same
          contrast reason as the accordion's own copy; switches to a red
          warning within 500 ج.م of the 3000 ج.م safety limit enforced
          server-side, since nothing on this page otherwise hints the limit is
          close until it's already been hit. */}
      {(driver.cash_held ?? 0) > 0 && (
        <div className={`flex items-center justify-between rounded-xl px-3 py-2 mb-3 text-sm font-bold ${
          (driver.cash_held ?? 0) >= 3000 ? 'bg-red-600 text-white'
            : (driver.cash_held ?? 0) >= 2500 ? 'bg-red-500/15 text-red-700'
            : 'bg-shellup text-seadeep'
        }`}>
          <span>💵 كاش معاك دلوقتي</span>
          <span>{driver.cash_held} ج.م{(driver.cash_held ?? 0) >= 2500 ? '. قرّب الحد' : ''}</span>
        </div>
      )}

      {/* The single most useful control on this page. Without it a driver has
          to keep the tab open and foregrounded to learn an order exists. */}
      <EnablePushButton
        required
        onToken={persistPushToken}
      />
      <EnableSoundButton />

      {(syncFailed || (lastSyncAt !== null && Date.now() - lastSyncAt > STALE_AFTER_MS)) && (
        <div className="bg-sand/15 border border-sand/40 rounded-xl p-3 mb-4 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-foam">
            📡 الاتصال ضعيف، اللي ظاهر قدامك ممكن يكون قديم
          </p>
          <button className="btn-ghost !py-2 text-sm shrink-0" disabled={refreshing} onClick={manualRefresh}>
            {refreshing ? '…' : 'حدّث'}
          </button>
        </div>
      )}

      {gpsDenied && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4">
          <p className="text-sm font-semibold text-red-700">
            📍 الموقع مقفول. شغّل الـ GPS عشان الخريطة والوقت المتوقع يشتغلوا
          </p>
          {/* The old copy said WHAT was broken but never HOW to fix it -- a
              driver who tapped "block" on the permission prompt once has no
              way back to it from inside the page (the browser never asks
              again), and no reason to know where phone Settings even is for
              this. There is no web API to jump straight to a specific app's
              permission screen, so this is instructions, not a deep link. */}
          <p className="text-xs text-red-700/80 mt-1.5">
            من إعدادات الموبايل: التطبيقات ← سالكة ← الأذونات ← فعّل الموقع، بعدين ارجع هنا واعمل تحديث
          </p>
        </div>
      )}

      {justDelivered && (
        <div className="fixed inset-0 z-50 bg-white grid place-items-center p-6">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-shellup grid place-items-center text-3xl mx-auto mb-4">✓</div>
            <p className="text-lg font-bold text-foam">تم التسليم</p>
            <div className="bg-shellup rounded-2xl px-5 py-3 mt-5">
              <p className="text-xs text-mist">أرباح النهاردة</p>
              {/* money() and haveStats exist precisely so a failed my_driver_stats
                  renders "— ج.م" instead of a confident zero -- and this overlay,
                  the one full-screen moment a driver actually reads their
                  earnings, used the raw values. Deliver an order with stats down
                  and the celebration said "0 ج.م · 0 طلبات". */}
              <p className="text-lg font-bold text-sea mt-0.5">
                {money(todayEarnings)} · {haveStats ? `${todayOrders} طلبات` : '—'}
              </p>
              {/* Was a hardcoded "+10" that could disagree with the recorded
                  earning. Show the tier progress instead -- it is the number
                  that actually changes what the driver does next. */}
              {/* Same SHOW_BONUS gate as the main panel. This is the second
                  place that promised a bonus nothing awards, and it appears at
                  the highest-trust moment there is -- straight after a
                  successful delivery. */}
              {SHOW_BONUS && bonus?.orders_to_next != null && bonus.next_amount != null && (
                <p className="text-xs text-foam font-semibold mt-2">
                  فاضل {bonus.orders_to_next} طلب لبونص {bonus.next_amount} ج.م
                </p>
              )}
            </div>
            <button className="btn-sea w-full mt-5" onClick={() => setJustDelivered(null)}>↩ رجوع للرئيسية</button>
            <p className="text-xs text-mist mt-2">هيرجعلك تلقائي خلال 3 ثواني</p>
          </div>
        </div>
      )}

      {/* Only shown once there is something in the finished pile -- a driver on
          their first run of the day should not have to parse a tab bar. */}
      {doneAssignments.length > 0 && (
        <div className="flex gap-2 mb-3">
          <button className={`tab flex-1 ${activeTab === 'active' ? 'tab-active' : 'bg-shellup/60'}`}
            onClick={() => setTab('active')}>
            شغل دلوقتي{liveAssignments.length > 0 ? ` (${liveAssignments.length})` : ''}
          </button>
          <button className={`tab flex-1 ${activeTab === 'done' ? 'tab-active' : 'bg-shellup/60'}`}
            onClick={() => setTab('done')}>
            تم التوصيل ({doneAssignments.length})
          </button>
        </div>
      )}

      {/* pool.length guard: this used to print "كل الطلبات اتسلمت ✅" directly
          above a list of unclaimed orders waiting to be taken. */}
      {activeTab === 'active' && liveAssignments.length === 0 && pool.length === 0 && doneAssignments.length > 0 && (
        <p className="card p-5 text-center text-mist text-sm mb-3">مفيش شغل دلوقتي، كل الطلبات اتسلمت ✅</p>
      )}

      <div className="space-y-3" ref={orderListRef}>
        {shown.map(a => {
          const o = a.orders
          if (!o) return null

          // A finished run is a receipt, not a task. It carried the full task
          // card -- progress bar, live map, call/WhatsApp/Maps buttons, the
          // customer's address -- which is why five of them buried the one job
          // that still needed doing.
          if (a.status === 'Delivered') {
            const collected = o.payment_method === 'instapay' ? 0
              : o.cod_deposit_amount != null ? Math.round((o.total - o.cod_deposit_amount) * 100) / 100
              : o.total
            return (
              <div key={a.id} className="card !rounded-2xl p-3.5 flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center shrink-0">✓</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate">#{o.id} — {o.restaurants?.name}</p>
                  <p className="text-xs text-mist mt-0.5 truncate">
                    {o.zone}{a.delivered_at ? ` · ${fmtWhen(a.delivered_at)}` : ''}
                  </p>
                </div>
                <span className="text-sm font-semibold text-emerald-700 shrink-0">
                  {collected > 0 ? `${collected} ج.م` : 'مدفوع'}
                </span>
              </div>
            )
          }

          // Same reasoning as the Delivered receipt above: a job that is no
          // longer the driver's is not a task, so it must not wear a task card.
          // It used to render the FULL card -- address, customer phone, live
          // map, progress bar, action buttons -- with a red banner bolted on
          // underneath. A driver scanning the screen sees card shapes, not
          // banners.
          const dead = terminalNotice(a)
          if (dead) {
            return (
              <div key={a.id} className="card !rounded-2xl p-3.5 flex items-center gap-3 border-line">
                <span className="w-9 h-9 rounded-full bg-shellup text-mist grid place-items-center shrink-0">✕</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate">#{o.id} — {o.restaurants?.name}</p>
                  <p className="text-xs text-mist mt-0.5">
                    {dead.moved ? 'الطلب اتنقل لمندوب تاني'
                      : a.status === 'Failed' ? 'اتسجل كتوصيل فاشل'
                      : 'الطلب اتلغى'}
                  </p>
                  {dead.held && (
                    <p className="text-xs text-sandink font-semibold mt-1">
                      الأكل معاك؟ كلّم الإدارة قبل ما تتحرك
                    </p>
                  )}
                </div>
                {/* Same number as the device-locked screen's call button.
                    Telling a driver standing somewhere holding food to "call
                    admin" with no number on screen is not a real instruction. */}
                {dead.held && (
                  <a href="tel:+201150068077" className="btn-sea !py-2 !px-3 text-xs shrink-0 !flex items-center gap-1">
                    📞 اتصال
                  </a>
                )}
              </div>
            )
          }

          const cashDue = o.payment_method === 'instapay' ? 0
            : o.cod_deposit_amount != null ? Math.round((o.total - o.cod_deposit_amount) * 100) / 100
            : o.total
          const stages = cashDue > 0 ? [
            { key: 'Accepted', label: 'قبلت' },
            { key: 'Picked_Up', label: 'استلمت' },
            { key: 'Out_for_Delivery', label: 'في الطريق' },
            { key: 'Cash_Confirmed', label: 'استلمت الكاش' },
            { key: 'Delivered', label: 'وصل' },
          ] : [
            { key: 'Accepted', label: 'قبلت' },
            { key: 'Picked_Up', label: 'استلمت' },
            { key: 'Out_for_Delivery', label: 'في الطريق' },
            { key: 'Delivered', label: 'وصل' },
          ]
          const stageIndex = a.status === 'Out_for_Delivery' && cashDue > 0 && a.cash_confirmed_at
            ? stages.findIndex(s => s.key === 'Cash_Confirmed')
            : stages.findIndex(s => s.key === a.status)
          // No Delivered case: those returned above as a compact row.
          const statusColor = a.status === 'Offered' ? 'bg-sand/15 text-sandink' : 'bg-sea/10 text-sea'
          const destLat = o.compounds?.latitude ?? null
          const destLng = o.compounds?.longitude ?? null
          const etaMin = (myPos && destLat != null && destLng != null && a.status === 'Out_for_Delivery')
            ? Math.max(1, Math.round(haversineKm(myPos.lat, myPos.lng, destLat, destLng) / 25 * 60))
            : null
          return (
            <div key={a.id} className="card !rounded-2xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-bold truncate">طلب #{o.id}: {o.restaurants?.name}</h2>
                  <p className="text-sm mt-0.5">
                    {o.payment_method === 'instapay' ? (
                      <span className="inline-flex items-center gap-1 text-sea font-semibold">🔵 مدفوع أونلاين بالكامل، متحصلش فلوس</span>
                    ) : o.cod_deposit_amount != null ? (
                      <span className="inline-flex items-center gap-2 flex-wrap">
                        <span className="text-sea font-semibold">🔵 عربون مدفوع: {o.cod_deposit_amount} ج.م</span>
                        <span className="text-emerald-700 font-semibold">🟢 حصّل: {Math.round((o.total - o.cod_deposit_amount) * 100) / 100} ج.م</span>
                      </span>
                    ) : (
                      <span className="text-emerald-700 font-semibold">🟢 حصّل: {o.total} ج.م كاش</span>
                    )}
                  </p>
                </div>
                <span className={`text-xs font-semibold rounded-full px-2.5 py-1 shrink-0 ${statusColor}`}>
                  {a.status === 'Offered' ? 'عرض جديد' : assignmentStatusLabel(a.status)}
                </span>
              </div>

              {a.status !== 'Offered' && o.pickup_location_name && (
                <div className="mt-3 rounded-xl border border-sea/30 bg-sea/10 p-3 text-sm">
                  <p className="font-bold text-sea">📍 استلم من: {o.pickup_location_name}</p>
                  {o.pickup_location_address && <p className="mt-1 text-mist whitespace-pre-wrap">{o.pickup_location_address}</p>}
                </div>
              )}

              {stageIndex >= 0 && (
                <div className="relative mt-4 px-2">
                  <div className="absolute top-[5px] right-2 left-2 h-0.5 bg-line" />
                  <div className="absolute top-[5px] h-0.5 bg-sea" style={{ right: 8, width: `calc(${stageIndex / (stages.length - 1)} * (100% - 16px))` }} />
                  <div className="relative flex justify-between">
                    {stages.map((s, i) => {
                      const isCashStage = s.key === 'Cash_Confirmed'
                      const done = i < stageIndex
                      const current = i === stageIndex
                      const dotColor = !done && !current ? 'bg-line'
                        : isCashStage && current ? 'bg-sand' : 'bg-sea'
                      const labelColor = !done && !current ? 'text-mist'
                        : isCashStage && current ? 'text-sandink' : 'text-sea'
                      return (
                        <div key={s.key} className="flex flex-col items-center gap-1" style={{ width: `${100 / stages.length}%` }}>
                          <div className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
                          {/* 10px was below comfortable at-a-glance size for
                              text a driver reads while riding to confirm
                              which stage a delivery is on -- bumped to the
                              smallest size Tailwind still calls legible. */}
                          <span className={`text-[11px] font-semibold text-center ${labelColor}`}>{s.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {(a.status === 'Accepted' || a.status === 'Out_for_Delivery') && (
                <div className="mt-3 relative">
                  <DriverActiveMap
                    destLat={a.status === 'Out_for_Delivery' ? destLat : null}
                    destLng={a.status === 'Out_for_Delivery' ? destLng : null}
                    showRoute={a.status === 'Out_for_Delivery'}
                    myPos={myPos}
                    locationDenied={gpsDenied}
                  />
                  {etaMin != null && (
                    <div className="absolute top-2.5 right-2.5 bg-white rounded-xl px-3 py-1.5 text-xs font-bold text-sea shadow-sm">
                      {etaMin} دقايق
                    </div>
                  )}
                </div>
              )}

              {/* An offer is a yes/no question: which restaurant, where to, how
                  much cash. The customer's name, exact unit and the call /
                  WhatsApp / Maps buttons are for a job you have taken -- shown
                  before accepting they are clutter on the deciding screen, and
                  they hand out a customer's phone number to a driver who may
                  well reject the run. */}
              {a.status === 'Offered' ? (
                <div className="mt-3 bg-night border border-line rounded-xl p-3.5 text-sm">
                  <p className="text-mist flex items-start gap-1.5">
                    <Icon name="locationDot" className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>التوصيل لـ {o.zone}</span>
                  </p>
                </div>
              ) : (
              <div className="mt-3 bg-night border border-line rounded-xl p-3.5 text-sm space-y-2">
                <p className="font-semibold">{o.customer_name}</p>
                <p className="text-mist flex items-start gap-1.5">
                  <Icon name="locationDot" className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{o.zone}، وحدة {o.unit_number}</span>
                </p>
                {o.address_notes && (
                  <p className="text-sea bg-sea/10 rounded-lg p-2 font-semibold">📝 {o.address_notes}</p>
                )}
                {o.customer_note?.trim() && (
                  <div className="border border-sand/40 bg-sand/10 rounded-lg p-2.5">
                    <p className="text-xs font-bold text-sandink">💬 ملاحظة العميل</p>
                    <p className="mt-1 font-semibold whitespace-pre-wrap">{o.customer_note}</p>
                  </div>
                )}
                {/* These three are tapped one-handed, outdoors, at the moment of
                    arrival. The !py-1.5 + text-xs overrides dropped them to
                    ~28px; min-h-[44px] restores the platform touch minimum. */}
                <div className="flex gap-2 pt-1">
                  <a className="btn-ghost !px-2 text-sm flex-1 min-h-[44px] inline-flex items-center justify-center whitespace-nowrap" href={`tel:${o.customer_phone}`}>اتصال</a>
                  <a className="btn-ghost !px-2 text-sm flex-1 min-h-[44px] inline-flex items-center justify-center whitespace-nowrap" href={`https://wa.me/${o.customer_phone.replace(/^0/, '20').replace('+', '')}`} target="_blank" rel="noreferrer">واتساب</a>
                  {destLat != null && destLng != null && (
                    <a className="btn-sea !px-2 text-sm flex-1 min-h-[44px] inline-flex items-center justify-center whitespace-nowrap"
                      href={`https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}&travelmode=driving`}
                      target="_blank" rel="noreferrer">خرائط</a>
                  )}
                </div>
              </div>
              )}

              {/* A driver_pays pickup means the driver puts their OWN money in
                  the vendor's till and gets it back from the customer. The
                  customer is told this on the tracking page; the driver was
                  told only "حصّل: 465" -- the sum of both halves -- with no
                  hint that 400 of it leaves their pocket first. */}
              {o.order_type === 'pickup_request' && o.payment_mode === 'driver_pays' && o.collect_amount != null && (
                <p className="mt-3 text-sm text-sandink bg-sandink/10 rounded-xl p-3 font-semibold">
                  💵 هتدفع {o.collect_amount} ج.م للمحل من فلوسك، وتحصّلها من العميل مع التوصيل
                </p>
              )}

              {/* An order the admin pulled or wrote off. Without this the card
                  silently disappeared mid-delivery. */}
              {/* The Cancelled/Failed banner that used to sit here is gone: those
                  assignments now return the compact dead-card above and never
                  reach this point, so the block was unreachable. Its wording
                  also leaked rejection_reason straight to the driver, which is
                  an internal string ("admin_unassigned", or in one live row
                  just "x"). */}

              <div className="mt-3">
                {a.status === 'Offered' && (
                  <div className="flex gap-3">
                    <button className="btn-sea flex-1" disabled={isBusy(`accept:${a.id}`)} onClick={() => setStatus(a, 'Accepted')}>
                      {isBusy(`accept:${a.id}`) ? 'لحظة…' : 'قبول'}
                    </button>
                    {/* Reject is reversible (the order just goes to another
                        driver) and rarely the right tap in the second a
                        driver has to decide -- btn-danger's red made it read
                        as the more urgent/prominent of the two buttons,
                        backwards from what the decision actually calls for.
                        btn-ghost keeps it clearly tappable without competing
                        with Accept for attention. */}
                    <button className="btn-ghost flex-1" onClick={() => setRejecting(a)}>رفض</button>
                  </div>
                )}
                {a.status === 'Accepted' && !a.arrived_at_restaurant_at && (
                  <button className="btn-sea w-full" disabled={isBusy(`arrived:${a.id}`)} onClick={() => markArrived(a)}>
                    {isBusy(`arrived:${a.id}`) ? 'لحظة…' : `📍 وصلت ${vendorNoun(a.orders?.restaurants?.vendor_type)}`}
                  </button>
                )}
                {a.status === 'Accepted' && a.arrived_at_restaurant_at && (
                  <button className="btn-sea w-full" disabled={isBusy(`pickup:${a.id}`)} onClick={() => markPickedUp(a)}>
                    {isBusy(`pickup:${a.id}`) ? 'لحظة…' : `استلمت الطلب من ${vendorNoun(a.orders?.restaurants?.vendor_type)}`}
                  </button>
                )}
                {a.status === 'Picked_Up' && (
                  <button className="btn-sea w-full" disabled={isBusy(`out:${a.id}`)} onClick={() => markOutForDelivery(a)}>
                    {isBusy(`out:${a.id}`) ? 'لحظة…' : 'خرجت للتوصيل'}
                  </button>
                )}
                {['Accepted', 'Picked_Up'].includes(a.status) && (
                  <button className="btn-ghost w-full text-sm mt-2"
                    disabled={isBusy(`problem:${a.id}`)}
                    onClick={() => reportProblem(a)}>
                    {isBusy(`problem:${a.id}`) ? 'لحظة…' : 'في مشكلة؟ بلّغ الإدارة'}
                  </button>
                )}

                {a.status === 'Out_for_Delivery' && (() => {
                  const confirmed = cashDue === 0 || !!a.cash_confirmed_at || cashConfirmed.has(a.id)
                  return (
                    <div className="space-y-2">
                      {cashDue > 0 && !a.cash_confirmed_at && (
                        <button
                          className="w-full flex items-center gap-2 text-sm bg-emerald-500/10 rounded-xl p-3 text-right disabled:opacity-60"
                          disabled={isBusy(`cash:${a.id}`) || cashConfirmed.has(a.id)}
                          onClick={() => confirmCash(a, cashDue)}>
                          <span className={`w-5 h-5 rounded border-2 shrink-0 grid place-items-center ${cashConfirmed.has(a.id) ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-emerald-600'}`}>
                            {cashConfirmed.has(a.id) ? '✓' : ''}
                          </span>
                          <span className="text-emerald-800 font-semibold">
                            {isBusy(`cash:${a.id}`) ? 'جاري التأكيد…' : `أكدت إني استلمت ${cashDue} ج.م كاش من العميل`}
                          </span>
                        </button>
                      )}
                      {cashDue > 0 && a.cash_confirmed_at && (
                        <p className="text-emerald-800 bg-emerald-500/10 rounded-xl p-3 text-sm font-semibold text-center">✓ استلمت الكاش</p>
                      )}
                      {/* Above the delivery swipe, because it happens before it:
                          arriving is not the same event as handing the bag over,
                          and the customer needs the first one to come outside. */}
                      {a.arrived_at_customer_at ? (
                        <p className="text-mist text-xs text-center">✓ العميل اتبلّغ إنك وصلت</p>
                      ) : (
                        <button className="btn-ghost w-full text-sm" disabled={isBusy(`arrived:${a.id}`)}
                          onClick={() => markArrivedAtCustomer(a)}>
                          {isBusy(`arrived:${a.id}`) ? 'لحظة…' : '📍 وصلت. بلّغ العميل'}
                        </button>
                      )}
                      <SwipeToConfirm
                        label={isBusy(`deliver:${a.id}`) ? 'جاري التأكيد…'
                          : !confirmed ? 'أكد استلام الكاش الأول ☝️'
                          : 'اسحب لتأكيد التسليم'}
                        disabled={!confirmed || isBusy(`deliver:${a.id}`)}
                        onConfirm={() => setStatus(a, 'Delivered')} />

                      {/* These are escalation paths, not the next tap in the
                          normal flow -- visually the same weight as "وصلت"
                          above made all four ghost buttons in this block
                          read as interchangeable steps on a glance while
                          riding. A border and smaller, muted text mark this
                          as a separate "something's wrong" group instead of
                          part of the primary arrived-then-deliver sequence. */}
                      <div className="pt-2 mt-1 border-t border-line/60 space-y-1.5">
                        {a.no_answer_reported_at ? (
                          <p className="text-sandink text-xs text-center">
                            ⏳ اتبلّغت الإدارة، مستنيين قرارهم
                            {a.delivery_problem_reason ? ` — "${a.delivery_problem_reason}"` : ''}
                          </p>
                        ) : !a.called_customer_at ? (
                          <button className="btn-ghost w-full !py-2 text-xs text-mist" disabled={isBusy(`called:${a.id}`)} onClick={() => markCalledCustomer(a)}>
                            {isBusy(`called:${a.id}`) ? 'لحظة…' : '📞 اتصلت بالعميل ومردش'}
                          </button>
                        ) : (a.out_for_delivery_at && (Date.now() - +new Date(a.out_for_delivery_at)) >= 5 * 60000) ? (
                          <button className="btn-danger w-full text-sm" onClick={() => reportNoAnswer(a)}>العميل لسه ما ردش. بلّغ الإدارة</button>
                        ) : (
                          <p className="text-mist text-xs text-center">✓ اتصلت، لو ما ردش خلال 5 دقايق من خروجك، هيظهر لك زرار الإبلاغ</p>
                        )}
                        <button className="btn-ghost w-full !py-2 text-xs text-mist"
                          disabled={isBusy(`problem:${a.id}`)}
                          onClick={() => reportProblem(a)}>
                          {isBusy(`problem:${a.id}`) ? 'لحظة…' : 'في مشكلة؟ بلّغ الإدارة'}
                        </button>
                      </div>
                    </div>
                  )
                })()}
              </div>

              {(a.responded_at || a.picked_up_at || a.delivered_at) && (
                <div className="mt-3 pt-2.5 border-t border-line text-xs text-mist flex flex-wrap gap-x-4 gap-y-1">
                  {a.responded_at && <span>القبول: {fmt(a.responded_at)}</span>}
                  {a.picked_up_at && <span>الاستلام: {fmt(a.picked_up_at)}</span>}
                  {a.delivered_at && <span>التسليم: {fmt(a.delivered_at)}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Unclaimed orders, directly under the driver's own work.

          This block used to sit BELOW the earnings-and-shifts panel, so a new
          order nobody had taken yet was the last thing on the page -- under
          today's takings, the bonus meter, the next shift and the swap board.
          These are first-come-first-served: burying them does not just annoy
          the driver, it hands the order to whoever scrolled less. */}
      {activeTab === 'active' && pool.length > 0 && (
        <div className="mb-5">
          <h2 className="font-bold text-mist mb-3">طلبات متاحة، أول واحد يقبل ياخدها</h2>
          {pool.some(o => o.dest_lat != null && o.dest_lng != null) && (
            <div className="mb-3">
              <DriverPoolMap
                pins={pool.filter(o => o.dest_lat != null && o.dest_lng != null)
                  .map(o => ({ id: o.id, lat: o.dest_lat!, lng: o.dest_lng! }))}
                selectedId={selectedPoolId}
                onSelect={setSelectedPoolId}
                myPos={myPos}
              />
            </div>
          )}
          <div className="space-y-3">
            {pool.map(o => {
              const notReadyYet = !!o.dispatch_at && new Date(o.dispatch_at) > new Date()
              const minsLeft = notReadyYet ? Math.max(1, Math.round((+new Date(o.dispatch_at!) - Date.now()) / 60000)) : 0
              const isSelected = selectedPoolId === o.id
              return (
                <div key={o.id}
                  className={`card !rounded-2xl p-4 ${isSelected ? 'border-sea border-2' : notReadyYet ? 'border-line opacity-80' : 'border-sea/40'}`}
                  onClick={() => setSelectedPoolId(o.id)}>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold">{o.restaurant_name}</h3>
                      <p className="text-sm text-mist mt-0.5">📍 {o.zone}</p>
                      <p className="text-xs text-mist mt-1">
                        {notReadyYet ? `🕐 هيبقى جاهز خلال ${minsLeft} د`
                          : o.kitchen_status === 'ready' ? '✅ جاهز للاستلام'
                          : o.kitchen_status === 'preparing' ? '👨‍🍳 قيد التحضير' : `🕐 ${vendorNoun(o.vendor_type)} لسه ما بدأش`}
                      </p>
                    </div>
                    {/* Order value is irrelevant to driver pay under the flat
                        10 EGP model, but it was the boldest brand-coloured
                        number on the card -- styled exactly like the earnings
                        figure -- which reads as "this one pays more" and invites
                        cherry-picking. Labelled and de-emphasised. */}
                    <div className="text-left shrink-0">
                      <p className="text-[10px] text-mist leading-none">قيمة الطلب</p>
                      <p className="text-sm text-mist mt-0.5">{o.total} ج.م</p>
                    </div>
                  </div>
                  <button className="btn-sea w-full mt-3" disabled={claiming !== null || notReadyYet}
                    onClick={e => { e.stopPropagation(); claim(o.id) }}>
                    {claiming === o.id ? 'جاري القبول…'
                      : notReadyYet ? (minsLeft > 0 ? `لسه مش جاهز، بعد ${minsLeft} د` : 'لسه مش جاهز')
                      : 'خد الطلب ده'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Everything below this point is reference, not work.

          It used to sit ABOVE the order being delivered: today's earnings, the
          bonus meter, unpaid balance, the next shift and shift-swap requests --
          then, after all of that, the address and phone number of the customer
          waiting right now. A driver on a motorbike had to scroll past five
          cards of information they cannot act on to reach the one they can.

          Nothing is removed. It is collapsed, and it opens by default when
          there is no active delivery, which is exactly when a driver is
          looking at their earnings and shifts anyway. */}
      {/* Controlled, with the initial value latched once -- NOT open={assignments.length === 0}.
          That reads correctly and is wrong in the field: `open` is a controlled
          prop, so the moment a new assignment arrived (0 -> 1) React flipped it
          to false and slammed the panel shut under the thumb of a driver who
          was reading their earnings. The 8s poll would do it again on every
          change. Now the driver's own toggle always wins. */}
      <details className="mb-5" open={refsOpen}
        onToggle={e => setRefsOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="card px-4 py-3 cursor-pointer list-none flex items-center justify-between select-none min-h-[44px]">
          <span className="font-semibold text-sm">💰 الأرباح والورديات</span>
          <span className="text-mist text-xs">{money(todayEarnings)} · اضغط للتفاصيل</span>
        </summary>
        <div className="mt-3">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="card p-4">
          <p className="text-xs text-mist">أرباح النهاردة</p>
          <p className="text-xl font-bold text-sea mt-1">{money(todayEarnings)}</p>
          {todayTips > 0 && <p className="text-xs text-seadeep font-semibold mt-1">+ {todayTips} ج.م إكراميات</p>}
          {todayReportedTips > 0 ? (
            <p className="text-xs text-amber-700 font-semibold mt-1">
              العميل أبلغ بتحويل {todayReportedTips} ج.م. راجع إنستاباي
            </p>
          ) : null}
        </div>
        <div className="card p-4">
          <p className="text-xs text-mist">طلبات النهاردة</p>
          <p className="text-xl font-bold text-foam mt-1">{haveStats ? todayOrders : '—'}</p>
        </div>
      </div>

      {/* The tiered daily bonus is the strongest lever in the pay model and had
          no representation in the UI at all -- the driver could not see how
          close they were to the next tier during the only window where it can
          change what they do. */}
      {/* HIDDEN 2026-08-05, at Wael's instruction, and it should stay hidden
          until the bonus is real.
          check_and_award_shift_bonus() exists but is called from nowhere in the
          codebase -- driver_shift_bonuses has never had a row and never will
          until something invokes it. Meanwhile this panel told a driver
          "X ج.م مضمونين" and "فاضل N طلب توصل لبونص". That is a written promise
          of money the system cannot pay. The tiers are also 24/30/38 completed
          orders in a single day, which nobody reaches in launch week even if
          the award did fire.
          To bring it back: call check_and_award_shift_bonus(driver_id) from
          wherever driver_earnings rows are created, set reachable tiers in
          settings, then flip SHOW_BONUS to true. */}
      {SHOW_BONUS && bonus && Array.isArray(bonus.tiers) && bonus.tiers.length > 0 && (
        <div className="card p-4 mb-4">
          <div className="flex items-baseline justify-between mb-2.5">
            <p className="text-xs text-mist">بونص النهاردة</p>
            <p className="text-sm font-bold text-foam">
              {bonus.earned_today > 0 ? `${bonus.earned_today} ج.م مضمونين` : 'لسه ما وصلتش أول مرحلة'}
            </p>
          </div>

          <div className="relative h-2 rounded-full bg-shellup overflow-hidden">
            <div
              className="absolute inset-y-0 right-0 bg-sea rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.min(100, Math.round(
                  (todayOrders / Math.max(1, bonus.tiers[bonus.tiers.length - 1].orders)) * 100
                ))}%`
              }}
            />
          </div>

          <div className="flex justify-between mt-2">
            {bonus.tiers.map((t, i) => {
              const reached = todayOrders >= t.orders
              return (
                <div key={t.orders} className={`text-center ${i === 0 ? 'text-right' : i === bonus.tiers.length - 1 ? 'text-left' : ''}`}>
                  <p className={`text-[11px] font-bold ${reached ? 'text-sea' : 'text-mist'}`}>
                    {reached ? '✓ ' : ''}{t.amount} ج.م
                  </p>
                  <p className="text-[10px] text-mist">{t.orders} طلب</p>
                </div>
              )
            })}
          </div>

          {bonus.orders_to_next != null && bonus.next_amount != null && (
            <p className="text-sm font-semibold text-foam mt-3 text-center bg-shellup rounded-lg py-2">
              فاضل <span className="text-sea">{bonus.orders_to_next}</span> طلب توصل لبونص {bonus.next_amount} ج.م
            </p>
          )}
          {bonus.orders_to_next == null && (
            <p className="text-sm font-semibold text-sea mt-3 text-center bg-sea/10 rounded-lg py-2">
              🎉 وصلت لأعلى بونص النهاردة
            </p>
          )}
        </div>
      )}

      <div className="card p-4 mb-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-mist">أرباح لسه ما اتصرفتش</p>
            <p className="text-lg font-bold text-sea mt-0.5">{money(unpaidEarnings)}</p>
          </div>
          <div>
            <p className="text-xs text-mist">كاش معاك دلوقتي</p>
            {/* text-sandink is ~2.7:1 on white -- below WCAG AA, and this is read
                in direct sunlight. seadeep carries the same "money you owe"
                meaning at a legible contrast. */}
            <p className="text-lg font-bold text-seadeep mt-0.5">{driver.cash_held ?? 0} ج.م</p>
          </div>
        </div>
        {settlementSent ? (
          <p className="text-emerald-700 text-sm text-center mt-3">✅ طلب التسوية المبكرة وصل للإدارة</p>
        ) : (
          <button className="btn-ghost w-full mt-3 text-sm" disabled={requestingSettlement || !haveStats || unpaidEarnings === 0} onClick={requestSettlement}>
            {/* disabled:pointer-events-none means a dead button does not even
                flash. The !haveStats case is the cruel one: the figure above
                reads "— ج.م" and the button is dead, so a driver whose stats
                call failed reads it as "the system lost my money". */}
            {requestingSettlement ? 'جاري الإرسال…'
              : !haveStats ? 'مش قادرين نجيب أرباحك. حدّث الصفحة'
              : unpaidEarnings === 0 ? 'مفيش أرباح مستحقة دلوقتي'
              : 'اطلب تسوية مبكرة'}
          </button>
        )}
      </div>

      {shifts.length > 0 && (
        <div className="mb-5">
          <h2 className="font-bold text-mist mb-3">ورديتك القادمة</h2>
          <div className="space-y-3">
            {shifts.map(sh => {
              const requested = myOpenRequests.has(sh.id)
              const myRequestId = myOpenRequests.get(sh.id)
              return (
                <div key={sh.id} className="card p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">
                        {new Date(sh.shift_date).toLocaleDateString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'numeric' })}
                      </p>
                      <p className="text-sm text-mist mt-0.5">{sh.start_time.slice(0,5)} — {sh.end_time.slice(0,5)}</p>
                    </div>
                    {sh.status === 'swapped' && <span className="bg-shellup text-mist text-xs font-semibold rounded-full px-2.5 py-1">اتبدلت</span>}
                  </div>

                  {sh.status === 'scheduled' && !requested && !myEscalated.has(sh.id) && (
                    <div className="mt-3 flex gap-2">
                      <input className="field !py-1.5 text-sm" placeholder="سبب الاستبدال (اختياري)"
                        value={swapReason[sh.id] || ''}
                        onChange={e => setSwapReason({ ...swapReason, [sh.id]: e.target.value })} />
                      <button className="btn-ghost !py-1.5 text-sm shrink-0" onClick={() => requestSwap(sh.id)}>
                        طلب استبدال
                      </button>
                    </div>
                  )}
                  {requested && myRequestId && (
                    <div className="mt-3">
                      <p className="text-sandink text-sm">⏳ طلب الاستبدال معروض على باقي المندوبين</p>
                      <button className="btn-danger w-full mt-2 text-sm"
                        onClick={() => escalate(myRequestId)}>
                        محدش وافق. بلّغ الإدارة
                      </button>
                    </div>
                  )}
                  {myEscalated.has(sh.id) && (
                    <p className="text-emerald-700 text-sm mt-3">✅ تم إبلاغ الإدارة، في انتظار تعيين مندوب بديل</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {swaps.filter(s => !myOpenRequests.has(s.shift_id)).length > 0 && (
        <div className="mb-5">
          <h2 className="font-bold text-mist mb-3">ورديات محتاجة مندوب بديل</h2>
          <div className="space-y-3">
            {swaps.filter(s => !myOpenRequests.has(s.shift_id)).map(sw => (
              <div key={sw.request_id} className="card p-4 border-sand/40">
                <p className="font-semibold">
                  {new Date(sw.shift_date).toLocaleDateString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'numeric' })}
                  {' '}· {sw.start_time.slice(0,5)}–{sw.end_time.slice(0,5)}
                </p>
                <p className="text-sm text-mist mt-1">مطلوبة من {sw.requested_by_name}</p>
                {sw.reason && <p className="text-sm text-mist mt-0.5">"{sw.reason}"</p>}
                <button className="btn-sea w-full mt-3" onClick={() => acceptSwap(sw.request_id)}>
                  أقبل الوردية
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
        </div>
      </details>



      {assignments.length === 0 && pool.length === 0 && !syncFailed && (
        <div className="card p-6 text-center text-mist">لا توجد طلبات حالياً</div>
      )}
      {assignments.length === 0 && pool.length === 0 && syncFailed && (
        <div className="card p-6 text-center">
          <p className="text-mist">مش قادرين نجيب الطلبات دلوقتي</p>
          <button className="btn-ghost mt-3 text-sm" disabled={refreshing} onClick={manualRefresh}>
            {refreshing ? '…' : 'حاول تاني'}
          </button>
        </div>
      )}

      {rejecting && (
        <div ref={rejectingRef} className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" role="dialog" aria-labelledby="reject-reason-title" aria-modal="true" onClick={() => setRejecting(null)}>
          <div className="card w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 id="reject-reason-title" className="font-bold mb-3">سبب الرفض</h3>
            <input className="field" value={reason} onChange={e => setReason(e.target.value)} placeholder="مثال: بعيد عن منطقتي" />
            <div className="flex gap-3 mt-4">
              <button className="btn-ghost flex-1" disabled={isBusy(`reject:${rejecting.id}`)} onClick={() => setRejecting(null)}>إلغاء</button>
              <button className="btn-danger flex-1" disabled={isBusy(`reject:${rejecting.id}`)} onClick={reject}>
                {isBusy(`reject:${rejecting.id}`) ? 'لحظة…' : 'تأكيد الرفض'}
              </button>
            </div>
          </div>
        </div>
      )}
      {sheetElement}
    </div>
  )
}
