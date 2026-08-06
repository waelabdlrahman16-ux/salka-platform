import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rpc } from '../lib/rpc'
import { useAuth } from '../lib/auth'
import { ping, askNotificationPermission } from '../lib/notify'
import { registerPush, persistPushToken } from '../lib/push'
import { orderStatusLabel, assignmentStatusLabel } from '../lib/statusLabels'
import type { Assignment, Driver, LiveDelivery, Order } from '../lib/types'
import Icon from '../components/Icon'
import EnablePushButton from '../components/EnablePushButton'
import LiveDeliveryDetail from '../components/LiveDeliveryDetail'
import PhoneOrderForm from '../components/PhoneOrderForm'

// The driver supervisor.
//
// Restaurants are not logging into the vendor screen, so a Salka staff member
// phones them and works the order on their behalf, and also runs dispatch.
// They do NOT touch money and they do NOT see the pharmacy or the supermarket.
//
// This is a separate page rather than a filtered Admin because Admin is 2,000
// lines across fourteen tabs, and "the same screen with things hidden" is how a
// permission leak happens -- a hidden button is still a button. The real
// boundary is in the database: RLS gives this role only catalog restaurant
// orders, and every RPC below re-checks supervisor_may_touch_order(). Verified
// by executing it as a supervisor in a rolled-back transaction: the pharmacy
// orders were invisible, and admin_confirm_instapay_payment, settle_driver_cash
// and confirm_custom_order_price all refused.
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

  async function load() {
    const [o, a, d, live] = await Promise.all([
      supabase.from('orders').select('*, restaurants(name)')
        .not('status', 'in', '("Delivered","Cancelled")')
        .order('id', { ascending: false }),
      supabase.from('delivery_assignments').select('*, orders(*, restaurants(name)), drivers(*)')
        .in('status', ACTIVE_STATUSES).order('id', { ascending: false }),
      supabase.from('drivers').select('*').eq('active', true).order('name'),
      supabase.rpc('admin_live_deliveries'),
    ])
    if (o.error || a.error || d.error) {
      setError('مش قادرين نحمّل الطلبات دلوقتي — اتأكد من النت')
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
    if (!live.error) {
      const next: Record<number, LiveDelivery> = {}
      for (const row of ((live.data as LiveDelivery[]) ?? [])) next[row.assignment_id] = row
      setLiveById(next)
    }
    setError('')
    setLoading(false)
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    askNotificationPermission()
    registerPush(persistPushToken)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    run(`accept:${o.id}`, () => rpc('vendor_accept_order', { p_order_id: o.id, p_prep_minutes: mins }))

  const markReady = (o: Order) =>
    run(`ready:${o.id}`, () => rpc('vendor_ready', { p_order_id: o.id }))

  function cancelOrder(o: Order) {
    const reason = prompt(`إلغاء الطلب #${o.id}؟\n\nالسبب (هيتسجل على الطلب وهيشوفه العميل):`, '')
    if (reason === null) return
    if (!reason.trim()) { setError('اكتب سبب الإلغاء'); return }
    run(`cancel:${o.id}`, () => rpc('cancel_order', { p_order_id: o.id, p_reason: reason.trim() }))
  }

  function assign(o: Order, driver: Driver) {
    setModalError('')
    run(`assign:${o.id}`, async () => {
      const res = await rpc('admin_assign_order', { p_order_id: o.id, p_driver_id: driver.id }, {
        dispatch_rule_blocked: 'المندوب ده وصل للحد الأقصى (٣ طلبات) أو شغال في اتجاه مختلف',
        driver_already_declined: 'المندوب ده رفض الطلب ده قبل كده',
        already_assigned: 'الطلب ده معروض على مندوب بالفعل',
      })
      if (!res.ok) { setModalError(res.error); return res }
      setAssigning(null)
      return res
    })
  }

  function unassign(a: Assignment) {
    const reason = prompt(`سحب الطلب #${a.order_id} من ${a.drivers?.name ?? 'المندوب'}؟\nهيرجع تاني لقائمة الطلبات المتاحة.\n\nالسبب (اختياري):`, '')
    if (reason === null) return
    run(`unassign:${a.id}`, () =>
      rpc('admin_unassign_order', { p_order_id: a.order_id, p_reason: reason || 'supervisor_unassigned' }))
  }

  function forceDelivered(a: Assignment) {
    const reason = prompt(`تسجيل الطلب #${a.order_id} كمُسلَّم بدل المندوب؟\n\nاستخدمه لما المندوب يكون سلّم فعلاً ومش قادر يأكد بنفسه.\n\nالسبب:`, '')
    if (reason === null) return
    if (!reason.trim()) { setError('اكتب السبب'); return }
    const cash = confirm('المندوب استلم الكاش من العميل؟\n\nموافق = أيوه.\nإلغاء = لأ.')
    run(`force:${a.id}`, () =>
      rpc('admin_force_delivered', { p_order_id: a.order_id, p_reason: reason.trim(), p_cash_collected: cash }))
  }

  function resolve(a: Assignment, action: 'wait' | 'fail' | 'refund') {
    if (action === 'fail' && !confirm('تسجيل الطلب كتوصيل فاشل؟\n\nالمندوب هياخد أجره ومفيش استرداد للعميل.')) return
    if (action === 'refund' && !confirm('إلغاء الطلب واسترداد فلوس العميل؟')) return
    run(`resolve:${a.id}`, () => rpc('admin_resolve_no_answer', { p_assignment_id: a.id, p_action: action }))
  }

  const assignedIds = new Set(
    assignments.filter(a => ACTIVE_STATUSES.includes(a.status)).map(a => a.order_id))
  const escalations = assignments.filter(a => a.no_answer_reported_at && !a.no_answer_admin_action)
  const needsKitchen = orders.filter(o =>
    o.kitchen_status !== 'ready' && !['awaiting_payment', 'awaiting_quote'].includes(o.status))
  const unassigned = orders.filter(o =>
    !assignedIds.has(o.id) && o.kitchen_status === 'ready' && o.status !== 'awaiting_payment')
  const availableDrivers = drivers.filter(d => d.active && d.available)

  const addr = (o: Order) => `${o.zone ?? '—'} · وحدة ${o.unit_number ?? '—'}`

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

      {/* Said plainly rather than left to be discovered by pressing something
          that fails. The database refuses these; this is just honesty. */}
      <p className="text-xs text-mist bg-shellup rounded-xl p-3 mb-4 leading-relaxed">
        شاشتك للمطاعم بس. الصيدلية والماركت والفلوس (تأكيد التحويلات، تسوية الكاش،
        الاستردادات) كلها عند الإدارة.
      </p>

      {error && (
        <div className="bg-red-500/10 rounded-xl p-3 mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-red-700">{error}</p>
          <button className="btn-ghost !py-1.5 text-xs shrink-0" onClick={load}>حدّث</button>
        </div>
      )}

      {escalations.length > 0 && (
        <div className="card p-4 mb-4 border-red-400/50 bg-red-500/5">
          <p className="font-bold mb-3">🚨 مندوبين محتاجين قرار ({escalations.length})</p>
          <div className="space-y-2.5">
            {escalations.map(a => (
              <div key={a.id} className="bg-night border border-line rounded-xl p-3">
                <p className="font-semibold text-sm">طلب #{a.order_id} — {a.orders?.restaurants?.name}</p>
                <p className="text-xs text-mist mt-0.5">
                  🛵 {a.drivers?.name} · 👤 {a.orders?.customer_name} ·{' '}
                  <a className="text-sea" dir="ltr" href={`tel:${a.orders?.customer_phone}`}>{a.orders?.customer_phone}</a>
                </p>
                <p className="text-xs text-sandink mt-1">
                  {a.delivery_problem_reason ? `بلّغ: ${a.delivery_problem_reason}` : 'اتصل بالعميل ومردش'}
                </p>
                <div className="flex gap-2 mt-2.5 flex-wrap">
                  <a className="btn-ghost !py-1.5 text-xs flex-1 min-w-[6rem] text-center" href={`tel:${a.orders?.customer_phone}`}>اتصل</a>
                  <button className="btn-ghost !py-1.5 text-xs flex-1 min-w-[6rem]" onClick={() => resolve(a, 'wait')}>يستنى</button>
                  <button className="btn-ghost !py-1.5 text-xs flex-1 min-w-[6rem]" onClick={() => forceDelivered(a)}>سجّله كمُسلَّم</button>
                  <button className="btn-ghost !py-1.5 text-xs flex-1 min-w-[6rem] !text-red-600" onClick={() => resolve(a, 'fail')}>توصيل فاشل</button>
                  <button className="btn-danger !py-1.5 text-xs flex-1 min-w-[6rem]" onClick={() => resolve(a, 'refund')}>إلغاء واسترداد</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 1. The phone call. This is the supervisor's actual job: the restaurant
             does not have a screen, so nothing moves until someone rings them
             and then records the answer here. */}
      <h2 className="font-bold mb-2.5">☎️ كلّم المطعم ({needsKitchen.length})</h2>
      {needsKitchen.length === 0 && (
        <div className="card p-5 text-center text-mist text-sm mb-6">مفيش طلبات مستنية مكالمة</div>
      )}
      <div className="space-y-3 mb-6">
        {needsKitchen.map(o => (
          <div key={o.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-bold">#{o.id} — {o.restaurants?.name}</h3>
                <p className="text-xs text-mist mt-0.5">👤 {o.customer_name} · <a className="text-sea" dir="ltr" href={`tel:${o.customer_phone}`}>{o.customer_phone}</a></p>
                <p className="text-xs text-mist mt-0.5">📍 {addr(o)}</p>
              </div>
              <div className="text-left shrink-0">
                <span className="font-bold text-sea block">{o.total} ج.م</span>
                <span className="text-xs text-mist">{orderStatusLabel(o.status)}</span>
              </div>
            </div>

            <div className="mt-3 bg-night border border-line rounded-xl p-3 text-sm space-y-1">
              <OrderLines orderId={o.id} />
            </div>

            {o.kitchen_status === 'new' ? (
              <>
                <p className="text-xs text-mist mt-3 mb-1.5">المطعم قال هيجهزه في قد إيه؟</p>
                <div className="flex gap-2">
                  {PREP_CHOICES.map(m => (
                    <button key={m} className="btn-sea !py-2 text-sm flex-1"
                      disabled={busy === `accept:${o.id}`}
                      onClick={() => accept(o, m)}>
                      {busy === `accept:${o.id}` ? '…' : `قبل · ${m} د`}
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

            <button className="w-full text-xs text-red-600 font-semibold mt-2.5 py-1"
              onClick={() => cancelOrder(o)}>
              المطعم رفض / مش هينفع — الغِ الطلب
            </button>
          </div>
        ))}
      </div>

      {/* 2. Dispatch */}
      <h2 className="font-bold mb-2.5">🛵 جاهز ومحتاج مندوب ({unassigned.length})</h2>
      {unassigned.length === 0 && (
        <div className="card p-5 text-center text-mist text-sm mb-6">مفيش طلبات جاهزة مستنية مندوب</div>
      )}
      <div className="space-y-3 mb-6">
        {unassigned.map(o => (
          <div key={o.id} className="card p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-sm truncate">#{o.id} — {o.restaurants?.name}</p>
              <p className="text-xs text-mist truncate">📍 {addr(o)}</p>
              <p className="text-xs text-mist">{orderStatusLabel(o.status)}</p>
            </div>
            <button className="btn-sea !py-2 !px-4 text-sm shrink-0" onClick={() => { setAssigning(o); setModalError('') }}>
              عيّن مندوب
            </button>
          </div>
        ))}
      </div>

      <PhoneOrderForm onCreated={load} />

      {/* 3. In flight */}
      <h2 className="font-bold mb-2.5">🚚 توصيلات جارية ({assignments.length})</h2>
      {assignments.length === 0 && (
        <div className="card p-5 text-center text-mist text-sm">مفيش توصيلات جارية</div>
      )}
      <div className="space-y-3">
        {assignments.map(a => (
          <div key={a.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-sm truncate">#{a.order_id} — {a.orders?.restaurants?.name}</p>
                <p className="text-xs text-mist mt-0.5">🛵 {a.drivers?.name} · محاولة {a.attempt_number}</p>
                <p className="text-xs text-mist mt-0.5">📍 {a.orders ? addr(a.orders) : '—'}</p>
              </div>
              <span className="text-xs font-semibold bg-shellup rounded-full px-2.5 py-1 shrink-0">
                {assignmentStatusLabel(a.status)}
              </span>
            </div>
            <LiveDeliveryDetail live={liveById[a.id]} />
            <div className="flex gap-2 mt-3 flex-wrap">
              <a className="btn-ghost !py-1.5 text-xs flex-1 min-w-[6rem] text-center" href={`tel:${a.drivers?.phone}`}>
                <span className="flex items-center justify-center gap-1"><Icon name="clock" className="w-3 h-3" />كلّم المندوب</span>
              </a>
              <button className="btn-ghost !py-1.5 text-xs flex-1 min-w-[6rem]" onClick={() => unassign(a)}>اسحب الطلب</button>
              {a.status === 'Out_for_Delivery' && (
                <button className="btn-ghost !py-1.5 text-xs flex-1 min-w-[6rem]" onClick={() => forceDelivered(a)}>سجّله كمُسلَّم</button>
              )}
              {a.orders && (
                <button className="btn-danger !py-1.5 text-xs flex-1 min-w-[6rem]" onClick={() => cancelOrder(a.orders!)}>إلغاء</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {assigning && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => setAssigning(null)}>
          <div className="card !rounded-2xl w-full max-w-sm p-5 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">تعيين مندوب لطلب #{assigning.id}</h3>
            <p className="text-xs text-mist mb-3">{assigning.restaurants?.name} → {addr(assigning)}</p>
            {modalError && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-3">{modalError}</p>}
            {availableDrivers.length === 0 && <p className="text-sm text-mist">مفيش مندوبين متاحين دلوقتي</p>}
            <div className="space-y-2">
              {availableDrivers.map(d => (
                <button key={d.id} className="w-full card p-3 text-right hover:border-sea/50 disabled:opacity-50"
                  disabled={!!busy}
                  onClick={() => assign(assigning, d)}>
                  <span className="block font-semibold text-sm">{d.name}</span>
                  <span className="block text-xs text-mist">{d.vehicle_type === 'van' ? 'فان' : 'موتوسيكل'} · {d.phone}</span>
                </button>
              ))}
            </div>
            <button className="btn-ghost w-full mt-3 text-sm" onClick={() => setAssigning(null)}>إغلاق</button>
          </div>
        </div>
      )}
    </div>
  )
}

// The supervisor is reading this list down a phone line to a restaurant, so it
// has to be the real thing -- sizes, combo and add-ons included, exactly as the
// kitchen screen would show it.
function OrderLines({ orderId }: { orderId: number }) {
  const [lines, setLines] = useState<
    { id: number; name: string; qty: number; size_name: string | null; combo_name: string | null; addon_names: string[] | null }[] | null
  >(null)

  useEffect(() => {
    supabase.from('order_items').select('id, name, qty, size_name, combo_name, addon_names')
      .eq('order_id', orderId)
      .then(({ data }) => setLines((data as any) ?? []))
  }, [orderId])

  if (lines === null) return <p className="text-mist text-xs">…</p>
  if (lines.length === 0) return <p className="text-mist text-xs">مفيش أصناف على الطلب ده</p>

  return (
    <>
      {lines.map(l => (
        <div key={l.id}>
          <span className="font-semibold">{l.name} × {l.qty}</span>
          {(l.combo_name || l.size_name || (l.addon_names && l.addon_names.length > 0)) && (
            <span className="block text-xs text-mist">
              {[l.combo_name && `كومبو ${l.combo_name}`, l.size_name, ...(l.addon_names ?? [])]
                .filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
      ))}
    </>
  )
}
