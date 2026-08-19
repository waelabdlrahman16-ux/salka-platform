import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rpc } from '../lib/rpc'
import { adminReport } from '../lib/adminReports'
import { dispatchOperation } from '../lib/dispatchOperations'
import { vendorOperation } from '../lib/vendorOperations'
import { useAuth } from '../lib/auth'
import { useDismissable } from '../lib/useDismissable'
import { ping } from '../lib/notify'
import { registerPush, persistPushToken } from '../lib/push'
import { orderStatusLabel, assignmentStatusLabel } from '../lib/statusLabels'
import { vendorNoun } from '../lib/vendorWords'
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

const PREP_CHOICES = [15, 20, 30]

export default function Supervisor() {
  const { profile, signOut } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
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
      // vendor_type comes along because every line of copy that NAMES the
      // vendor goes through vendorNoun() -- "الصيدلية رفضت" not "المطعم رفض".
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

  // The supervisor shopped the order and is holding the receipt, so they type
  // the goods total and nothing else. The service fee, the delivery fee, the
  // COD deposit and the new status all come back from
  // confirm_custom_order_price() -- this screen deliberately does NO
  // arithmetic. A second copy of the server's sum is how the five different
  // "cash to collect" figures in Track/Driver/Admin happened.
  const confirmPrice = (o: Order, subtotal: number) =>
    run(`price:${o.id}`, () =>
      vendorOperation('confirmPrice', { orderId: o.id, subtotal }))

  async function cancelOrder(o: Order) {
    const reason = await promptSheet({
      title: `إلغاء الطلب #${o.id}؟`,
      body: 'السبب (هيتسجل على الطلب وهيشوفه العميل):',
      multiline: true,
      placeholder: 'السبب…',
    })
    if (reason === null) return
    if (!reason.trim()) { setError('اكتب سبب الإلغاء'); return }
    run(`cancel:${o.id}`, () => rpc('cancel_order', { p_order_id: o.id, p_reason: reason.trim() }))
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


  async function resolve(a: Assignment, action: 'wait' | 'fail' | 'refund') {
    if (action === 'fail' && !await confirmSheet({
      title: 'تسجيل الطلب كتوصيل فاشل؟',
      body: 'المندوب هياخد أجره ومفيش استرداد للعميل.',
      danger: true,
    })) return
    if (action === 'refund' && !await confirmSheet({
      title: 'إلغاء الطلب واسترداد فلوس العميل؟',
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
  // Oldest first: every newer quote still has more of its ten-minute promise
  // left. Copy before sorting so React state remains immutable.
  const needsQuote = orders
    .filter(o => o.pricing_status === 'pending_quote')
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
    !assignedIds.has(o.id) && o.kitchen_status === 'ready' && o.status !== 'awaiting_payment')
  const availableDrivers = drivers.filter(d => d.active && d.available)

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

      {/* Said plainly rather than left to be discovered by pressing something
          that fails. The database refuses these; this is just honesty. */}
      <p className="text-xs text-mist bg-shellup rounded-xl p-3 mb-4 leading-relaxed">
        الطلبات والتوصيل كلها عندك، المطاعم والصيدلية والماركت. الفلوس (تأكيد
        التحويلات، تسوية كاش المندوبين، الاستردادات) عند الإدارة.
      </p>

      {error && (
        <div ref={errorRef} className="bg-dangerbg rounded-xl p-3 mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-danger">{error}</p>
          <button className="btn-ghost !py-1.5 text-xs shrink-0" onClick={load}>حدّث</button>
        </div>
      )}

      {escalations.length > 0 && (
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
                  <button className="btn-danger !py-1.5 text-xs flex-1 min-w-[6rem]" onClick={() => resolve(a, 'refund')}>إلغاء واسترداد</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 0. Pricing. Nothing downstream will move until this is done -- the
             accept and ready RPCs both refuse an unpriced order -- so it sits
             above the phone-call list rather than beside it. */}
      {needsQuote.length > 0 && (
        <>
          <h2 className="font-bold mb-2.5"><Icon name="receipt" size="sm" className="inline-block align-[-0.15em] me-1" />محتاج تسعير ({needsQuote.length})</h2>
          <div className="space-y-3 mb-6">
            {needsQuote.map(o => (
              <QuoteCard key={o.id} order={o} addr={addr(o)}
                busy={busy === `price:${o.id}`}
                onConfirm={subtotal => confirmPrice(o, subtotal)}
                onCancel={() => cancelOrder(o)} />
            ))}
          </div>
        </>
      )}

      {/* 0b. Priced, now go and buy it. */}
      {needsShopping.length > 0 && (
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
                <button className="w-full text-xs text-danger font-semibold mt-2.5 py-1"
                  onClick={() => cancelOrder(o)}>
                  مش لاقي الطلب. الغِ الطلب
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 1. The phone call. This is the supervisor's actual job: the restaurant
             does not have a screen, so nothing moves until someone rings them
             and then records the answer here. */}
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

            <button className="w-full text-xs text-danger font-semibold mt-2.5 py-1"
              onClick={() => cancelOrder(o)}>
              {vendorNoun(o.restaurants?.vendor_type)} رفض / مش هينفع. الغِ الطلب
            </button>
          </div>
        ))}
      </div>

      {/* 2. Dispatch */}
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

      <PhoneOrderForm onCreated={load} />

      {/* 3. In flight */}
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
              {a.orders && (
                <button className="btn-danger !py-1.5 text-xs flex-1 min-w-[6rem]" onClick={() => cancelOrder(a.orders!)}>إلغاء</button>
              )}
            </div>
          </div>
        ))}
      </div>

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

// One order the supervisor has shopped for and now has to price.
//
// The input is the goods total off the receipt and nothing else. What the
// customer finally pays -- service fee, delivery, and the COD deposit if it
// crosses the threshold -- is computed by confirm_custom_order_price() and
// arrives on the next load(). Showing a predicted total here would mean
// re-implementing the server's sum in the client, which is the single mistake
// this codebase has made most often.
function QuoteCard({ order, addr, busy, onConfirm, onCancel }: {
  order: Order; addr: string; busy: boolean
  onConfirm: (subtotal: number) => void; onCancel: () => void
}) {
  const [raw, setRaw] = useState('')
  const subtotal = Number(raw)
  const valid = raw.trim() !== '' && Number.isFinite(subtotal) && subtotal >= 0
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(order.created_at)) / 60000))
  const urgent = elapsedMinutes >= 5
  const late = elapsedMinutes >= 10

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
          اكتب إجمالي الفاتورة بعد ما تشتري
        </label>
        <div className="flex gap-2 items-stretch">
          <input id={`p${order.id}`} className="field flex-1 !py-2 font-bold" inputMode="decimal"
            dir="ltr" value={raw} placeholder="0"
            onChange={e => setRaw(e.target.value)} />
          <span className="self-center text-xs text-mist">ج.م</span>
          <button className="btn-sea !py-2 !px-4 text-sm shrink-0"
            disabled={!valid || busy}
            onClick={() => onConfirm(subtotal)}>
            {busy ? '…' : 'أكّد السعر'}
          </button>
        </div>
        <p className="text-[11px] text-mist mt-2 pt-2 border-t border-dashed border-slate-500">
          بعد التأكيد هيظهر اللي العميل هيدفعه، محسوب من السيرفر.
        </p>
      </div>

      <button className="w-full text-xs text-danger font-semibold mt-2.5 py-1" onClick={onCancel}>
        مش لاقي الطلب. الغِ الطلب
      </button>
    </div>
  )
}
