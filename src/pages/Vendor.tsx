import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { startRinging, stopRinging } from '../lib/ring'
import { estimateDeliveryFee } from '../lib/deliveryFee'
import type { Compound, Order, OrderItem, Restaurant } from '../lib/types'

const KITCHEN = [
  { key: 'new', label: 'طلب جديد', next: 'preparing', action: 'قبول وبدء التحضير' },
  { key: 'preparing', label: 'قيد التحضير', next: 'ready', action: 'جاهز للاستلام' },
  { key: 'ready', label: 'جاهز', next: null, action: null },
]

export default function Vendor() {
  const { profile } = useAuth()
  const rid = profile?.restaurant_id
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)

  useEffect(() => {
    if (!rid) return
    supabase.from('restaurants').select('*').eq('id', rid).single().then(({ data }) => setRestaurant(data))
  }, [rid])

  if (!rid) return <p className="text-mist text-center py-10">حسابك غير مرتبط بمطعم. تواصل مع الإدارة.</p>
  if (!restaurant) return <p className="text-mist text-center py-10">جاري التحميل…</p>

  return restaurant.order_mode === 'pickup_request'
    ? <PickupRequestVendor restaurant={restaurant} />
    : <KitchenVendor rid={rid} />
}

// ── Own-system vendors (McDonald's/KFC/Pizza Hut style): staff request a
//    driver themselves once a customer has ordered directly with them.
//    Customers never see or trigger this — it's vendor-only.
function PickupRequestVendor({ restaurant }: { restaurant: Restaurant }) {
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
  const [sent, setSent] = useState(false)

  async function loadRecent() {
    const { data } = await supabase.from('orders').select('*')
      .eq('restaurant_id', restaurant.id).eq('order_type', 'pickup_request')
      .order('id', { ascending: false }).limit(10)
    setRecent(data ?? [])
  }

  useEffect(() => {
    supabase.from('compounds').select('*').eq('active', true).order('direction').order('distance_km')
      .then(({ data }) => setCompounds(data ?? []))
    loadRecent()
    const t = setInterval(loadRecent, 10000)
    return () => clearInterval(t)
  }, [restaurant.id])

  const selectedCompound = compounds.find(c => c.id === compoundId)
  const deliveryFee = selectedCompound ? estimateDeliveryFee(selectedCompound.distance_km) : 0
  const amount = Number(collectAmount) || 0
  const valid = name.trim() && phone.trim() && compoundId && unit.trim()
    && (paymentMode === 'prepaid' || amount > 0)

  async function submit() {
    if (!valid) return
    setSaving(true); setError('')
    const { error: err } = await supabase.rpc('request_pickup', {
      p_restaurant_id: restaurant.id,
      p_customer_name: name.trim(),
      p_customer_phone: phone.trim(),
      p_zone: selectedCompound?.name ?? '',
      p_unit_number: unit.trim(),
      p_address_notes: addrNotes.trim(),
      p_delivery_fee: deliveryFee,
      p_payment_mode: paymentMode,
      p_collect_amount: paymentMode === 'driver_pays' ? amount : null,
      p_request_notes: orderNotes.trim(),
      p_compound_id: compoundId
    })
    setSaving(false)
    if (err) { setError('حصل خطأ، جرب تاني'); return }
    setName(''); setPhone(''); setUnit(''); setAddrNotes(''); setCompoundId(null)
    setCollectAmount(''); setOrderNotes(''); setPaymentMode('prepaid')
    setSent(true); loadRecent()
    setTimeout(() => setSent(false), 3000)
  }

  return (
    <div className="max-w-lg mx-auto pb-6">
      <h1 className="text-xl font-bold mb-1">🛵 {restaurant.name} — طلب مندوب</h1>
      <p className="text-mist text-sm mb-5">
        لما عميل يطلب عندك مباشرة (من التطبيق بتاعكم أو تليفونيًا)، سجّل بياناته هنا عشان نبعتلكم مندوب
      </p>

      {sent && <p className="bg-emerald-50 text-emerald-700 rounded-xl p-3 text-sm mb-4 text-center">✅ تم إرسال الطلب للمندوبين</p>}

      <div className="card p-4 mb-5">
        <h2 className="font-bold mb-3">هل العميل دفع بالفعل؟</h2>
        <div className="space-y-2.5">
          <label className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-3 cursor-pointer ${paymentMode === 'prepaid' ? 'border-sea bg-sea/5' : 'border-line'}`}>
            <input type="radio" checked={paymentMode === 'prepaid'} onChange={() => setPaymentMode('prepaid')} className="accent-sea w-4 h-4" />
            <span className="font-semibold flex-1">أيوه، دفع خلاص</span>
          </label>
          <label className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-3 cursor-pointer ${paymentMode === 'driver_pays' ? 'border-sea bg-sea/5' : 'border-line'}`}>
            <input type="radio" checked={paymentMode === 'driver_pays'} onChange={() => setPaymentMode('driver_pays')} className="accent-sea w-4 h-4" />
            <span className="font-semibold flex-1">لأ، المندوب يدفع ويحصلها من العميل كاش</span>
          </label>
        </div>
        {paymentMode === 'driver_pays' && (
          <div className="mt-3">
            <label className="label">قيمة الأوردر اللي المندوب هيدفعها *</label>
            <input className="field" type="number" inputMode="decimal" value={collectAmount}
              onChange={e => setCollectAmount(e.target.value)} placeholder="مثال: 250" />
          </div>
        )}
      </div>

      <div className="mb-5">
        <label className="label">تفاصيل الأوردر (رقمه، أي حاجة تفيد المندوب)</label>
        <textarea className="field min-h-[70px]" value={orderNotes} onChange={e => setOrderNotes(e.target.value)}
          placeholder="مثال: أوردر رقم 1234" />
      </div>

      <div className="card p-4 mb-5 space-y-3.5">
        <h2 className="font-bold">عنوان العميل</h2>
        <div><label className="label">اسم العميل *</label>
          <input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="الاسم بالكامل" /></div>
        <div><label className="label">رقم موبايل العميل *</label>
          <input className="field" dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01xxxxxxxxx" /></div>
        <div><label className="label">المكان *</label>
          <select className="field" value={compoundId ?? ''} onChange={e => setCompoundId(Number(e.target.value) || null)}>
            <option value="">اختر المكان…</option>
            {compounds.map(c => <option key={c.id} value={c.id}>{c.name} (~{c.est_travel_minutes} د)</option>)}
          </select></div>
        <div><label className="label">رقم الشاليه / الفيلا *</label>
          <input className="field" value={unit} onChange={e => setUnit(e.target.value)} placeholder="مثال: B4 - 204" /></div>
        <div><label className="label">علامة مميزة (اختياري)</label>
          <input className="field" value={addrNotes} onChange={e => setAddrNotes(e.target.value)} placeholder="مثال: بجوار حمام السباحة" /></div>
      </div>

      {deliveryFee > 0 && (
        <div className="card p-4 mb-5 space-y-2">
          <div className="flex justify-between text-sm"><span>رسوم التوصيل{selectedCompound ? ` (${selectedCompound.distance_km} كم)` : ''}</span><span>{deliveryFee} ج.م</span></div>
          {paymentMode === 'driver_pays' && (
            <div className="flex justify-between text-sm"><span>قيمة الأوردر (كاش للمندوب)</span><span>{amount || 0} ج.م</span></div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">{error}</p>}

      <button className="btn-sea w-full !py-3.5 mb-6" disabled={!valid || saving} onClick={submit}>
        {saving ? 'جاري الإرسال…' : 'اطلب مندوب الآن'}
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
                <span className="text-xs font-semibold text-mist">{o.status}</span>
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
  const [items, setItems] = useState<Record<number, OrderItem[]>>({})
  const [isOpen, setIsOpen] = useState(true)
  const [name, setName] = useState('')
  const [declining, setDeclining] = useState<Order | null>(null)
  const audioUnlocked = useRef(false)

  async function load() {
    if (!rid) return
    const { data: r } = await supabase.from('restaurants').select('name, is_open').eq('id', rid).single()
    if (r) { setIsOpen(r.is_open); setName(r.name) }
    const { data: o } = await supabase.from('orders').select('*')
      .eq('restaurant_id', rid).not('status', 'in', '("Delivered","Cancelled","Failed_Delivery")')
      .order('id', { ascending: false }).limit(30)
    setOrders(o ?? [])

    const hasNew = (o ?? []).some(x => (x.kitchen_status || 'new') === 'new')
    if (hasNew) startRinging(); else stopRinging()

    if (o?.length) {
      const { data: its } = await supabase.from('order_items').select('*')
        .in('order_id', o.map(x => x.id))
      const grouped: Record<number, OrderItem[]> = {}
      for (const it of its ?? []) (grouped[it.order_id] ??= []).push(it)
      setItems(grouped)
    }
  }

  useEffect(() => {
    const unlock = () => { audioUnlocked.current = true; document.removeEventListener('touchstart', unlock); document.removeEventListener('click', unlock) }
    document.addEventListener('touchstart', unlock, { once: true })
    document.addEventListener('click', unlock, { once: true })
    load()
    const t = setInterval(load, 8000)
    return () => { clearInterval(t); stopRinging() }
  }, [rid])

  async function advance(o: Order, next: string) {
    if (next === 'ready') {
      await supabase.rpc('vendor_ready', { p_order_id: o.id })
    } else if (next === 'preparing') {
      await supabase.rpc('vendor_accept_order', { p_order_id: o.id })
    } else {
      await supabase.from('orders').update({ kitchen_status: next }).eq('id', o.id)
    }
    load()
  }

  async function delay(o: Order) {
    await supabase.rpc('vendor_delay', { p_order_id: o.id, p_minutes: 10 })
    load()
  }

  async function decline() {
    if (!declining) return
    await supabase.rpc('cancel_order', { p_order_id: declining.id, p_reason: 'vendor_declined' })
    setDeclining(null); load()
  }

  function remaining(o: Order) {
    if (!o.ready_at) return null
    return Math.round((+new Date(o.ready_at) - Date.now()) / 60000)
  }

  const newOrders = orders.filter(o => (o.kitchen_status || 'new') === 'new')
  const active = orders.filter(o => (o.kitchen_status || 'new') === 'preparing')
  const ready = orders.filter(o => o.kitchen_status === 'ready')

  const card = (o: Order, big = false) => {
    const stage = KITCHEN.find(k => k.key === (o.kitchen_status || 'new'))!
    return (
      <div key={o.id} className={`card p-4 ${big ? 'border-sand ring-2 ring-sand/50' : ''}`}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-bold text-lg">طلب #{o.id}</h2>
            <p className="text-sm text-mist mt-0.5">{o.zone} — وحدة {o.unit_number}</p>
          </div>
          <div className="text-left">
            <span className="font-bold text-sea block text-lg">{o.subtotal} ج.م</span>
            <span className="text-xs text-mist">{stage.label}</span>
          </div>
        </div>

        <div className="mt-3 bg-night border border-line rounded-xl p-3.5 text-sm space-y-1">
          {(items[o.id] ?? []).map(it => (
            <div key={it.id} className="flex justify-between">
              <span>{it.name} × {it.qty}{it.requires_prescription ? ' 💊' : ''}</span>
              <span className="text-mist">{it.total} ج.م</span>
            </div>
          ))}
        </div>

        {(items[o.id] ?? []).some(it => it.requires_prescription) && (
          <p className="text-sand text-sm mt-2">💊 الطلب فيه صنف يحتاج روشتة — أكّد مع العميل قبل التجهيز</p>
        )}

        {remaining(o) !== null && o.kitchen_status !== 'ready' && (
          <p className={`text-sm mt-2 ${remaining(o)! < 0 ? 'text-red-600' : 'text-mist'}`}>
            {remaining(o)! < 0 ? `متأخر ${Math.abs(remaining(o)!)} دقيقة` : `المفروض يجهز خلال ${remaining(o)} دقيقة`}
          </p>
        )}

        {big ? (
          <div className="flex gap-2.5 mt-4">
            <button className="btn-sea flex-1 !text-lg !py-4" onClick={() => advance(o, stage.next!)}>
              ✅ {stage.action}
            </button>
            <button className="btn-danger !text-lg !py-4 !px-5" onClick={() => setDeclining(o)}>✗</button>
          </div>
        ) : (
          <>
            {stage.next && (
              <div className="flex gap-2.5 mt-3">
                <button className="btn-sea flex-1" onClick={() => advance(o, stage.next!)}>{stage.action}</button>
                <button className="btn-ghost" onClick={() => delay(o)}>+10 دقائق</button>
              </div>
            )}
            {!stage.next && <p className="text-emerald-700 text-center text-sm mt-3">✅ في انتظار المندوب</p>}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold">🍽️ {name}</h1>
        <span className={isOpen ? 'badge-open' : 'badge-closed'}>{isOpen ? 'مفتوح' : 'مغلق'}</span>
      </div>

      {orders.length === 0 && <div className="card p-6 text-center text-mist">لا توجد طلبات حالياً</div>}

      {newOrders.length > 0 && (
        <div className="mb-6 space-y-4">
          <p className="text-sand font-bold animate-pulse">🔔 طلب جديد — {newOrders.length}</p>
          {newOrders.map(o => card(o, true))}
        </div>
      )}

      <div className="space-y-4">{active.map(o => card(o))}</div>

      {ready.length > 0 && (
        <>
          <h2 className="font-bold text-mist mt-6 mb-3">جاهز للاستلام</h2>
          <div className="space-y-4">{ready.map(o => card(o))}</div>
        </>
      )}

      {declining && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => setDeclining(null)}>
          <div className="card w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-2">رفض الطلب #{declining.id}</h3>
            <p className="text-sm text-mist mb-4">هيتم إلغاء الطلب وإخطار العميل. متاح فقط قبل بدء التحضير.</p>
            <div className="flex gap-3">
              <button className="btn-ghost flex-1" onClick={() => setDeclining(null)}>تراجع</button>
              <button className="btn-danger flex-1" onClick={decline}>تأكيد الرفض</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
