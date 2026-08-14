import { useEffect, useRef, useState, useId } from 'react'
import { supabase } from '../lib/supabase'
import { useDismissable } from '../lib/useDismissable'
import { useAuth } from '../lib/auth'
import { startRinging, stopRinging } from '../lib/ring'
import { ping } from '../lib/notify'
import { useDeliveryQuote } from '../lib/deliveryQuote'
import { serviceFeeFor, useServiceFeePct } from '../lib/serviceFee'
import { isValidEgyptPhone, PHONE_HINT } from '../lib/validation'
import { registerPush, persistPushToken } from '../lib/push'
import { orderStatusLabel } from '../lib/statusLabels'
import { rpc } from '../lib/rpc'
import { customerOrderCreation } from '../lib/customerOrderCreation'
import { vendorOperation } from '../lib/vendorOperations'
import { catalogCheck } from '../lib/catalogChecks'
import PrescriptionLink from '../components/PrescriptionLink'
import EnablePushButton from '../components/EnablePushButton'
import EnableSoundButton from '../components/EnableSoundButton'
import VendorMenuManager from '../components/VendorMenuManager'
import type { Compound, DeliverySlotRow, MenuItem, Order, OrderItem, Restaurant } from '../lib/types'
import Icon from '../components/Icon'
import Toggle from '../components/Toggle'
import { useSheets } from '../components/ActionSheets'
import { cairoToday, cairoLocalInputToISO } from '../lib/cairoTime'

const KITCHEN = [
  { key: 'new', label: 'طلب جديد', next: 'preparing', action: 'قبول وبدء التحضير' },
  { key: 'preparing', label: 'قيد التحضير', next: 'ready', action: 'جاهز للاستلام' },
  { key: 'ready', label: 'جاهز', next: null, action: null },
]

export default function Vendor() {
  const { profile } = useAuth()
  const rid = profile?.restaurant_id
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [restaurantFailed, setRestaurantFailed] = useState(false)
  const [view, setView] = useState<'main' | 'request' | 'history' | 'menu'>('main')

  // The error was discarded, so one failed request on a bad connection left the
  // vendor on "جاري التحميل…" permanently -- no orders, no ring, no retry, and
  // nothing on screen suggesting a reload. Driver.tsx already handles this; this
  // screen did not.
  function loadRestaurant() {
    if (!rid) return
    setRestaurantFailed(false)
    supabase.from('restaurants').select('*').eq('id', rid).single()
      .then(({ data, error }) => {
        if (error || !data) { setRestaurantFailed(true); return }
        setRestaurant(data)
      })
  }

  useEffect(loadRestaurant, [rid])

  useEffect(() => {
    if (!rid) return
    registerPush(persistPushToken)
  }, [rid])

  // Ring for new orders regardless of which screen the vendor is currently
  // on (main kitchen view, driver-request view, or history) -- this must
  // live in the always-mounted parent, not inside KitchenVendor, since that
  // component unmounts (and its polling/ring stops) whenever the vendor
  // navigates away from the main view.
  useEffect(() => {
    if (!rid) return
    async function checkNew() {
      const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true })
        .eq('restaurant_id', rid).eq('kitchen_status', 'new').neq('status', 'Cancelled')
      if ((count ?? 0) > 0) startRinging(); else stopRinging()
      ping('vendor_new_order', count ?? 0, 'طلب جديد 🔔', 'وصلك طلب جديد على سالكة')
    }
    checkNew()
    const t = setInterval(checkNew, 8000)
    return () => { clearInterval(t); stopRinging() }
  }, [rid])

  if (!rid) return <p className="text-mist text-center py-10">حسابك غير مرتبط بمطعم. تواصل مع الإدارة.</p>
  if (!restaurant) return restaurantFailed ? (
    <div className="card p-6 text-center max-w-sm mx-auto mt-10">
      <p className="font-semibold">مش قادرين نحمّل بيانات المطعم</p>
      <p className="text-sm text-mist mt-1 mb-4">اتأكد إن النت شغال وجرب تاني.</p>
      <button className="btn-sea !py-2 !px-5 text-sm" onClick={loadRestaurant}>حاول تاني</button>
    </div>
  ) : <p className="text-mist text-center py-10">جاري التحميل…</p>

  // "Own system" vendors (McDonald's/KFC/Pizza Hut style) have no menu ordering
  // through Salka at all — requesting a driver IS their whole workflow, with
  // history as a secondary tab.
  if (restaurant.order_mode === 'pickup_request') {
    return (
      <div className="max-w-lg mx-auto">
        {/* Was only on the OTHER return, which meant it was missing from exactly
            the vendors the fix was written for -- كنتاكي, ماكدونالدز, بيتزا هت
            are all order_mode = 'pickup_request'. Caught in review. */}
        <EnablePushButton required onToken={persistPushToken} label="فعّل تنبيهات طلبات المندوب" />
        <EnableSoundButton />
        <div className="flex gap-2 mb-4">
          <button className={`tab ${view !== 'history' ? 'tab-active' : 'bg-shellup/60'}`} onClick={() => setView('main')}>🛵 طلب مندوب</button>
          <button className={`tab ${view === 'history' ? 'tab-active' : 'bg-shellup/60'}`} onClick={() => setView('history')}>🧾 السجل</button>
        </div>
        {view === 'history'
          ? <RideHistoryPanel restaurantId={restaurant.id} />
          : <DriverRequestPanel restaurant={restaurant} standalone />}
      </div>
    )
  }

  // Every other vendor: normal kitchen-ticket flow is primary, but they can
  // also request a driver as a secondary action for an order that came in
  // through a channel other than Salka (walk-in, phone, etc), plus see their
  // ride history.
  return (
    <div className="max-w-lg mx-auto">
      {/* THE BUTTON THAT WAS NEVER HERE.
       *
       * This page called registerPush() on mount and stopped there.
       * registerPush deliberately never prompts -- it only refreshes a token
       * when permission is ALREADY granted -- and no other vendor surface
       * offered the prompt. So a vendor had no way, anywhere in the app, to
       * turn notifications on.
       *
       * That is not a theory. On 2026-08-07, six of seven vendor accounts had
       * no push token and never had: كنتاكي, ماكدونالدز, بيتزا هت, إستاكوزا,
       * صيدلية, سوبرماركت, هارت أتاك. The advice "tell the vendors to enable
       * notifications on their own devices" was impossible to follow.
       */}
      <EnablePushButton required onToken={persistPushToken} label="فعّل تنبيهات الطلبات الجديدة" />
      <EnableSoundButton />
      {view === 'main' && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button className="btn-ghost text-sm" onClick={() => setView('menu')}>
              📋 إدارة المنيو
            </button>
            <button className="btn-ghost text-sm" onClick={() => setView('request')}>
              🛵 طلب مندوب
            </button>
            <button className="btn-ghost text-sm" onClick={() => setView('history')}>
              🧾 سجل طلبات المندوب
            </button>
          </div>
          <KitchenVendor rid={rid} />
        </>
      )}
      {view === 'menu' && <VendorMenuManager restaurant={restaurant} onClose={() => setView('main')} />}
      {view === 'request' && <DriverRequestPanel restaurant={restaurant} onClose={() => setView('main')} />}
      {view === 'history' && (
        <div>
          <button className="text-sm text-mist hover:text-foam mb-4" onClick={() => setView('main')}><Icon name="chevronLeft" className="w-3 h-3 inline-block align-middle ml-1 rotate-180" />رجوع</button>
          <RideHistoryPanel restaurantId={restaurant.id} />
        </div>
      )}
    </div>
  )
}

