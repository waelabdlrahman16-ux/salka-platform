import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { issueQuote as sendQuote, previewQuote, viewStaffQuote, type QuotePreview, type QuoteView } from '../lib/quoteOperations'
import { adminReport } from '../lib/adminReports'
import { dispatchOperation } from '../lib/dispatchOperations'
import { vendorOperation } from '../lib/vendorOperations'
import { useAuth } from '../lib/auth'
import { useDismissable } from '../lib/useDismissable'
import { ping } from '../lib/notify'
import { registerPush, persistPushToken } from '../lib/push'
import { orderStatusLabel, assignmentStatusLabel, cancelReasonLabel } from '../lib/statusLabels'
import type { Assignment, Driver, LiveDelivery, Order } from '../lib/types'
import Icon from '../components/Icon'
import EnablePushButton from '../components/EnablePushButton'
import EnableSoundButton from '../components/EnableSoundButton'
import LiveDeliveryDetail from '../components/LiveDeliveryDetail'
import PhoneOrderForm from '../components/PhoneOrderForm'
import { useSheets } from '../components/ActionSheets'
import { OrderLines, PriceBreakdown } from '../components/OrderDetail'

// The operations supervisor.
//
// Restaurants are not logging into the vendor screen, so a Salka staff member
// phones them and works the order on their behalf, and also runs dispatch.
//
// The pharmacy and the supermarket are DIFFERENT: nobody is phoned, because
// there is no counter waiting to cook. The supervisor goes and buys the order
// themselves, and the price is not known until they are holding the receipt.
// That is why this screen prices those orders and the vendor screen does not --
// getting a pharmacy or market order ready for pickup is the supervisor's job,
// not the vendor's. (Until 2026-08-07 the database enforced the exact opposite:
// supervisor_may_touch_order() admitted catalog orders AND excluded
// pharmacy/supermarket, so the only way to work one was to sign in as the
// vendor account. That is what the accounts were being used for.)
//
// This is a separate page rather than a filtered Admin because Admin is 2,000
// lines across fourteen tabs, and "the same screen with things hidden" is how a
// permission leak happens -- a hidden button is still a button. The real
// boundary is in the database: RLS decides what this role reads, and every RPC
// below re-checks supervisor_may_touch_order(). Verified by executing it as the
// supervisor: settle_driver_cash and admin_confirm_instapay_payment both still
// refuse with admin_only.
//
// So this file does not need to be defensive. It needs to be SHORT, so the
// person on the phone at 1am can see the whole job at once.

const ACTIVE_STATUSES = ['Offered', 'Accepted', 'Picked_Up', 'Out_for_Delivery']
const HISTORY_ORDER_STATUSES = ['Delivered', 'Cancelled']

const PREP_CHOICES = [15, 20, 30]
type SupervisorTab = 'calls' | 'phone' | 'drivers' | 'live' | 'history'
type WorkTab = Exclude<SupervisorTab, 'phone' | 'history'>
const HISTORY_PAGE_SIZE = 25
const SUPERVISOR_TAB_KEY = 'salka-supervisor-active-tab'

function storedSupervisorTab(): SupervisorTab {
  try {
    const tab = sessionStorage.getItem(SUPERVISOR_TAB_KEY)
    return tab === 'calls' || tab === 'phone' || tab === 'drivers' || tab === 'live' || tab === 'history' ? tab : 'calls'
  } catch { return 'calls' }
}