// ── Full history of driver requests for this vendor (both own-system and
//    off-platform-order requests), not just the last few.
function RideHistoryPanel({ restaurantId }: { restaurantId: number }) {
  const [rides, setRides] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('orders').select('*')
      .eq('restaurant_id', restaurantId).eq('order_type', 'pickup_request')
      .order('id', { ascending: false }).limit(100)
      .then(({ data }) => { setRides(data ?? []); setLoading(false) })
  }, [restaurantId])

  if (loading) return <p className="text-mist text-center py-8">جاري التحميل…</p>
  if (rides.length === 0) return <p className="text-mist text-center py-8">لسه مفيش طلبات مندوب</p>

  return (
    <div className="space-y-2.5">
      {rides.map(o => (
        <div key={o.id} className="card p-3.5">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-sm">#{o.id} — {o.customer_name}</p>
            <span className="text-xs font-semibold text-mist">{orderStatusLabel(o.status)}</span>
          </div>
          <p className="text-mist text-xs mt-0.5">{o.zone} — وحدة {o.unit_number}</p>
          <p className="text-xs text-mist mt-1">
            {new Date(o.created_at).toLocaleDateString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short' })}
            {o.payment_mode === 'driver_pays' ? ` · المندوب دفع ${o.collect_amount} ج.م` : ' · مدفوع مقدمًا'}
          </p>
        </div>
      ))}
    </div>
  )
}

// ── Shared "request a driver" form — used as the whole screen for own-system
//    vendors, and as a secondary panel for regular vendors with an off-platform order.
function DriverRequestPanel({ restaurant, standalone, onClose }: { restaurant: Restaurant; standalone?: boolean; onClose?: () => void }) {
  const fid = useId()
  const [compounds, setCompounds] = useState<Compound[]>([])
  const [recent, setRecent] = useState<Order[]>([])

  const [name, setName] = useState(''); const [phone, setPhone] = useState('')
  const [unit, setUnit] = useState('')
  const [addrNotes, setAddrNotes] = useState('')
  const [compoundId, setCompoundId] = useState<number | null>(null)
  const [paymentMode, setPaymentMode] = useState<'prepaid' | 'driver_pays'>('prepaid')
  const [collectAmount, setCollectAmount] = useState('')
  const [orderNotes, setOrderNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // request_pickup returns { id, token }, and this screen used to destructure
  // only `error` -- so the public_token was created and thrown away on every
  // pickup order. my_orders() withholds the token from an unverified phone
  // lookup, so MyOrders then linked the customer to /track/null. The vendor is
  // the only party who ever holds this token; if they do not pass it on, the
  // order is untrackable for its whole life.
  const [sent, setSent] = useState<{ id: number; token: string } | null>(null)

  async function loadRecent() {
    const { data, error: err } = await supabase.from('orders').select('*')
      .eq('restaurant_id', restaurant.id).eq('order_type', 'pickup_request')
      .order('id', { ascending: false }).limit(10)
    // Keep the last known list on a failed poll. Blanking it would tell the
    // vendor the pickup orders they just created do not exist -- and this runs
    // on a 10s interval, so one blip used to wipe the list.
    if (err) return
    setRecent(data ?? [])
  }

  useEffect(() => {
    supabase.from('compounds').select('*').eq('active', true).order('direction').order('distance_km')
      // A failed compound list renders an empty picker, and the vendor cannot
      // file the order at all. Keep it empty but say why rather than leaving
      // them tapping a dropdown with nothing in it.
      .then(({ data, error: err }) => { if (err) { setError('مش قادرين نجيب المناطق — جرب تاني'); return } setCompounds(data ?? []) })
    loadRecent()
    const t = setInterval(loadRecent, 10000)
    return () => clearInterval(t)
  }, [restaurant.id])

  const selectedCompound = compounds.find(c => c.id === compoundId)
  const { fee: deliveryFee, quote, loading: feeLoading, failed: feeFailed, retry: retryFee } =
    useDeliveryQuote(compoundId)
  const amount = Number(collectAmount) || 0
  // Server-owned percentage, same hook as every other screen that shows money.
  const { pct: serviceFeePct } = useServiceFeePct()
  const pickupServiceFee = paymentMode === 'driver_pays' ? serviceFeeFor(amount, serviceFeePct) : 0
  const valid = name.trim() && isValidEgyptPhone(phone) && compoundId && unit.trim()
    && deliveryFee !== null && (paymentMode === 'prepaid' || amount > 0)

  async function submit() {
    if (!valid) return
    setSaving(true); setError('')
    const result = await customerOrderCreation<{ id: number; token: string }>('pickup', {
      restaurantId: restaurant.id,
      customerName: name.trim(),
      customerPhone: phone.trim(),
      zone: selectedCompound?.name ?? '',
      unitNumber: unit.trim(),
      addressNotes: addrNotes.trim(),
      deliveryFee: deliveryFee ?? 0, // server recomputes and ignores this
      paymentMode,
      collectAmount: paymentMode === 'driver_pays' ? amount : null,
      requestNotes: orderNotes.trim(),
      compoundId
    })
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    setName(''); setPhone(''); setUnit(''); setAddrNotes(''); setCompoundId(null)
    setCollectAmount(''); setOrderNotes(''); setPaymentMode('prepaid')
    const created = result.data
    setSent(created && created.token ? { id: created.id, token: created.token } : null)
    loadRecent()
  }

  return (
    <div className="max-w-lg mx-auto pb-6">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold">🛵 {restaurant.name} — طلب مندوب</h1>
        {!standalone && <button className="text-sm text-mist hover:text-foam" onClick={onClose}>إغلاق ✕</button>}
      </div>
      <p className="text-mist text-sm mb-4">
        {standalone
          ? 'لما عميل يطلب عندك مباشرة (من التطبيق بتاعكم أو تليفونيًا)، سجّل بياناته هنا عشان نبعتلكم مندوب'
          : 'لأوردر جالك من غير سالكة (تليفون أو عميل حاضر)، سجّل بياناته هنا وهنبعتلك مندوب'}
      </p>

      {sent && (
        <div className="bg-emerald-50 text-emerald-800 rounded-xl p-3.5 text-sm mb-4 space-y-2">
          <p className="font-semibold text-center">✅ تم إرسال الطلب للمندوبين — طلب #{sent.id}</p>
          <p className="text-xs">ابعت اللينك ده للعميل عشان يتابع المندوب:</p>
          <div className="flex gap-2">
            <input readOnly dir="ltr" className="field !py-1.5 text-xs flex-1"
              value={`${window.location.origin}/track/${sent.token}`}
              onFocus={e => e.currentTarget.select()} />
            <button className="btn-ghost !py-1.5 !px-3 text-xs shrink-0"
              onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/track/${sent.token}`)}>
              نسخ
            </button>
          </div>
          <button className="text-xs text-mist underline" onClick={() => setSent(null)}>إخفاء</button>
        </div>
      )}

      <div className="card p-4 mb-4">
        <h2 className="font-bold mb-3">هل العميل دفع بالفعل؟</h2>
        <div className="space-y-2.5">
          <label className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-3 cursor-pointer ${paymentMode === 'prepaid' ? 'border-sea bg-sea/5' : 'border-line'}`}>
            <span className="font-semibold flex-1">أيوه، دفع خلاص</span>
            <input type="radio" checked={paymentMode === 'prepaid'} onChange={() => setPaymentMode('prepaid')} className="accent-sea w-4 h-4" />
          </label>
          <label className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-3 cursor-pointer ${paymentMode === 'driver_pays' ? 'border-sea bg-sea/5' : 'border-line'}`}>
            <span className="font-semibold flex-1">لأ، المندوب يدفع ويحصلها من العميل كاش</span>
            <input type="radio" checked={paymentMode === 'driver_pays'} onChange={() => setPaymentMode('driver_pays')} className="accent-sea w-4 h-4" />
          </label>
        </div>
        {paymentMode === 'driver_pays' && (
          <div className="mt-3">
            <label className="label" htmlFor={`${fid}-1`}>قيمة الأوردر اللي المندوب هيدفعها *</label>
            <input id={`${fid}-1`} className="field" type="number" inputMode="decimal" value={collectAmount}
              onChange={e => setCollectAmount(e.target.value)} placeholder="مثال: 250" />
          </div>
        )}
      </div>

      <div className="mb-4">
        <label className="label" htmlFor={`${fid}-2`}>تفاصيل الأوردر (رقمه، أي حاجة تفيد المندوب)</label>
        <textarea id={`${fid}-2`} className="field min-h-[70px]" value={orderNotes} onChange={e => setOrderNotes(e.target.value)}
          placeholder="مثال: أوردر رقم 1234" />
      </div>

      <div className="card p-4 mb-4 space-y-3">
        <h2 className="font-bold">عنوان العميل</h2>
        <div><label className="label" htmlFor={`${fid}-3`}>اسم العميل *</label>
          <input id={`${fid}-3`} className="field" value={name} onChange={e => setName(e.target.value)} placeholder="الاسم بالكامل" /></div>
        <div><label className="label" htmlFor={`${fid}-4`}>رقم موبايل العميل *</label>
          <input id={`${fid}-4`} className={`field ${phone.trim() && !isValidEgyptPhone(phone) ? '!border-red-400' : ''}`}
            dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01xxxxxxxxx" maxLength={13} />
          {phone.trim() && !isValidEgyptPhone(phone) && <p className="text-xs text-red-600 mt-1">{PHONE_HINT}</p>}</div>
        <div><label className="label" htmlFor={`${fid}-5`}>المكان *</label>
          <select id={`${fid}-5`} className="field" value={compoundId ?? ''} onChange={e => setCompoundId(Number(e.target.value) || null)}>
            <option value="">اختر المكان…</option>
            {compounds.map(c => <option key={c.id} value={c.id}>{c.name} (~{c.est_travel_minutes} د)</option>)}
          </select></div>
        <div><label className="label" htmlFor={`${fid}-6`}>رقم الشاليه / الفيلا *</label>
          <input id={`${fid}-6`} className="field" value={unit} onChange={e => setUnit(e.target.value)} placeholder="مثال: B4 - 204" /></div>
        <div><label className="label" htmlFor={`${fid}-7`}>علامة مميزة (اختياري)</label>
          <input id={`${fid}-7`} className="field" value={addrNotes} onChange={e => setAddrNotes(e.target.value)} placeholder="مثال: بجوار حمام السباحة" /></div>
      </div>

      {compoundId && (
        <div className="card p-4 mb-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span>رسوم التوصيل{quote ? ` لـ ${quote.compound_name}` : ''}</span>
            <span>
              {deliveryFee !== null ? `${deliveryFee} ج.م`
                : feeLoading ? '…'
                : <button className="text-sea underline" onClick={retryFee}>إعادة المحاولة</button>}
            </span>
          </div>
          {paymentMode === 'driver_pays' && (
            <div className="flex justify-between text-sm"><span>قيمة الأوردر (كاش للمندوب)</span><span>{amount || 0} ج.م</span></div>
          )}
          {/* request_pickup charges the same 8% service fee as every other order
              path now. Without these two lines the vendor tells the customer a
              number 8% below what the driver asks for at the door -- which is a
              doorstep argument, and the vendor is the one standing in it. Only
              on driver_pays: a prepaid order is paid at the shop and the driver
              collects the delivery fee alone. */}
          {paymentMode === 'driver_pays' && (
            <div className="flex justify-between text-sm">
              <span>رسوم الخدمة</span>
              <span>{pickupServiceFee != null ? `${pickupServiceFee} ج.م` : '…'}</span>
            </div>
          )}
          {paymentMode === 'driver_pays' && (
            <div className="flex justify-between text-sm font-bold border-t border-line pt-2">
              <span>المندوب هيحصّل</span>
              <span>
                {deliveryFee != null && pickupServiceFee != null
                  ? `${deliveryFee + (Number(amount) || 0) + pickupServiceFee} ج.م`
                  : '…'}
              </span>
            </div>
          )}
        </div>
      )}

      {feeFailed && compoundId && (
        <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">
          مش قادرين نحسب رسوم التوصيل دلوقتي.{' '}
          <button className="underline font-semibold" onClick={retryFee}>جرب تاني</button>
        </p>
      )}

      {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">{error}</p>}

      <button className="btn-sea w-full !py-3.5 mb-5" disabled={!valid || saving} onClick={submit}>
        {saving ? 'جاري الإرسال…'
          : deliveryFee === null && compoundId ? 'بنحسب التوصيل…'
          : 'اطلب مندوب الآن'}
      </button>

      {recent.length > 0 && (
        <>
          <h2 className="font-bold text-mist mb-3">آخر الطلبات</h2>
          <div className="space-y-2.5">
            {recent.map(o => (
              <div key={o.id} className="card p-3.5 flex items-center justify-between text-sm">
                <div>
                  <p className="font-semibold">#{o.id} — {o.customer_name}</p>
                  <p className="text-mist text-xs mt-0.5">{o.zone} — وحدة {o.unit_number}</p>
                </div>
                <span className="text-xs font-semibold text-mist">{orderStatusLabel(o.status)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Normal catalog vendors: kitchen ticket flow (accept/prepare/ready)
function KitchenVendor({ rid }: { rid: number }) {
  const [orders, setOrders] = useState<Order[]>([])
  // Per-order in-flight key + a board-level error line. Neither existed: the two
  // kitchen buttons were fire-and-forget with no pending state, so a 3-second
  // mobile round trip left them tappable and a double tap fired twice.
  const [busyOrder, setBusyOrder] = useState<number | null>(null)
  const [boardError, setBoardError] = useState('')
  const [completedToday, setCompletedToday] = useState<Order[]>([])
  const [completedView, setCompletedView] = useState<'delivered' | 'rejected'>('delivered')
  // Live work and finished work were one scroll. On a busy evening that is two
  // tickets needing a response sitting above twenty completed ones, each
  // rendering the same full card. The vendor screen has one job -- show what
  // still needs doing -- so finished orders move behind a tab.
  const [board, setBoard] = useState<'live' | 'done'>('live')
  const [items, setItems] = useState<Record<number, OrderItem[]>>({})
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [deliveryByOrder, setDeliveryByOrder] = useState<Record<number, { status: string; driver_name: string; driver_phone: string | null; arrived_at_restaurant_at: string | null; out_for_delivery_at: string | null }>>({})
  const [stockOpen, setStockOpen] = useState(false)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [isOpen, setIsOpen] = useState(true)
  /** vendor_open_states() failed, so the toggle below is showing a guess. */
  const [openStateFailed, setOpenStateFailed] = useState(false)
  /** The restaurants.name read failed. Separate from loadError so one cannot
   *  clear the other in the same render pass. */
  const [nameFailed, setNameFailed] = useState(false)
  const [name, setName] = useState('')
  const [vendorType, setVendorType] = useState('')
  const [usesSlots, setUsesSlots] = useState(false)
  // Was admin-only: a vendor who wanted a slot window changed had to call and
  // wait for an admin to do it. Vendors can now manage their own restaurant's
  // slot times/capacity directly; whether the restaurant uses slots at all
  // (uses_delivery_slots) stays an admin-set switch -- that's closer to a
  // contract term than day-to-day ops.
  const [slots, setSlots] = useState<DeliverySlotRow[]>([])
  const [slotsOpen, setSlotsOpen] = useState(false)
  const [newSlot, setNewSlot] = useState({ start_time: '', end_time: '', capacity: '6' })
  const [slotError, setSlotError] = useState('')
  const [declining, setDeclining] = useState<Order | null>(null)
  const [declineError, setDeclineError] = useState('')
  const decliningRef = useDismissable(() => { setDeclining(null); setDeclineError('') }, !!declining)
  const [reliability, setReliability] = useState<{ avg_accept_minutes: number | null; total_orders: number } | null>(null)
  // Non-empty while the last poll failed. Never blanks the board -- it sits
  // above whatever is still on screen and says the screen may be stale.
  const [loadError, setLoadError] = useState('')
  const audioUnlocked = useRef(false)
  const stockRef = useRef<HTMLDivElement>(null)
  const { confirmSheet, sheetElement } = useSheets()

  // Every read here decides what a vendor believes about their own shop, and
  // every one of them used to discard its error. `?? []` turns a failed fetch
  // into an empty array, which renders as an empty orders board -- so a
  // restaurant with live tickets was shown a clean screen and told, in effect,
  // that nobody had ordered. That is not a cosmetic failure; it is food that
  // never gets cooked.
  //
  // The orders read is the one that matters, so it is the one that sets the
  // banner. The rest keep the last known good value rather than blanking, which
  // is why the setters below are guarded on `!error` instead of writing `?? []`
  // unconditionally.
  async function load() {
    if (!rid) return
    // `restaurants.is_open` is a stale column: vendor_is_open_now() decides who
    // is open, never reads it, and nothing resets it to true after a temporary
    // close expires. Reading it raw showed every vendor «مقفول» on their own
    // dashboard while they were open and taking orders. vendor_open_states()
    // returns the computed value. (rErr was destructured and never used
    // anywhere in this file -- noUnusedLocals is off, so it compiled clean.)
    // setLoadError('') further down runs in the same React batch, so setting the
    // banner here meant it was wiped before it ever painted -- the exact
    // swallowed error this block was written to stop. Held separately.
    const { data: r, error: rErr } = await supabase.from('restaurants').select('name, vendor_type, uses_delivery_slots').eq('id', rid).single()
    setNameFailed(!!rErr)
    if (r) { setName(r.name); setVendorType(r.vendor_type); setUsesSlots(!!r.uses_delivery_slots) }
    if (r?.uses_delivery_slots || r?.vendor_type === 'supermarket') {
      const { data: sl, error: slErr } = await supabase.from('delivery_slots').select('*')
        .eq('restaurant_id', rid).order('start_time')
      if (!slErr) setSlots(sl ?? [])
    }
    // The error was not even destructured. On failure `mine` is undefined,
    // setIsOpen never runs, and isOpen keeps useState(true) -- a vendor who is
    // actually closed reads «مفتوح» on their own dashboard and waits for orders
    // that will never come. Leave the toggle alone AND say the read failed.
    const { data: states, error: sErr } = await supabase.rpc('vendor_open_states')
    if (sErr) setOpenStateFailed(true); else setOpenStateFailed(false)
    const mine = ((states ?? []) as { id: number; is_open: boolean }[]).find(v => v.id === rid)
    if (mine) setIsOpen(mine.is_open)
    const relRes = await catalogCheck<{ avg_accept_minutes: number | null; total_orders: number }>('restaurantReliability', { restaurantId: rid })
    if (relRes.ok) setReliability(relRes.data)
    const { data: m, error: mErr } = await supabase.from('menu_items').select('*').eq('restaurant_id', rid).order('category').order('name')
    if (!mErr) setMenu(m ?? [])
    const { data: o, error: oErr } = await supabase.from('orders').select('*')
      .eq('restaurant_id', rid)
      .not('status', 'in', '("Delivered","Cancelled","Failed_Delivery","awaiting_payment")')
      .order('id', { ascending: false }).limit(30)

    // The whole point of the screen. If this failed we must NOT paint an empty
    // board -- say so, keep whatever was last on screen, and let the poll retry.
    if (oErr) { setLoadError('مش قادرين نجيب الطلبات دلوقتي — الشاشة دي ممكن تكون ناقصة'); return }
    setLoadError('')
    setOrders(o ?? [])

    // Cairo midnight, not the device's own -- a shared tablet or a phone left
    // on UTC would otherwise drop or include orders around the actual rollover.
    const todayStartIso = cairoLocalInputToISO(`${cairoToday()}T00:00`)
    const { data: done, error: dErr } = await supabase.from('orders').select('*')
      .eq('restaurant_id', rid).in('status', ['Delivered', 'Cancelled', 'Failed_Delivery'])
      .gte('created_at', todayStartIso ?? new Date().toISOString())
      .order('id', { ascending: false }).limit(50)
    if (!dErr) setCompletedToday(done ?? [])

    const allIds = [...(o ?? []), ...(done ?? [])].map(x => x.id)
    if (allIds.length) {
      const { data: its, error: itsErr } = await supabase.from('order_items').select('*')
        .in('order_id', allIds)
      // An order card with no lines looks like an EMPTY order, not a failed
      // fetch -- the vendor would cook nothing and mark it ready.
      if (itsErr) { setLoadError('مش قادرين نجيب تفاصيل الأصناف — متأكدش من محتوى الطلبات'); return }
      const grouped: Record<number, OrderItem[]> = {}
      for (const it of its ?? []) (grouped[it.order_id] ??= []).push(it)
      setItems(grouped)

      const overview = await vendorOperation<any[]>('deliveryOverview', { orderIds: allIds })
      if (!overview.ok) { setLoadError('مش قادرين نجيب بيانات المندوب دلوقتي — حالة التوصيل ممكن تكون قديمة'); return }
      const das = overview.data
      const delivMap: typeof deliveryByOrder = {}
      for (const d of das ?? []) {
        delivMap[d.order_id] = {
          status: d.status, driver_name: d.driver_name ?? 'المندوب',
          driver_phone: d.driver_phone ?? null,
          arrived_at_restaurant_at: d.arrived_at_restaurant_at, out_for_delivery_at: d.out_for_delivery_at
        }
      }
      setDeliveryByOrder(delivMap)
    }
  }

  async function addSlot() {
    const { error } = await supabase.from('delivery_slots').insert({
      restaurant_id: rid, start_time: newSlot.start_time,
      end_time: newSlot.end_time, capacity: Number(newSlot.capacity)
    })
    if (error) { setSlotError(`إضافة الفترة فشلت — ${error.message}`); return }
    setSlotError('')
    setNewSlot({ start_time: '', end_time: '', capacity: '6' })
    load()
  }

  async function toggleSlot(slot: DeliverySlotRow) {
    const { error } = await supabase.from('delivery_slots').update({ active: !slot.active }).eq('id', slot.id)
    if (error) { setSlotError('مش قادرين نغيّر الفترة دلوقتي'); return }
    setSlotError('')
    load()
  }

  useEffect(() => {
    const unlock = () => { audioUnlocked.current = true; document.removeEventListener('touchstart', unlock); document.removeEventListener('click', unlock) }
    document.addEventListener('touchstart', unlock, { once: true })
    document.addEventListener('click', unlock, { once: true })
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [rid])

  useEffect(() => {
    if (!stockOpen) return
    function onClickOutside(e: MouseEvent) {
      if (stockRef.current && !stockRef.current.contains(e.target as Node)) setStockOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [stockOpen])

  async function toggleStock(it: MenuItem) {
    setTogglingId(it.id)
    const result = await vendorOperation('setItemAvailability', { itemId: it.id, available: !it.available })
    setTogglingId(null)
    // Judgment call per ActionSheets: this screen already has a styled board
    // error banner, so route the failure there instead of a native alert.
    if (!result.ok) { setBoardError(`${it.name}: ${result.error}`); return }
    setMenu(prev => prev.map(m => m.id === it.id ? { ...m, available: !m.available } : m))
  }

  // The error was not even destructured. If the server refused -- the customer
  // cancelled, the order closed, the network dropped -- the phone buzzed, the
  // list repainted the ticket unchanged as "طلب جديد", and the vendor concluded
  // the tap had missed. Mid-rush they tap again, and again. decline() was fixed
  // for exactly this and advance() was left behind; both now use the shared
  // rpc() helper, whose ERROR_AR already carries the right Arabic for every
  // code these two raise.
  async function advance(o: Order, next: string, prepMinutes?: number) {
    if (busyOrder) return
    setBusyOrder(o.id); setBoardError('')
    if (navigator.vibrate) navigator.vibrate(15)
    const res = next === 'ready'
      ? await vendorOperation('ready', { orderId: o.id })
      : await vendorOperation('accept', { orderId: o.id, prepMinutes: prepMinutes ?? null }, {
          order_not_priced: 'الطلب ده لسه محتاج تسعير من الإدارة — استنى مكالمتهم',
        })
    if (!res.ok) { setBusyOrder(null); setBoardError(`طلب #${o.id}: ${res.error}`); return }

    // The RPC has committed, so paint the confirmed state immediately. load()
    // performs several sequential reads (restaurant, schedule, reliability,
    // menu, orders, items and assignments); waiting for all of them left the
    // old action enabled long enough for vendors to press it twice and believe
    // the first tap had failed. The server remains authoritative: reconcile
    // straight afterwards and keep the button locked until that finishes.
    setOrders(prev => prev.map(order => order.id === o.id
      ? { ...order, kitchen_status: next, ...(next === 'ready' ? { ready_at: new Date().toISOString() } : {}) }
      : order))
    await load()
    setBusyOrder(null)
  }

  // The vendor could not open their own restaurant. The badge looked like a
  // control -- same classes and same text as the admin screen's button -- and
  // did nothing, so a restaurant that opened at 5pm sat closed all evening with
  // no orders and no way to fix it.
  async function toggleOpen() {
    const next = !isOpen
    if (!next && !await confirmSheet({
      title: 'تقفل المطعم دلوقتي؟',
      body: 'مش هتوصلك طلبات جديدة لحد ما تفتحه تاني.',
      danger: true,
      confirmLabel: 'اقفل',
    })) return
    setBoardError('')
    const res = await vendorOperation('setOpen', { open: next })
    if (!res.ok) { setBoardError(res.error); return }
    setIsOpen(next)
    load()
  }

  async function delay(o: Order) {
    if (navigator.vibrate) navigator.vibrate(15)
    // Only delay_limit_reached was handled; not_your_order, wrong_stage and a
    // dropped connection all fell through to a repaint. The phone vibrates
    // regardless, so the vendor reads an unchanged ticket as a missed tap and
    // presses again -- while the customer's ETA has not moved and the SLA badge
    // is about to flip to متأخر.
    const res = await vendorOperation('delay', { orderId: o.id, minutes: 5 }, {
      delay_limit_reached: 'وصلت لأقصى عدد تأجيلات مسموح (3) للطلب ده',
      wrong_stage: 'الطلب اتحرك خلاص — مش هينفع تأجله دلوقتي',
      not_your_order: 'الطلب ده مش بتاع مطعمك',
    })
    if (!res.ok) { setBoardError(res.error); return }
    setBoardError('')
    load()
  }

  // The error was discarded outright, so when cancel_order refused -- it raises
  // `too_late_to_cancel` for a non-admin the moment status leaves 'pending', and
  // the رفض button renders on every live ticket -- the modal closed, the list
  // repainted from server state, and the vendor was left believing they had
  // declined an order that was still coming.
  async function decline() {
    if (!declining) return
    const res = await rpc('cancel_order', { p_order_id: declining.id, p_reason: 'vendor_declined' }, {
      too_late_to_cancel: 'الطلب اتقبل بالفعل ومعاه مندوب — كلّم الإدارة عشان تلغيه',
    })
    if (!res.ok) { setDeclineError(res.error); return }
    setDeclining(null); setDeclineError(''); load()
  }

  function remaining(o: Order) {
    if (!o.ready_at) return null
    return Math.round((+new Date(o.ready_at) - Date.now()) / 60000)
  }

  // The tab bar hides when nothing has finished, so the selection must follow
  // it -- otherwise the vendor's last delivery of the night leaves them staring
  // at an empty board.
  const liveBoard = completedToday.length === 0 ? 'live' : board

  const newOrders = orders.filter(o => (o.kitchen_status || 'new') === 'new')
  const active = orders.filter(o => (o.kitchen_status || 'new') === 'preparing')
  const ready = orders.filter(o => o.kitchen_status === 'ready')

  const compactRow = (o: Order) => {
    const label = COMPLETED_LABEL[o.status] ?? orderStatusLabel(o.status)
    const ok = o.status === 'Delivered'
    return (
      <div key={o.id} className="card !rounded-2xl p-3.5 flex items-center gap-3">
        <span className={`w-9 h-9 rounded-full grid place-items-center shrink-0 ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-shellup text-mist'}`}>
          {ok ? '✓' : '✗'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm truncate">#{o.id} — {o.customer_name}</p>
          <p className="text-xs text-mist mt-0.5 truncate">{label}</p>
        </div>
        <span className="text-xs text-mist shrink-0">{o.zone}</span>
      </div>
    )
  }

  // A new ticket yanks the screen back to the live board. A vendor reviewing
  // the evening's takings would otherwise have an order land on a tab they are
  // not looking at, and this screen already treats an unanswered ticket as the
  // most urgent thing in the building.
  // Compared as a SET of ids, not a count: a ticket being cancelled server-side
  // in the same 8s poll as a new one arriving reads as 1 -> 1, and the genuinely
  // new ticket then sits unanswered on a board nobody is looking at.
  const newKey = newOrders.map(o => o.id).sort().join(',')
  const seenNewRef = useRef<Set<string> | null>(null)
  useEffect(() => {
    const ids = new Set(newKey ? newKey.split(',') : [])
    const prev = seenNewRef.current
    seenNewRef.current = ids
    if (prev === null) return
    for (const k of ids) if (!prev.has(k)) { setBoard('live'); return }
  }, [newKey])

  // Reset, not mask. completedToday is filtered to today, so it empties at
  // midnight -- and a kitchen open past midnight with board='done' would be
  // thrown back onto the finished board the moment the first delivery of the
  // new day landed, mid-service, without touching anything.
  useEffect(() => {
    if (completedToday.length === 0) setBoard('live')
  }, [completedToday.length])

  const COMPLETED_LABEL: Record<string, string> = {
    Delivered: '✅ تم التوصيل', Cancelled: '✗ ملغي', Failed_Delivery: '⚠️ فشل التوصيل'
  }

  const card = (o: Order, big = false) => {
    const stage = KITCHEN.find(k => k.key === (o.kitchen_status || 'new'))!
    // Always undefined now: card() is only rendered from the live board, and
    // `orders` excludes Delivered/Cancelled/Failed_Delivery. Left in place --
    // inert, and the guard is correct if a completed order ever reaches here
    // again -- but do not read it as a live branch.
    const completed = COMPLETED_LABEL[o.status]
    // How long this order has been sitting unanswered. remaining() already
    // counts DOWN to ready_at, but that only matters once cooking has started --
    // nothing on the screen said how long a NEW order had been waiting, so a
    // ticket that arrived two minutes ago and one that arrived twenty looked
    // identical. The server already tracks a 30-minute stall threshold; this
    // shows the vendor the same clock before it trips.
    const waitedMin = big && o.created_at
      ? Math.max(0, Math.round((Date.now() - +new Date(o.created_at)) / 60000))
      : null
    const late = waitedMin !== null && waitedMin >= 10
    return (
      <div key={o.id} className={`card !rounded-2xl p-4 ${big ? 'border-sand ring-2 ring-sand/50' : ''}`}>
        {/* Reference shape: the order number is the biggest thing on the card
            and the clock sits opposite it, instead of a row of same-weight
            chips. A kitchen identifies a ticket by its number. */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-bold text-2xl leading-none tracking-tight">
              <span className="text-mist font-semibold text-lg">#</span>{o.id}
            </h2>
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
            </div>
            <p className="text-sm text-mist mt-1">{o.zone} — وحدة {o.unit_number}</p>
          </div>
          {/* No order total. The vendor prices what they cook, line by line --
              an order-level figure is a Salka number (it moved with delivery and
              service fees) and gave them a second total to argue with. */}
          <div className="shrink-0 text-left">
            {waitedMin !== null && !completed ? (
              <span className={`inline-flex items-center gap-1 text-sm font-bold rounded-xl px-3 py-1.5 border ${
                late ? 'border-red-400/50 bg-red-500/10 text-red-600'
                     : 'border-line bg-shell text-foam'}`}>
                ⏰ {waitedMin < 1 ? 'دلوقتي' : `${waitedMin} د`}
              </span>
            ) : (
              <span className="text-xs text-mist">{completed ?? stage.label}</span>
            )}
          </div>
        </div>

        {o.customer_note?.trim() && (
          <div className="mt-3 border border-sand/40 bg-sand/10 rounded-xl p-3">
            <p className="text-xs font-bold text-sandink">💬 ملاحظة العميل</p>
            <p className="text-sm mt-1 font-semibold whitespace-pre-wrap">{o.customer_note}</p>
          </div>
        )}

        {/* A custom_request order writes NO order_items rows -- the whole list
            lives in orders.request_items -- so this ticket used to render an
            empty box. The pharmacist was being asked to press "قبول · 20 د" on
            an order whose contents only the admin and the customer could see.
            There are no prices here because there are none yet: the admin quotes
            them by phone, and pricing_status stays 'pending_quote' until then. */}
        {o.order_type === 'custom_request' && (
          <div className="mt-3 bg-night border border-line !rounded-2xl p-3.5 text-sm space-y-1.5">
            {o.pricing_status === 'pending_quote' && (
              <p className="text-sandink text-xs font-semibold pb-1.5 border-b border-line">
                🧾 طلب لسه ما اتسعّرش — الإدارة هتتصل بالعميل وتحط السعر
              </p>
            )}
            {(o.request_items ?? []).length === 0 && (
              <p className="text-mist">مفيش أصناف مكتوبة على الطلب ده</p>
            )}
            {(o.request_items ?? []).map((it, i) => (
              <div key={i} className="flex justify-between">
                <span>{it.name}</span>
                <span className="text-mist shrink-0 mr-2">× {it.qty}</span>
              </div>
            ))}
            {o.request_notes && (
              <p className="text-sandink pt-1.5 border-t border-line">📝 {o.request_notes}</p>
            )}
            {o.prescription_path && (
              <div className="pt-1.5 border-t border-line"><PrescriptionLink path={o.prescription_path} /></div>
            )}
            {o.slot_id && o.scheduled_date && (
              <p className="text-mist pt-1.5 border-t border-line">🕐 فترة التوصيل: {o.scheduled_date}</p>
            )}
          </div>
        )}

        <div className={`mt-3 text-sm ${
          o.order_type === 'custom_request' && (items[o.id] ?? []).length === 0 ? 'hidden' : ''}`}>
          {/* A labelled column, then one row per line with a rule between --
              a kitchen reads down a list, it does not parse a paragraph. */}
          <div className="flex justify-between text-xs text-mist pb-2 border-b border-line">
            <span>الأصناف</span><span>السعر</span>
          </div>
          {(items[o.id] ?? []).map(it => (
            <div key={it.id} className="flex justify-between py-2.5 border-b border-line">
              <span className="font-semibold">
                {it.name} × {it.qty}{it.requires_prescription ? ' 💊' : ''}
                {(it.size_name || it.combo_name || (it.addon_names && it.addon_names.length > 0)) && (
                  <span className="block text-xs text-mist mt-0.5">
                    {/* The combo goes first and is marked: it changes what the
                        kitchen actually assembles, not just how much it costs. */}
                    {[it.combo_name && `🍟 كومبو ${it.combo_name}`, it.size_name, ...(it.addon_names ?? [])].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              <span className="text-mist shrink-0 mr-2 font-normal">{it.total} ج.م</span>
            </div>
          ))}
        </div>

        {(items[o.id] ?? []).some(it => it.requires_prescription) && (
          <p className="text-sandink text-sm mt-2">💊 الطلب فيه صنف يحتاج روشتة — أكّد مع العميل قبل التجهيز</p>
        )}

        {/* No money on this ticket beyond the per-item prices.
            It used to carry the customer's payment arrangement -- cash vs
            InstaPay, any deposit, and a total including delivery and service
            fees -- plus an order subtotal in the header and a day's-takings
            figure on the finished board. The vendor collects nothing from the
            customer; the driver does. Those numbers were Salka's, printed on a
            kitchen ticket, and the biggest of them was not even what the vendor
            was owed. What a kitchen needs is what to cook. */}

        {!completed && remaining(o) !== null && o.kitchen_status !== 'ready' && (
          <div className={`mt-3 rounded-2xl p-3 text-center ${remaining(o)! <= 2 ? 'bg-red-500/10' : 'bg-shellup'}`}>
            <p className={`font-bold leading-none ${remaining(o)! <= 2 ? 'text-red-600 text-3xl' : 'text-sea text-3xl'}`}>
              {remaining(o)! < 0 ? `متأخر ${Math.abs(remaining(o)!)} د` : `${remaining(o)} د`}
            </p>
            <p className="text-xs text-mist mt-1">{remaining(o)! < 0 ? '⏰ متأخر عن الوقت المتوقع' : 'متبقي للتجهيز'}</p>
          </div>
        )}

        {completed ? (
          <p className={`text-center text-sm mt-3 font-semibold ${o.status === 'Delivered' ? 'text-emerald-700' : 'text-mist'}`}>
            {completed}
          </p>
        ) : big ? (
          <div className="mt-4">
            {stage.next === 'preparing' ? (
              <div className="flex gap-2">
                {[15, 20, 30].map(m => (
                  <button key={m} className="btn-sea flex-1 !rounded-2xl !text-base !py-3.5"
                    disabled={busyOrder === o.id} onClick={() => advance(o, 'preparing', m)}>
                    {busyOrder === o.id ? '…' : `قبول · ${m} د`}
                  </button>
                ))}
              </div>
            ) : (
              <button className="btn-sea w-full !rounded-2xl !text-lg !py-4"
                disabled={busyOrder === o.id} onClick={() => advance(o, stage.next!)}>
                {busyOrder === o.id ? 'لحظة…'
                  : remaining(o) !== null && remaining(o)! > 0
                    ? `${stage.action} (${remaining(o)} د)`
                    : stage.action}
              </button>
            )}
            <button className="btn-ghost w-full !rounded-2xl !text-sm mt-2 !text-red-600 !border-red-400/40"
              onClick={() => { setDeclineError(''); setDeclining(o) }}>رفض الطلب</button>
          </div>
        ) : (
          <>
            {stage.next === 'preparing' ? (
              <div className="flex gap-2 mt-3">
                {[15, 20, 30].map(m => (
                  <button key={m} className="btn-sea flex-1 !rounded-2xl !text-sm !py-2.5 active:scale-95 transition-transform"
                    disabled={busyOrder === o.id} onClick={() => advance(o, 'preparing', m)}>
                    {busyOrder === o.id ? '…' : `قبول · ${m} د`}
                  </button>
                ))}
              </div>
            ) : stage.next && (
              <div className="flex gap-2.5 mt-3">
                <button className="btn-sea flex-1 !rounded-2xl active:scale-95 transition-transform"
                  disabled={busyOrder === o.id} onClick={() => advance(o, stage.next!)}>
                  {busyOrder === o.id ? 'لحظة…' : stage.action}
                </button>
                {o.delay_count < 3 && (
                  <button className="btn-ghost !rounded-2xl active:scale-95 transition-transform" onClick={() => delay(o)}>+5 دقائق</button>
                )}
              </div>
            )}
            {!stage.next && (() => {
              const d = deliveryByOrder[o.id]
              const minsSince = (t: string | null) => t ? Math.max(0, Math.round((Date.now() - +new Date(t)) / 60000)) : null
              if (!d) {
                // A bagged order waiting 20 minutes for a driver looked
                // identical to one ready 30 seconds ago -- same "في انتظار
                // المندوب" line, no elapsed time. The countdown card covers
                // overdue *prep*, but nothing flagged an overdue *pickup*.
                const waitMin = minsSince(o.ready_at)
                const stale = waitMin !== null && waitMin >= 15
                return (
                  <div className={`mt-3 rounded-2xl p-3.5 text-center ${stale ? 'bg-red-500/10' : 'bg-shellup'}`}>
                    <p className={`text-sm font-semibold ${stale ? 'text-red-700' : 'text-sea'}`}>
                      {stale ? '⚠️ ' : '✅ '}في انتظار المندوب{waitMin !== null ? ` — من ${waitMin} دقيقة` : ''}
                    </p>
                  </div>
                )
              }
              const label =
                d.status === 'Accepted' && d.arrived_at_restaurant_at ? '📍 وصل المطعم'
                : d.status === 'Accepted' ? '🛵 في الطريق للمطعم'
                : d.status === 'Picked_Up' ? '📦 استلم الطلب'
                : d.status === 'Out_for_Delivery' ? `🚗 في الطريق للعميل${minsSince(d.out_for_delivery_at) !== null ? ` — من ${minsSince(d.out_for_delivery_at)} دقيقة` : ''}`
                : d.status === 'Delivered' ? '✅ تم التوصيل'
                : '✅ في انتظار المندوب'
              return (
                <div className="mt-3 rounded-2xl bg-shellup p-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold truncate">{d.driver_name}</p>
                    <p className="text-sea text-sm font-semibold mt-0.5">{label}</p>
                  </div>
                  {d.driver_phone && d.status !== 'Delivered' && (
                    <a href={`tel:${d.driver_phone}`} className="shrink-0 w-11 h-11 rounded-full bg-emerald-500/15 text-emerald-800 grid place-items-center" aria-label="اتصال بالمندوب">📞</a>
                  )}
                </div>
              )
            })()}
          </>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* A failed accept used to be completely silent. This is the only place
          the vendor learns the tap did not take. */}
      {boardError && (
        <div className="card p-3 mb-3 border-red-400/50 bg-red-500/5 flex items-center justify-between gap-3">
          <p className="text-sm text-red-700 font-semibold">{boardError}</p>
          <button className="btn-ghost !py-1.5 !px-3 text-xs shrink-0" onClick={() => setBoardError('')}>تمام</button>
        </div>
      )}

      {/* A failed LOAD, as opposed to a failed action. Before this, a failed
          orders fetch resolved through `?? []` and painted a clean, empty
          board -- so a restaurant with live tickets was quietly told nobody had
          ordered. Not dismissable: it clears itself on the next successful
          poll, and a vendor who dismissed it would be straight back to trusting
          an empty screen. */}
      {(loadError || nameFailed || openStateFailed) && (
        <div className="card p-3 mb-3 border-sand/60 bg-sand/10 flex items-center justify-between gap-3">
          <p className="text-sm text-sandink font-semibold">
            📡 {loadError
              || (openStateFailed
                ? 'مش قادرين نتأكد إذا كنت فاتح ولا مقفول — الحالة تحت ممكن تكون قديمة'
                : 'مش قادرين نحمّل بيانات المطعم — اتأكد من النت')}
          </p>
          <button className="btn-ghost !py-1.5 !px-3 text-xs shrink-0" onClick={load}>حدّث</button>
        </div>
      )}

      {/* Closed is not a small badge. It means zero orders all evening, and it
          is the single most likely reason a vendor thinks the app is broken. */}
      {!isOpen && (
        <div className="card p-4 mb-3 border-sand/50 bg-sand/10 text-center">
          <p className="font-bold text-sandink">المطعم مقفول دلوقتي</p>
          <p className="text-sm text-mist mt-1">مش هتوصلك أي طلبات جديدة لحد ما تفتحه من المفتاح اللي تحت.</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mb-2">
        <h1 className="text-xl font-bold min-w-0 truncate">🍽️ {name}</h1>
        <div className="flex items-center gap-2 shrink-0">
          <Toggle on={isOpen} onChange={toggleOpen} label="مفتوح" labelOff="مقفول" />
          {(usesSlots || vendorType === 'supermarket') && (
            <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => setSlotsOpen(v => !v)}>
              ⏱️ فترات التوصيل
            </button>
          )}
          <div className="relative" ref={stockRef}>
            <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => setStockOpen(v => !v)}>
              📋 الأصناف {menu.filter(m => !m.available).length > 0 && `(${menu.filter(m => !m.available).length} خلص)`}
            </button>
            {stockOpen && (
              <div className="absolute left-0 mt-1 z-20 bg-shell border border-line rounded-xl shadow-lg py-2 w-72 max-h-[60vh] overflow-y-auto">
                <p className="text-xs text-mist px-3 pb-2">اقفل مفتاح الصنف اللي خلص عشان العميل يبطل يشوفه</p>
                {menu.map(m => (
                  <div key={m.id} className="flex items-center justify-between gap-2 px-3 py-2 min-h-[40px] hover:bg-night">
                    <span className={`text-sm min-w-0 truncate ${m.available ? '' : 'text-mist line-through'}`}>{m.name}</span>
                    <Toggle on={m.available} onChange={() => toggleStock(m)}
                      disabled={togglingId === m.id} ariaLabel={m.name} />
                  </div>
                ))}
                {menu.length === 0 && <p className="text-xs text-mist px-3 py-2">لا توجد أصناف</p>}
              </div>
            )}
          </div>
        </div>
      </div>

      {slotsOpen && (usesSlots || vendorType === 'supermarket') && (
        <div className="card p-4 mb-4">
          {slotError && <p className="text-sm text-red-600 mb-2">{slotError}</p>}
          <div className="space-y-2">
            {slots.map(sl => (
              <div key={sl.id} className="flex items-center justify-between bg-night border border-line rounded-xl p-2.5 text-sm">
                <span><bdi dir="ltr">{sl.start_time.slice(0, 5)} – {sl.end_time.slice(0, 5)}</bdi> · سعة {sl.capacity}</span>
                <Toggle on={!!sl.active} onChange={() => toggleSlot(sl)} label="فعّالة" labelOff="موقوفة" />
              </div>
            ))}
            {slots.length === 0 && <p className="text-xs text-mist">لسه مفيش فترات — ضيف واحدة تحت</p>}
          </div>
          <div className="flex gap-2 mt-3">
            <input type="time" className="field !py-1.5 text-sm" aria-label="وقت البداية" value={newSlot.start_time}
              onChange={e => setNewSlot({ ...newSlot, start_time: e.target.value })} />
            <input type="time" className="field !py-1.5 text-sm" aria-label="وقت النهاية" value={newSlot.end_time}
              onChange={e => setNewSlot({ ...newSlot, end_time: e.target.value })} />
            <input type="number" className="field !py-1.5 !w-20 text-sm" placeholder="سعة" aria-label="السعة" value={newSlot.capacity}
              onChange={e => setNewSlot({ ...newSlot, capacity: e.target.value })} />
          </div>
          <button className="btn-sea w-full mt-2 text-sm" disabled={!newSlot.start_time || !newSlot.end_time} onClick={addSlot}>
            إضافة فترة
          </button>
          <p className="text-xs text-mist mt-2 leading-relaxed">
            السعة = أقصى عدد طلبات في الفترة دي. اربطها بعدد المندوبين المتاحين وقتها مش بسرعة تجهيز المحل.
          </p>
        </div>
      )}

      {reliability && reliability.total_orders > 0 && (
        <p className="text-xs text-mist mb-4">
          آخر 30 يوم: {reliability.total_orders} طلب
          {reliability.avg_accept_minutes !== null && ` · متوسط وقت القبول ${reliability.avg_accept_minutes} دقيقة`}
        </p>
      )}
      {(!reliability || reliability.total_orders === 0) && <div className="mb-4" />}

      {/* Only once something has finished today -- the first order of the day
          should not arrive behind a tab bar explaining itself. */}
      {completedToday.length > 0 && (
        <div className="flex gap-2 mb-4">
          <button className={`tab flex-1 ${liveBoard === 'live' ? 'tab-active' : 'bg-shellup/60'}`}
            onClick={() => setBoard('live')}>
            شغل دلوقتي{orders.length > 0 ? ` (${orders.length})` : ''}
          </button>
          <button className={`tab flex-1 ${liveBoard === 'done' ? 'tab-active' : 'bg-shellup/60'}`}
            onClick={() => setBoard('done')}>
            خلصت النهاردة ({completedToday.length})
          </button>
        </div>
      )}

      {liveBoard === 'live' && (
        <>
          {orders.length === 0 && (
            <div className="card p-6 text-center text-mist">
              {completedToday.length > 0 ? 'مفيش طلبات مستنية — كله خلص ✅' : 'لا توجد طلبات حالياً'}
            </div>
          )}

          {newOrders.length > 0 && (
            <div className="mb-5 space-y-3">
              <p className="text-sandink font-bold animate-pulse">🔔 محتاج ردّك — {newOrders.length}</p>
              {newOrders.map(o => card(o, true))}
            </div>
          )}

          <div className="space-y-3">{active.map(o => card(o))}</div>

          {ready.length > 0 && (
            <>
              <h2 className="font-bold text-mist mt-6 mb-3">جاهز للاستلام</h2>
              <div className="space-y-3">{ready.map(o => card(o))}</div>
            </>
          )}
        </>
      )}

      {liveBoard === 'done' && (() => {
        const deliveredToday = completedToday.filter(o => o.status === 'Delivered')
        const rejectedToday = completedToday.filter(o => o.status !== 'Delivered')
        const shown = completedView === 'delivered' ? deliveredToday : rejectedToday
        return (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="flex gap-1.5">
                <button className={`tab !text-sm ${completedView === 'delivered' ? 'tab-active' : 'bg-shellup/60'}`}
                  onClick={() => setCompletedView('delivered')}>✅ تم التوصيل ({deliveredToday.length})</button>
                <button className={`tab !text-sm ${completedView === 'rejected' ? 'tab-active' : 'bg-shellup/60'}`}
                  onClick={() => setCompletedView('rejected')}>✗ ملغي/مرفوض ({rejectedToday.length})</button>
              </div>
              {completedView === 'delivered' && (
                <span className="text-mist text-sm shrink-0">{deliveredToday.length} طلب</span>
              )}
            </div>
            {shown.length === 0 ? (
              <p className="text-mist text-sm text-center py-4">لا يوجد طلبات هنا</p>
            ) : (
              /* A finished order is a line in a ledger. It used to render the
                 same card as a live ticket -- kitchen stages, item list, driver
                 tracking, action buttons that no longer do anything. */
              <div className="space-y-2.5">{shown.map(o => compactRow(o))}</div>
            )}
          </>
        )
      })()}

      {declining && (
        <div ref={decliningRef} className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" role="dialog" aria-modal="true" onClick={() => { setDeclining(null); setDeclineError('') }}>
          <div className="card !rounded-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-2">رفض الطلب #{declining.id}</h3>
            <p className="text-sm text-mist mb-4">هيتم إلغاء الطلب وإخطار العميل. متاح فقط قبل بدء التحضير.</p>
            {declineError && (
              <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-3">{declineError}</p>
            )}
            <div className="flex gap-3">
              <button className="btn-ghost !rounded-2xl flex-1" onClick={() => { setDeclining(null); setDeclineError('') }}>تراجع</button>
              <button className="btn-danger !rounded-2xl flex-1" onClick={decline}>تأكيد الرفض</button>
            </div>
          </div>
        </div>
      )}
      {sheetElement}
    </div>
  )
}