export default function Supervisor() {
  const { profile, signOut } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [historyOrders, setHistoryOrders] = useState<Order[]>([])
  const [historyAssignments, setHistoryAssignments] = useState<Assignment[]>([])
  const [activeTab, setActiveTab] = useState<SupervisorTab>(storedSupervisorTab)
  const [unreadTabs, setUnreadTabs] = useState<Set<SupervisorTab>>(() => new Set())
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyPage, setHistoryPage] = useState(0)
  const [openHistory, setOpenHistory] = useState<number | null>(null)
  const [historyItems, setHistoryItems] = useState<Record<number, OrderItemSummary[]>>({})
  const [historyError, setHistoryError] = useState('')
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  // Keyed by assignment_id. admin_live_deliveries() already admits a supervisor
  // -- they are the person actually watching dispatch at 1am, so they need the
  // bag contents and the rider's pin more than the admin does. Enrichment, not
  // a replacement: `assignments` still drives the list, so the escalation
  // counter and the assign modal are untouched.
  const [liveById, setLiveById] = useState<Record<number, LiveDelivery>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [assigning, setAssigning] = useState<Order | null>(null)
  const [modalError, setModalError] = useState('')
  const knownOrderIds = useRef<Set<number>>(new Set())
  const knownTabIds = useRef<Record<WorkTab, Set<number>> | null>(null)
  const currentTabIds = useRef<Record<WorkTab, Set<number>>>({ calls: new Set(), drivers: new Set(), live: new Set() })
  const firstLoad = useRef(true)
  const { confirmSheet, promptSheet, sheetElement } = useSheets()
  const assigningRef = useDismissable(() => setAssigning(null), !!assigning)
  // The error banner sits at the top of the page; an escalation card an
  // action fails on can be scrolled well below it in a long list, so a
  // failed "يستنى" (or any other resolve action) could look like it silently
  // did nothing. Scroll the banner into view the moment it has something to say.
  const errorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])

  async function load() {
    const [o, a, d, live] = await Promise.all([
      supabase.from('orders').select('*, restaurants(name, vendor_type)')
        .not('status', 'in', '("Delivered","Cancelled")')
        .order('id', { ascending: false }),
      supabase.from('delivery_assignments').select('*, orders(*, restaurants(name)), drivers(*)')
        .in('status', ACTIVE_STATUSES).order('id', { ascending: false }),
      supabase.from('drivers').select('*').eq('active', true).order('name'),
      adminReport<LiveDelivery[]>('liveDeliveries'),
    ])
    if (o.error || a.error || d.error) {
      setError('مش قادرين نحمّل الطلبات دلوقتي. اتأكد من النت')
      setLoading(false)
      return
    }
    const rows = (o.data ?? []) as Order[]

    // A new order should make a noise. The supervisor is not watching a screen,
    // they are on the phone to a restaurant.
    if (!firstLoad.current) {
      const fresh = rows.filter(x => !knownOrderIds.current.has(x.id))
      if (fresh.length > 0) ping('supervisor_new_order', fresh.length, 'طلب جديد 🛎️', 'في طلب جديد محتاج تتصل بالمطعم')
    }
    knownOrderIds.current = new Set(rows.map(x => x.id))
    firstLoad.current = false

    setOrders(rows)
    setAssignments((a.data ?? []) as Assignment[])
    setDrivers((d.data ?? []) as Driver[])
    // Left out of the error check above on purpose: losing this costs the items
    // and the map, not the board. The supervisor keeps every action.
    if (live.ok) {
      const next: Record<number, LiveDelivery> = {}
      for (const row of (live.data ?? [])) next[row.assignment_id] = row
      setLiveById(next)
    }
    setError('')
    setLoading(false)
  }

  async function loadHistory(page = 0, append = false) {
    setHistoryLoading(true)
    const from = page * HISTORY_PAGE_SIZE
    const { data, error: historyQueryError } = await supabase.from('orders')
      .select('*, restaurants(name, vendor_type)')
      .in('status', HISTORY_ORDER_STATUSES).order('created_at', { ascending: false })
      .range(from, from + HISTORY_PAGE_SIZE)
    if (historyQueryError) {
      setHistoryError('مش قادرين نحمّل الطلبات السابقة دلوقتي')
      setHistoryLoading(false)
      return
    }
    const rows = (data ?? []) as Order[]
    // Fetch one extra row so the button is exact without a separate count.
    const pageRows = rows.slice(0, HISTORY_PAGE_SIZE)
    const ids = pageRows.map(order => order.id)
    const { data: completedAssignments } = ids.length === 0
      ? { data: [] as Assignment[] }
      : await supabase.from('delivery_assignments').select('*, drivers(*)').in('order_id', ids).order('id', { ascending: false })
    setHistoryOrders(prev => append ? [...prev, ...pageRows] : pageRows)
    setHistoryAssignments(prev => append ? [...prev, ...((completedAssignments ?? []) as Assignment[])] : ((completedAssignments ?? []) as Assignment[]))
    setHistoryPage(page)
    setHistoryHasMore(rows.length > HISTORY_PAGE_SIZE)
    setHistoryLoaded(true)
    setHistoryError('')
    setHistoryLoading(false)
  }

  function selectTab(tab: SupervisorTab) {
    setActiveTab(tab)
    setUnreadTabs(previous => {
      if (!previous.has(tab)) return previous
      const next = new Set(previous)
      next.delete(tab)
      return next
    })
    try { sessionStorage.setItem(SUPERVISOR_TAB_KEY, tab) } catch { /* private browser storage */ }
    if (tab === 'history' && !historyLoaded) void loadHistory()
  }

  async function toggleHistoryDetail(id: number) {
    const next = openHistory === id ? null : id
    setOpenHistory(next)
    if (next === null || historyItems[id]) return
    const { data, error: itemsError } = await supabase.from('order_items')
      .select('name, qty, total, size_name, combo_name, addon_names')
      .eq('order_id', id).order('id')
    if (itemsError) {
      setHistoryError('مش قادرين نحمّل أصناف الطلب. اقفل التفاصيل وافتحها تاني')
      return
    }
    setHistoryItems(prev => ({ ...prev, [id]: data ?? [] }))
  }

  useEffect(() => {
    load()
    // SLOWED WHEN HIDDEN, NOT PAUSED. This screen pings on every new order that
    // needs a call to the restaurant -- which is the supervisor's whole job, and
    // they are usually on the phone with another tab in front. Pausing would
    // have made those orders silent until they happened to look back.
    //
    // Hidden: 60s. Visible: 15s. Returning refreshes at once.
    let hiddenSince: number | null = null
    const tick = () => {
      if (document.visibilityState === 'visible') { hiddenSince = null; load(); return }
      const now = Date.now()
      if (hiddenSince === null) hiddenSince = now
      if (now - hiddenSince >= 60000) { hiddenSince = now; load() }
    }
    const t = setInterval(tick, 15000)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('online', tick)
    registerPush(persistPushToken)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('online', tick)
    }

  }, [])

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    if (busy) return
    setBusy(key); setError('')
    const res = await fn()
    setBusy(null)
    if (!res.ok) { setError(res.error ?? 'حصل خطأ، جرب تاني'); return }
    await load()
  }

  const accept = (o: Order, mins: number) =>
    run(`accept:${o.id}`, () => vendorOperation('accept', { orderId: o.id, prepMinutes: mins }))

  const markReady = (o: Order) =>
    run(`ready:${o.id}`, () => vendorOperation('ready', { orderId: o.id }))

  // Quoting is not confirmation. The server freezes the financial snapshot and
  // waits for the customer's explicit decision; this screen performs no price
  // arithmetic and cannot advance fulfilment by itself.
  const issueQuote = async (o: Order, subtotal: number) => {
    await run(`price:${o.id}`, async () => {
      const result = await sendQuote(o.id, subtotal)
      if (result.ok) setOrders(prev => prev.map(order => order.id === o.id ? { ...order, quote_state: 'offered' } : order))
      return result
    })
  }

  function assign(o: Order, driver: Driver) {
    setModalError('')
    run(`assign:${o.id}`, async () => {
      const res = await dispatchOperation('assign', { orderId: o.id, driverId: driver.id }, {
        dispatch_rule_blocked: 'المندوب ده وصل للحد الأقصى (٤ طلبات) أو شغال في اتجاه مختلف',
        driver_already_declined: 'المندوب ده رفض الطلب ده قبل كده',
        already_assigned: 'الطلب ده معروض على مندوب بالفعل',
      })
      if (!res.ok) { setModalError(res.error); return res }
      setAssigning(null)
      return res
    })
  }

  async function unassign(a: Assignment) {
    const reason = await promptSheet({
      title: `سحب الطلب #${a.order_id} من ${a.drivers?.name ?? 'المندوب'}؟`,
      body: 'هيرجع تاني لقائمة الطلبات المتاحة.',
      placeholder: 'السبب (اختياري)',
    })
    if (reason === null) return
    run(`unassign:${a.id}`, () =>
      dispatchOperation('unassign', { orderId: a.order_id, reason: reason || 'supervisor_unassigned' }))
  }


  async function resolve(a: Assignment, action: 'wait' | 'fail') {
    if (action === 'fail' && !await confirmSheet({
      title: 'تسجيل الطلب كتوصيل فاشل؟',
      body: 'المندوب هياخد أجره ومفيش استرداد للعميل.',
      danger: true,
    })) return
    run(`resolve:${a.id}`, () => dispatchOperation('resolveNoAnswer', { assignmentId: a.id, resolution: action }))
  }

  const assignedIds = new Set(
    assignments.filter(a => ACTIVE_STATUSES.includes(a.status)).map(a => a.order_id))
  const escalations = assignments.filter(a => a.no_answer_reported_at && !a.no_answer_admin_action)
  // A pharmacy or market order arrives with no price at all: submit_custom_order
  // writes pricing_status 'pending_quote' and status 'awaiting_quote'. Both
  // vendor_accept_order and vendor_ready refuse it with order_not_priced, so
  // pricing is not a step that can be reordered -- it has to come first. It
  // needs its own list because awaiting_quote is deliberately filtered out of
  // the kitchen board below, which would otherwise make the order invisible.
  // Oldest first: every newer quote still has more of its fifteen-minute promise
  // left. Copy before sorting so React state remains immutable.
  const needsQuote = orders
    .filter(o => o.pricing_status === 'pending_quote' && o.quote_state !== 'offered')
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  const awaitingQuoteApproval = orders
    .filter(o => o.quote_state === 'offered')
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  const liveStage = (o: Order) =>
    o.kitchen_status !== 'ready' && o.pricing_status !== 'pending_quote'
    && !['awaiting_payment', 'awaiting_quote'].includes(o.status)
  // A custom request has nobody to ring -- the supervisor is the one walking
  // the aisles -- so it gets a list of its own with one button, rather than
  // sitting under "كلّم المطعم" being offered prep times a supermarket cannot
  // quote.
  const needsShopping = orders.filter(o => o.order_type === 'custom_request' && liveStage(o))
  const needsKitchen = orders.filter(o => o.order_type !== 'custom_request' && liveStage(o))
  const unassigned = orders.filter(o =>
    !assignedIds.has(o.id) && o.kitchen_status === 'ready' && o.status !== 'awaiting_payment'
      && !(o.order_type === 'custom_request' && o.quote_state != null && o.quote_state !== 'accepted'))
  const availableDrivers = drivers.filter(d => d.active && d.available)
  // A sent quote still needs watching until it is accepted, rejected, or
  // expires; include it so the preparation queue never looks empty while a
  // customer is deciding.
  const callQueueCount = needsQuote.length + awaitingQuoteApproval.length + needsShopping.length + needsKitchen.length
  // Escalations are a subset of active assignments, not a second delivery.
  const liveQueueCount = assignments.length
  const tabs: Array<{ id: SupervisorTab; label: string; count: number }> = [
    { id: 'calls', label: 'مكالمات وتجهيز', count: callQueueCount },
    { id: 'phone', label: 'طلب بالتليفون', count: 0 },
    { id: 'drivers', label: 'محتاج مندوب', count: unassigned.length },
    { id: 'live', label: 'توصيلات جارية', count: liveQueueCount },
    { id: 'history', label: 'طلبات سابقة', count: 0 },
  ]
  const workSignature = [
    [...needsQuote, ...awaitingQuoteApproval, ...needsShopping, ...needsKitchen].map(order => order.id).sort((a, b) => a - b).join(','),
    unassigned.map(order => order.id).sort((a, b) => a - b).join(','),
    assignments.map(assignment => assignment.id).sort((a, b) => a - b).join(','),
  ].join('|')
  currentTabIds.current = {
    calls: new Set([...needsQuote, ...awaitingQuoteApproval, ...needsShopping, ...needsKitchen].map(order => order.id)),
    drivers: new Set(unassigned.map(order => order.id)),
    live: new Set(assignments.map(assignment => assignment.id)),
  }

  useEffect(() => {
    const current = currentTabIds.current
    if (knownTabIds.current) {
      setUnreadTabs(previous => {
        const next = new Set(previous)
        let changed = false
        for (const tab of ['calls', 'drivers', 'live'] as const) {
          const hasNewWork = [...current[tab]].some(id => !knownTabIds.current![tab].has(id))
          if (hasNewWork && activeTab !== tab && !next.has(tab)) { next.add(tab); changed = true }
        }
        return changed ? next : previous
      })
    }
    knownTabIds.current = current
  }, [activeTab, workSignature])

  useEffect(() => {
    if (activeTab === 'history' && !historyLoaded) void loadHistory()
  }, [activeTab, historyLoaded])

  const addr = (o: Order) => {
    const addressNote = o.address_notes?.trim()
    return `${o.zone ?? '-'} • وحدة ${o.unit_number ?? '-'}${addressNote ? ` • ${addressNote}` : ''}`
  }

  if (loading) return <p className="text-mist text-center py-10">جاري التحميل…</p>

  return (
    <div className="max-w-2xl mx-auto pb-10">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">مشرف التشغيل</h1>
          <p className="text-xs text-mist truncate">{profile?.name}</p>
        </div>
        <button className="btn-ghost text-sm shrink-0" onClick={signOut}>خروج</button>
      </div>

      <EnablePushButton
        onToken={persistPushToken}
      />
      <EnableSoundButton />

      {error && (
        <div ref={errorRef} className="bg-dangerbg rounded-xl p-3 mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-danger">{error}</p>
          <button className="btn-ghost !py-1.5 text-xs shrink-0" onClick={load}>حدّث</button>
        </div>
      )}

      <div className="mb-5 border-b border-line" role="tablist" aria-label="أقسام التشغيل">
        <div className="flex gap-1 overflow-x-auto pb-2" dir="rtl">
          {tabs.map(tab => {
            const selected = activeTab === tab.id
            return (
              <button key={tab.id} role="tab" type="button" aria-selected={selected}
                className={`shrink-0 min-h-10 rounded-xl px-3 text-sm font-semibold transition-colors ${selected ? 'bg-sea text-white' : 'text-mist hover:bg-shellup'}`}
                onClick={() => selectTab(tab.id)}>
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span className={`ms-1.5 inline-grid min-w-5 h-5 place-items-center rounded-full px-1 text-xs ${selected ? 'bg-white text-sea' : 'bg-dangerbg text-danger'}`}>
                    {tab.count}
                  </span>
                )}
                {unreadTabs.has(tab.id) && <span className="ms-1 inline-block w-2 h-2 rounded-full bg-danger" aria-label="فيه طلبات جديدة" />}
              </button>
            )
          })}
        </div>
      </div>

      {activeTab === 'live' && escalations.length > 0 && (
        <div className="card p-4 mb-4 border-dangerline bg-dangerbg">
          <p className="font-bold mb-3"><Icon name="siren" size="sm" className="inline-block align-[-0.15em] me-1" />مندوبين محتاجين قرار ({escalations.length})</p>
          <div className="space-y-2.5">
            {escalations.map(a => (
              <div key={a.id} className="bg-night border border-line rounded-xl p-3">
                <p className="font-semibold text-sm">طلب #{a.order_id}: {a.orders?.restaurants?.name}</p>
                <p className="text-xs text-mist mt-0.5">
                  <Icon name="moped" size="sm" className="inline-block align-[-0.15em] me-1" />{a.drivers?.name} • <Icon name="user" size="xs" className="inline-block align-[-0.15em] me-1" />{a.orders?.customer_name} •{' '}
                  <a className="text-sea" dir="ltr" href={`tel:${a.orders?.customer_phone}`}>{a.orders?.customer_phone}</a>
                </p>
                <p className="text-xs text-coral-700 mt-1">
                  {a.delivery_problem_reason ? `بلّغ: ${a.delivery_problem_reason}` : 'اتصل بالعميل ومردش'}
                </p>
                <div className="flex gap-2 mt-2.5 flex-wrap">
                  <a className="btn-ghost !py-1.5 text-xs flex-1 min-w-[6rem] text-center" href={`tel:${a.orders?.customer_phone}`}>اتصل</a>
                  <button className="btn-ghost !py-1.5 text-xs flex-1 min-w-[6rem]" onClick={() => resolve(a, 'wait')}>يستنى</button>
                  <button className="btn-ghost !py-1.5 text-xs flex-1 min-w-[6rem] !text-danger" onClick={() => resolve(a, 'fail')}>توصيل فاشل</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 0. Pricing. Nothing downstream will move until this is done -- the
             accept and ready RPCs both refuse an unpriced order -- so it sits
             above the phone-call list rather than beside it. */}
      {activeTab === 'calls' && needsQuote.length > 0 && (
        <>
          <h2 className="font-bold mb-2.5"><Icon name="receipt" size="sm" className="inline-block align-[-0.15em] me-1" />محتاج تسعير ({needsQuote.length})</h2>
          <div className="space-y-3 mb-6">
            {needsQuote.map(o => (
              <QuoteCard key={o.id} order={o} addr={addr(o)}
                busy={busy === `price:${o.id}`}
                onConfirm={subtotal => issueQuote(o, subtotal)} />
            ))}
          </div>
        </>
      )}

      {activeTab === 'calls' && awaitingQuoteApproval.length > 0 && (
        <>
          <h2 className="font-bold mb-2.5"><Icon name="clock" size="sm" className="inline-block align-[-0.15em] me-1" />في انتظار موافقة العميل ({awaitingQuoteApproval.length})</h2>
          <div className="space-y-3 mb-6">
            {awaitingQuoteApproval.map(o => <AwaitingQuoteCard key={o.id} order={o} addr={addr(o)} />)}
          </div>
        </>
      )}

      {/* 0b. Priced, now go and buy it. */}
      {activeTab === 'calls' && needsShopping.length > 0 && (
        <>
          <h2 className="font-bold mb-2.5"><Icon name="cartShopping" size="sm" className="inline-block align-[-0.15em] me-1" />اشتري وجهّز ({needsShopping.length})</h2>
          <div className="space-y-3 mb-6">
            {needsShopping.map(o => (
              <div key={o.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-bold">#{o.id} • {o.restaurants?.name}</h3>
                    <p className="text-xs text-mist mt-0.5"><Icon name="user" size="sm" className="inline-block align-[-0.15em] me-1" />{o.customer_name} • <a className="text-sea" dir="ltr" href={`tel:${o.customer_phone}`}>{o.customer_phone}</a></p>
                    <p className="text-xs text-mist mt-0.5"><Icon name="locationDot" size="sm" className="inline-block align-[-0.15em] me-1" />{addr(o)}</p>
                  </div>
                  <div className="text-left shrink-0">
                    <span className="font-bold text-sea block">{o.total} ج.م</span>
                    <span className="text-xs text-mist">اتسعّر</span>
                  </div>
                </div>

                <CustomerNote order={o} />
                <div className="mt-3 bg-night border border-line rounded-xl p-3 text-sm space-y-1">
                  <OrderLines order={o} />
                </div>
                <PaymentSummary order={o} />
                <PriceBreakdown order={o} />

                <button className="btn-sea w-full !py-2 text-sm mt-3"
                  disabled={busy === `ready:${o.id}`}
                  onClick={() => markReady(o)}>
                  {busy === `ready:${o.id}` ? '…' : 'جاهز للاستلام'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 1. The phone call. This is the supervisor's actual job: the restaurant
             does not have a screen, so nothing moves until someone rings them
             and then records the answer here. */}
      {activeTab === 'calls' && <>
        <h2 className="font-bold mb-2.5"><Icon name="phone" size="sm" className="inline-block align-[-0.15em] me-1" />كلّم المطعم ({needsKitchen.length})</h2>
        {needsKitchen.length === 0 && (
          <div className="card p-5 text-center text-mist text-sm mb-6">مفيش طلبات مستنية مكالمة</div>
        )}
        <div className="space-y-3 mb-6">
          {needsKitchen.map(o => (
          <div key={o.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-bold">#{o.id} • {o.restaurants?.name}</h3>
                <p className="text-xs text-mist mt-0.5"><Icon name="user" size="sm" className="inline-block align-[-0.15em] me-1" />{o.customer_name} • <a className="text-sea" dir="ltr" href={`tel:${o.customer_phone}`}>{o.customer_phone}</a></p>
                <p className="text-xs text-mist mt-0.5"><Icon name="locationDot" size="sm" className="inline-block align-[-0.15em] me-1" />{addr(o)}</p>
              </div>
              <div className="text-left shrink-0">
                <span className="font-bold text-sea block">{o.total} ج.م</span>
                <span className="text-xs text-mist">{orderStatusLabel(o.status)}</span>
              </div>
            </div>

            <CustomerNote order={o} />
            <div className="mt-3 bg-night border border-line rounded-xl p-3 text-sm space-y-1">
              <OrderLines order={o} />
            </div>
            <PaymentSummary order={o} />
                <PriceBreakdown order={o} />

            {o.kitchen_status === 'new' ? (
              <>
                <p className="text-xs text-mist mt-3 mb-1.5">المطعم قال هيجهزه في قد إيه؟</p>
                <div className="flex gap-2">
                  {PREP_CHOICES.map(m => (
                    <button key={m} className="btn-sea !py-2 text-sm flex-1"
                      disabled={busy === `accept:${o.id}`}
                      onClick={() => accept(o, m)}>
                      {busy === `accept:${o.id}` ? '…' : `قبل • ${m} د`}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <button className="btn-sea w-full !py-2 text-sm mt-3"
                disabled={busy === `ready:${o.id}`}
                onClick={() => markReady(o)}>
                {busy === `ready:${o.id}` ? '…' : 'المطعم قال إنه جاهز'}
              </button>
            )}

          </div>
          ))}
        </div>
      </>}

      {activeTab === 'phone' && <section aria-labelledby="supervisor-phone-order-title">
        <h2 id="supervisor-phone-order-title" className="font-bold mb-1.5">
          <Icon name="phone" size="sm" className="inline-block align-[-0.15em] me-1" />طلب جه بالتليفون من مطعم
        </h2>
        <p className="text-xs text-mist mb-3">لما المطعم ياخد الطلب بنفسه ويحتاج مندوب للتوصيل.</p>
        <PhoneOrderForm onCreated={() => { void load(); selectTab('drivers') }} />
      </section>}

      {/* 2. Dispatch */}
      {activeTab === 'drivers' && <>
        <h2 className="font-bold mb-2.5"><Icon name="moped" size="sm" className="inline-block align-[-0.15em] me-1" />جاهز ومحتاج مندوب ({unassigned.length})</h2>
        {unassigned.length === 0 && (
          <div className="card p-5 text-center text-mist text-sm mb-6">مفيش طلبات جاهزة مستنية مندوب</div>
        )}
        <div className="space-y-3 mb-6">
          {unassigned.map(o => (
          <div key={o.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-sm">#{o.id} • {o.restaurants?.name}</p>
                <p className="text-xs text-mist mt-0.5"><Icon name="user" size="sm" className="inline-block align-[-0.15em] me-1" />{o.customer_name} • <a className="text-sea" dir="ltr" href={`tel:${o.customer_phone}`}>{o.customer_phone}</a></p>
                <p className="text-xs text-mist mt-0.5"><Icon name="locationDot" size="sm" className="inline-block align-[-0.15em] me-1" />{addr(o)}</p>
              </div>
              <div className="text-left shrink-0">
                <span className="font-bold text-sea block">{o.total} ج.م</span>
                <span className="text-xs text-mist">{orderStatusLabel(o.status)}</span>
              </div>
            </div>
            <CustomerNote order={o} />
            <div className="mt-3 bg-night border border-line rounded-xl p-3 text-sm space-y-1">
              <p className="text-[11px] font-bold text-mist mb-1.5">طلب العميل</p>
              <OrderLines order={o} />
            </div>
            <PaymentSummary order={o} />
                <PriceBreakdown order={o} />
            <button className="btn-sea w-full !py-2 text-sm mt-3" onClick={() => { setAssigning(o); setModalError('') }}>
              عيّن مندوب
            </button>
          </div>
          ))}
        </div>
      </>}

      {/* 3. In flight */}
      {activeTab === 'live' && <>
        <h2 className="font-bold mb-2.5"><Icon name="van" size="sm" className="inline-block align-[-0.15em] me-1" />توصيلات جارية ({assignments.length})</h2>
        {assignments.length === 0 && (
          <div className="card p-5 text-center text-mist text-sm">مفيش توصيلات جارية</div>
        )}
        <div className="space-y-3">
          {assignments.map(a => (
          <div key={a.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-sm truncate">#{a.order_id} • {a.orders?.restaurants?.name}</p>
                <p className="text-xs text-mist mt-0.5"><Icon name="moped" size="sm" className="inline-block align-[-0.15em] me-1" />{a.drivers?.name} • محاولة {a.attempt_number}</p>
                {a.orders && <p className="text-xs text-mist mt-0.5"><Icon name="user" size="sm" className="inline-block align-[-0.15em] me-1" />{a.orders.customer_name} • <a className="text-sea" dir="ltr" href={`tel:${a.orders.customer_phone}`}>{a.orders.customer_phone}</a></p>}
                <p className="text-xs text-mist mt-0.5"><Icon name="locationDot" size="sm" className="inline-block align-[-0.15em] me-1" />{a.orders ? addr(a.orders) : '-'}</p>
              </div>
              <span className="text-xs font-semibold bg-shellup rounded-full px-2.5 py-1 shrink-0">
                {assignmentStatusLabel(a.status)}
              </span>
            </div>
            {a.orders && <CustomerNote order={a.orders} />}
            {a.orders && <PaymentSummary order={a.orders} />}
            <LiveDeliveryDetail live={liveById[a.id]} />
            <div className="flex gap-2 mt-3 flex-wrap">
              <a className="btn-ghost !py-1.5 text-xs flex-1 min-w-[6rem] text-center" href={`tel:${a.drivers?.phone}`}>
                <span className="flex items-center justify-center gap-1"><Icon name="clock" size="xs" />كلّم المندوب</span>
              </a>
              <button className="btn-ghost !py-1.5 text-xs flex-1 min-w-[6rem]" onClick={() => unassign(a)}>اسحب الطلب</button>
            </div>
          </div>
          ))}
        </div>
      </>}

      {/* History belongs after the live board: it answers "what happened?"
          without competing with orders that still need someone to act. */}
      {activeTab === 'history' && <section aria-labelledby="supervisor-history-title">
        <h2 id="supervisor-history-title" className="font-bold mb-2.5">
          <Icon name="clock" size="sm" className="inline-block align-[-0.15em] me-1" />طلبات سابقة
        </h2>
        {historyError && <p className="card p-3 text-sm text-danger mb-3">{historyError}</p>}
        {historyLoading && !historyLoaded ? (
          <div className="card p-5 text-center text-mist text-sm">جاري تحميل الطلبات السابقة…</div>
        ) : historyOrders.length === 0 && !historyError ? (
          <div className="card p-5 text-center text-mist text-sm">مفيش طلبات سابقة ظاهرة</div>
        ) : (
          <div className="space-y-3">
            {historyOrders.map(order => {
              const expanded = openHistory === order.id
              const cancelled = order.status === 'Cancelled'
              const assignment = historyAssignments.find(row => row.order_id === order.id && row.delivered_at)
              return (
                <article key={order.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold">#{order.id} • {order.restaurants?.name}</p>
                      <p className="text-xs text-mist mt-0.5">{new Date(order.created_at).toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' })}</p>
                    </div>
                    <div className="shrink-0 text-left">
                      <span className={`block font-bold ${cancelled ? 'text-danger' : 'text-sea'}`}>
                        {cancelled ? 'ملغي' : `${order.total} ج.م`}
                      </span>
                      <span className="text-xs text-mist">{orderStatusLabel(order.status)}</span>
                    </div>
                  </div>

                  <button className="text-xs text-sea font-semibold mt-3" onClick={() => toggleHistoryDetail(order.id)}>
                    {expanded
                      ? <>إخفاء التفاصيل<Icon name="caretUp" size="xs" className="inline-block align-[-0.15em] ms-1" /></>
                      : <>عرض التفاصيل الكاملة<Icon name="caretDown" size="xs" className="inline-block align-[-0.15em] ms-1" /></>}
                  </button>

                  {expanded && (
                    <div className="mt-3 bg-night border border-line rounded-xl p-3 text-sm space-y-3">
                      <div>
                        <p className="text-[11px] font-bold text-mist mb-1">العميل والعنوان</p>
                        <p className="font-semibold">{order.customer_name} • <a className="text-sea" dir="ltr" href={`tel:${order.customer_phone}`}>{order.customer_phone}</a></p>
                        <p className="text-mist mt-0.5"><Icon name="locationDot" size="sm" className="inline-block align-[-0.15em] me-1" />{addr(order)}</p>
                      </div>

                      <div className="border-t border-line pt-3">
                        <p className="text-[11px] font-bold text-mist mb-1.5"><Icon name="receipt" size="sm" className="inline-block align-[-0.15em] me-1" />تفاصيل الطلب</p>
                        {order.order_type === 'catalog' ? (
                          historyItems[order.id] === undefined ? <p className="text-mist">بنحمّل الأصناف…</p>
                          : historyItems[order.id].length === 0 ? <p className="text-mist">مفيش أصناف مسجلة</p>
                          : historyItems[order.id].map((item, index) => (
                            <p key={index}><span className="font-semibold">{item.qty}×</span> {item.name}
                              {[item.size_name, item.combo_name, ...(item.addon_names ?? [])].filter(Boolean).length > 0 && <span className="text-mist"> • {[item.size_name, item.combo_name, ...(item.addon_names ?? [])].filter(Boolean).join(' • ')}</span>}
                              <span className="text-mist"> • {item.total} ج.م</span>
                            </p>
                          ))
                        ) : <OrderLines order={order} />}
                        {order.request_notes && <p className="text-mist italic mt-1">“{order.request_notes}”</p>}
                      </div>

                      <PaymentSummary order={order} />
                      <PriceBreakdown order={order} />
                      {(assignment || (cancelled && (order.cancel_reason || order.cancelled_at))) && (
                        <div className="border-t border-line pt-3 text-xs text-mist space-y-1">
                          {assignment && <p><Icon name="moped" size="sm" className="inline-block align-[-0.15em] me-1" />المندوب: {assignment.drivers?.name ?? 'غير مسجل'} • {assignmentStatusLabel(assignment.status)}</p>}
                          {assignment?.delivered_at && <p><Icon name="clock" size="sm" className="inline-block align-[-0.15em] me-1" />تم التوصيل: {new Date(assignment.delivered_at).toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' })}</p>}
                          {cancelled && <p className="text-danger"><Icon name="x" size="sm" className="inline-block align-[-0.15em] me-1" />{cancelReasonLabel(order.cancel_reason)}</p>}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
        {historyHasMore && (
          <button className="btn-ghost w-full text-sm mt-3" disabled={historyLoading}
            onClick={() => void loadHistory(historyPage + 1, true)}>
            {historyLoading ? 'جاري التحميل…' : 'عرض طلبات أقدم'}
          </button>
        )}
      </section>}

      {assigning && (
        <div ref={assigningRef} className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" role="dialog" aria-labelledby="sv-assign-driver-title" aria-modal="true" onClick={() => setAssigning(null)}>
          <div className="card !rounded-2xl w-full max-w-sm p-5 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 id="sv-assign-driver-title" className="font-bold mb-1">تعيين مندوب لطلب #{assigning.id}</h3>
            <p className="text-xs text-mist mb-3">{assigning.restaurants?.name} → {addr(assigning)}</p>
            {modalError && <p className="text-sm text-danger bg-dangerbg rounded-xl p-3 mb-3">{modalError}</p>}
            {availableDrivers.length === 0 && <p className="text-sm text-mist">مفيش مندوبين متاحين دلوقتي</p>}
            <div className="space-y-2">
              {availableDrivers.map(d => (
                <button key={d.id} className="w-full card p-3 text-right hover:border-sea/50 disabled:opacity-50"
                  disabled={!!busy}
                  onClick={() => assign(assigning, d)}>
                  <span className="block font-semibold text-sm">{d.name}</span>
                  <span className="block text-xs text-mist">{d.vehicle_type === 'van' ? 'فان' : 'موتوسيكل'} • {d.phone}</span>
                </button>
              ))}
            </div>
            <button className="btn-ghost w-full mt-3 text-sm" onClick={() => setAssigning(null)}>إغلاق</button>
          </div>
        </div>
      )}

      {sheetElement}
    </div>
  )
}

type OrderItemSummary = {
  name: string; qty: number; total: number
  size_name: string | null; combo_name: string | null; addon_names: string[] | null
}


function CustomerNote({ order }: { order: Order }) {
  const note = order.customer_note?.trim()
  if (!note) return null
  return (
    <div className="mt-3 border border-coral-300 bg-coral-100 rounded-xl p-3">
      <p className="text-xs font-bold text-coral-700"><Icon name="chatCircle" size="sm" className="inline-block align-[-0.15em] me-1" />ملاحظة العميل</p>
      <p className="text-sm mt-1 font-semibold whitespace-pre-wrap">{note}</p>
    </div>
  )
}

// Amounts are facts recorded on the order, not values the supervisor may edit.
// Keeping them beside the card action prevents a rider being sent out without
// the operator knowing whether they collect cash, a deposit, or nothing.
function PaymentSummary({ order }: { order: Order }) {
  const method = order.payment_method === 'cod'
    ? 'كاش عند الاستلام'
    : order.payment_method === 'instapay'
      ? 'إنستاباي'
      : order.payment_method === 'online'
        ? 'دفع أونلاين'
        : order.payment_method
  const collect = order.collect_amount ?? (order.payment_method === 'cod' ? order.total : null)
  const deposit = order.cod_deposit_amount
  if (collect == null && !deposit) return <p className="text-xs text-mist mt-2"><Icon name="creditCard" size="sm" className="inline-block align-[-0.15em] me-1" />{method}</p>
  return (
    <div className="mt-2 rounded-xl bg-shellup px-3 py-2 text-xs text-mist flex flex-wrap gap-x-3 gap-y-1">
      <span><Icon name="creditCard" size="sm" className="inline-block align-[-0.15em] me-1" />{method}</span>
      {collect != null && <span className="font-semibold text-ink">المندوب يجمّع {collect} ج.م</span>}
      {!!deposit && <span>تأمين كاش {deposit} ج.م</span>}
    </div>
  )
}

// An offered custom quote deliberately does not overwrite the order's money
// columns until the customer accepts. This card reads the protected immutable
// quote snapshot instead, so a supervisor never mistakes the pre-quote
// delivery fee for the full amount the customer is deciding on.
function AwaitingQuoteCard({ order, addr }: { order: Order; addr: string }) {
  const [quote, setQuote] = useState<QuoteView | null>(null)
  const [loadingQuote, setLoadingQuote] = useState(true)
  const [quoteError, setQuoteError] = useState('')

  const loadQuote = useCallback(async () => {
    setLoadingQuote(true)
    setQuoteError('')
    const result = await viewStaffQuote(order.id)
    if (!result.ok) {
      setQuoteError(result.error ?? 'مش قادرين نجيب تفاصيل السعر دلوقتي')
      setLoadingQuote(false)
      return
    }
    setQuote(result.data)
    setLoadingQuote(false)
  }, [order.id])

  useEffect(() => { void loadQuote() }, [loadQuote])

  const paymentLine = quote && (quote.deposit_required
    ? `بعد الموافقة: عربون ${quote.deposit_amount} ج.م عبر InstaPay، والباقي ${quote.total - quote.deposit_amount} ج.م كاش عند الاستلام`
    : quote.payment_method === 'instapay'
      ? `بعد الموافقة: العميل هيحوّل ${quote.total} ج.م عبر InstaPay قبل التجهيز`
      : quote.payment_method === 'online'
        ? `بعد الموافقة: الدفع أونلاين ${quote.total} ج.م`
        : `بعد الموافقة: العميل هيدفع ${quote.total} ج.م كاش عند الاستلام`)

  return (
    <div className="card p-4 border-sea/30 bg-sea/5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-bold">#{order.id} • {order.restaurants?.name}</h3>
          <p className="text-xs text-mist mt-0.5"><Icon name="user" size="sm" className="inline-block align-[-0.15em] me-1" />{order.customer_name} • <a className="text-sea" dir="ltr" href={`tel:${order.customer_phone}`}>{order.customer_phone}</a></p>
          <p className="text-xs text-mist mt-0.5"><Icon name="locationDot" size="sm" className="inline-block align-[-0.15em] me-1" />{addr}</p>
        </div>
        <span className="text-xs font-semibold rounded-full px-2.5 py-1 bg-sea/10 text-sea shrink-0">العرض اتبعت</span>
      </div>

      <CustomerNote order={order} />
      <div className="mt-3 bg-night border border-line rounded-xl p-3 text-sm space-y-1">
        <p className="text-[11px] font-bold text-mist mb-1.5">طلب العميل</p>
        <OrderLines order={order} />
      </div>

      {loadingQuote && <p className="text-xs text-mist mt-3">جاري تحميل تفاصيل العرض…</p>}
      {quoteError && <div className="mt-3 text-xs text-danger flex items-center justify-between gap-3"><span>{quoteError}</span><button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => void loadQuote()}>حاول تاني</button></div>}
      {quote && (
        <div className="mt-3 rounded-xl bg-shellup px-3 py-2.5 text-xs space-y-1.5">
          <p className="font-semibold text-ink"><Icon name="receipt" size="sm" className="inline-block align-[-0.15em] me-1" />تفاصيل العرض للعميل</p>
          <div className="flex justify-between"><span className="text-mist">الأصناف</span><span>{quote.subtotal} ج.م</span></div>
          <div className="flex justify-between"><span className="text-mist">التوصيل</span><span>{quote.delivery_fee} ج.م</span></div>
          {quote.service_fee > 0 && <div className="flex justify-between"><span className="text-mist">رسوم الخدمة</span><span>{quote.service_fee} ج.م</span></div>}
          {quote.promo_discount > 0 && <div className="flex justify-between text-success"><span>خصم</span><span>-{quote.promo_discount} ج.م</span></div>}
          {quote.wallet_used > 0 && <div className="flex justify-between text-success"><span>من المحفظة</span><span>-{quote.wallet_used} ج.م</span></div>}
          <div className="flex justify-between font-bold text-sm pt-1.5 mt-1 border-t border-line"><span>الإجمالي</span><span className="text-sea">{quote.total} ج.م</span></div>
          <p className="text-mist pt-1 border-t border-line">{paymentLine}</p>
          <p className="text-mist">صالح لحد {new Date(quote.expires_at).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' })}. الطلب متوقف لحد الموافقة؛ متبعتش للمطعم ومتعيّنش لمندوب.</p>
        </div>
      )}
    </div>
  )
}

// One order the supervisor has shopped for and now has to price.
//
// The input is the goods total off the receipt and nothing else. What the
// customer finally pays is calculated from the frozen server snapshot. Showing
// a predicted client total here would recreate pricing drift.
function QuoteCard({ order, addr, busy, onConfirm }: {
  order: Order; addr: string; busy: boolean
  onConfirm: (subtotal: number) => void
}) {
  const [raw, setRaw] = useState('')
  const [preview, setPreview] = useState<QuotePreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const subtotal = Number(raw)
  const valid = raw.trim() !== '' && Number.isFinite(subtotal) && subtotal > 0
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(order.created_at)) / 60000))
  const urgent = elapsedMinutes >= 5
  const late = elapsedMinutes >= 10

  // Supervisors enter the receipt's items total only. Debouncing the preview
  // lets the server calculate delivery, service fee, discounts, and wallet
  // use while they type, without making them do a formula or add anything up.
  useEffect(() => {
    setPreview(null)
    setPreviewError('')
    if (!valid) { setPreviewing(false); return }
    let cancelled = false
    setPreviewing(true)
    const timer = window.setTimeout(async () => {
      const result = await previewQuote(order.id, subtotal)
      if (cancelled) return
      setPreviewing(false)
      if (!result.ok) {
        setPreviewError(result.error ?? 'مش قادرين نحسب الإجمالي دلوقتي')
        return
      }
      setPreview(result.data)
    }, 350)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [order.id, raw, subtotal, valid])

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-bold">#{order.id} • {order.restaurants?.name}</h3>
          <p className="text-xs text-mist mt-0.5"><Icon name="user" size="sm" className="inline-block align-[-0.15em] me-1" />{order.customer_name} • <a className="text-sea" dir="ltr" href={`tel:${order.customer_phone}`}>{order.customer_phone}</a></p>
          <p className="text-xs text-mist mt-0.5"><Icon name="locationDot" size="sm" className="inline-block align-[-0.15em] me-1" />{addr}</p>
        </div>
        <span className={`text-xs font-semibold rounded-full px-2.5 py-1 shrink-0 ${
          late ? 'bg-warningbg text-warning' : urgent ? 'bg-coral-200 text-coral-700' : 'bg-shellup text-mist'
        }`}>
          {late ? `متأخر ${elapsedMinutes} د` : `مستني ${elapsedMinutes} د`}
        </span>
      </div>

      {urgent && (
        <p className={`mt-2 text-xs font-bold ${late ? 'text-warning' : 'text-coral-700'}`}>
          {late ? 'عدّى وعد الـ10 دقايق. سعّره فورًا' : 'اتصل وسعّر دلوقتي قبل ما يعدّي 10 دقايق'}
        </p>
      )}

      <CustomerNote order={order} />

      <div className="mt-3 bg-night border border-line rounded-xl p-3 text-sm space-y-1">
        <p className="text-[11px] font-bold text-mist mb-1.5">طلب العميل</p>
        <OrderLines order={order} />
      </div>
      <PaymentSummary order={order} />

      <div className="mt-3 border border-slate-500 rounded-xl p-3 bg-shellup">
        <label className="block text-[11px] font-bold text-coral-700 mb-2" htmlFor={`p${order.id}`}>
          اكتب سعر الأصناف من الفاتورة
        </label>
        <div className="flex gap-2 items-stretch">
          <input id={`p${order.id}`} className="field flex-1 !py-2 font-bold" inputMode="decimal"
            dir="ltr" value={raw} placeholder="0"
            onChange={e => setRaw(e.target.value)} />
          <span className="self-center text-xs text-mist">ج.م</span>
        </div>
        {previewing && <p className="text-xs text-mist mt-3">بنحسب الإجمالي للعميل…</p>}
        {previewError && <p className="text-xs text-danger mt-3">{previewError}</p>}
        {preview && (
          <div className="mt-3 pt-3 border-t border-dashed border-slate-500 text-xs space-y-1.5" aria-live="polite">
            <div className="flex justify-between"><span className="text-mist">الأصناف</span><span>{preview.subtotal} ج.م</span></div>
            <div className="flex justify-between"><span className="text-mist">التوصيل</span><span>{preview.delivery_fee} ج.م</span></div>
            {preview.service_fee > 0 && <div className="flex justify-between"><span className="text-mist">رسوم الخدمة</span><span>{preview.service_fee} ج.م</span></div>}
            {preview.promo_discount > 0 && <div className="flex justify-between text-success"><span>خصم</span><span>-{preview.promo_discount} ج.م</span></div>}
            {preview.wallet_used > 0 && <div className="flex justify-between text-success"><span>من المحفظة</span><span>-{preview.wallet_used} ج.م</span></div>}
            <div className="flex justify-between font-bold text-sm pt-2 border-t border-line"><span>العميل هيدفع</span><span className="text-sea">{preview.total} ج.م</span></div>
            {preview.deposit_required && <p className="text-mist pt-1">بعد الموافقة: عربون {preview.deposit_amount} ج.م عبر InstaPay.</p>}
          </div>
        )}
        <button className="btn-sea w-full mt-3 !py-2.5 text-sm"
          disabled={!preview || previewing || busy}
          onClick={() => onConfirm(subtotal)}>
          {busy ? 'جاري الإرسال…' : preview ? `ابعت عرض السعر • ${preview.total} ج.م` : 'اكتب سعر الأصناف الأول'}
        </button>
        <p className="text-[11px] text-mist mt-2 text-center">العرض صالح 15 دقيقة. العميل هو اللي بيوافق قبل ما الطلب يتحرك.</p>
      </div>

    </div>
  )
}
