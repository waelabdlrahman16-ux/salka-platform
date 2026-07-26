import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, DELIVERY_FEE } from '../lib/supabase'
import { useCart } from '../lib/cart'
import type { Compound, MenuItem, Restaurant, Slot } from '../lib/types'

export default function CheckoutPage() {
  const nav = useNavigate()
  const cart = useCart()
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [items, setItems] = useState<MenuItem[]>([])
  const [compounds, setCompounds] = useState<Compound[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [slot, setSlot] = useState<Slot | null>(null)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [unit, setUnit] = useState('')
  const [notes, setNotes] = useState('')
  const [compoundId, setCompoundId] = useState<number | null>(() => {
    const saved = sessionStorage.getItem('talah_compound_id')
    return saved ? Number(saved) : null
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!cart.restaurantId) return
    supabase.from('restaurants').select('*').eq('id', cart.restaurantId).single().then(({ data }) => setRestaurant(data))
    supabase.from('menu_items').select('*').eq('restaurant_id', cart.restaurantId).then(({ data }) => setItems(data ?? []))
    supabase.from('compounds').select('*').eq('active', true).order('direction').order('distance_km')
      .then(({ data }) => setCompounds(data ?? []))
    supabase.rpc('open_slots', { p_restaurant_id: cart.restaurantId }).then(({ data }) => setSlots((data as Slot[]) ?? []))
  }, [cart.restaurantId])

  const lines = useMemo(() => items.filter(it => cart.qty[it.id]), [items, cart.qty])
  const subtotal = lines.reduce((s, it) => s + it.price * cart.qty[it.id], 0)
  const scheduled = restaurant?.vendor_type === 'supermarket'
  const hasRx = lines.some(it => it.requires_prescription)
  const selectedCompound = compounds.find(c => c.id === compoundId)
  const valid = name.trim() && phone.trim() && compoundId && unit.trim() && (!scheduled || !!slot)

  async function placeOrder() {
    if (!restaurant || !valid) return
    setSaving(true)
    setError('')
    const payload = lines.map(it => ({ menu_item_id: it.id, name: it.name, qty: cart.qty[it.id], unit_price: it.price }))
    const { data, error: err } = await supabase.rpc('place_order', {
      p_restaurant_id: restaurant.id,
      p_customer_name: name.trim(),
      p_customer_phone: phone.trim(),
      p_zone: selectedCompound?.name ?? '',
      p_unit_number: unit.trim(),
      p_address_notes: notes.trim(),
      p_delivery_fee: DELIVERY_FEE,
      p_items: payload,
      p_slot_id: slot?.id ?? null,
      p_scheduled_date: slot?.scheduled_date ?? null,
      p_compound_id: compoundId
    })
    if (err || !data?.token) {
      setSaving(false)
      setError(
        err?.message.includes('slot_full') ? 'الفترة دي اتملت، اختار فترة تانية'
        : err?.message.includes('restaurant_closed') ? 'المطعم قفل قبل ما تأكد الطلب، جرب تاني بعدين'
        : err?.message.includes('vendor_not_covering_compound') ? 'المطعم ده مش بيوصل لمنطقتك للأسف'
        : 'حصل خطأ، جرب تاني'
      )
      return
    }
    cart.clear()
    nav(`/track/${data.token}`)
  }

  if (!cart.restaurantId || lines.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="font-bold text-lg mb-1">مفيش حاجة في العربة</p>
        <button className="btn-sea mt-4" onClick={() => nav('/')}>تصفح المطاعم</button>
      </div>
    )
  }

  return (
    <div className="pb-6">
      <h1 className="text-2xl font-bold mb-5">تأكيد الطلب</h1>

      {hasRx && (
        <p className="text-sand text-sm mb-5 bg-sand/10 rounded-xl p-3">
          💊 في صنف محتاج روشتة طبية — الصيدلية هتتواصل معاك تليفونيًا للتأكيد قبل التجهيز
        </p>
      )}

      {scheduled && (
        <div className="mb-5">
          <h2 className="font-bold mb-2">فترة التوصيل</h2>
          {slots.length === 0 && <p className="text-sm text-sand">لا توجد فترات متاحة حالياً</p>}
          <div className="grid grid-cols-2 gap-2">
            {slots.map(sl => {
              const on = slot?.id === sl.id && slot?.scheduled_date === sl.scheduled_date
              const today = sl.scheduled_date === new Date().toISOString().slice(0, 10)
              return (
                <button key={`${sl.id}-${sl.scheduled_date}`} className={`card p-3 text-right ${on ? 'border-sea' : ''}`} onClick={() => setSlot(sl)}>
                  <p className="text-sm font-semibold">{sl.start_time.slice(0, 5)} — {sl.end_time.slice(0, 5)}</p>
                  <p className="text-xs text-mist mt-0.5">{today ? 'النهاردة' : 'بكرة'} · باقي {sl.remaining}</p>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="card p-4 mb-5 space-y-3.5">
        <h2 className="font-bold">عنوان التوصيل</h2>
        <div><label className="label">الاسم *</label>
          <input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="الاسم بالكامل" /></div>
        <div><label className="label">رقم الموبايل *</label>
          <input className="field" dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01xxxxxxxxx" /></div>
        <div><label className="label">المكان *</label>
          <select className="field" value={compoundId ?? ''} onChange={e => setCompoundId(Number(e.target.value) || null)}>
            <option value="">اختر مكانك…</option>
            {compounds.map(c => <option key={c.id} value={c.id}>{c.name} (~{c.est_travel_minutes} د)</option>)}
          </select></div>
        <div><label className="label">رقم الشاليه / الفيلا *</label>
          <input className="field" value={unit} onChange={e => setUnit(e.target.value)} placeholder="مثال: B4 - 204" /></div>
        <div><label className="label">علامة مميزة (اختياري)</label>
          <input className="field" value={notes} onChange={e => setNotes(e.target.value)} placeholder="مثال: بجوار حمام السباحة" /></div>
      </div>

      <div className="card p-4 mb-5">
        <h2 className="font-bold mb-3">الدفع</h2>
        <div className="space-y-2.5">
          <label className="flex items-center gap-3 rounded-xl border-2 border-sea bg-sea/5 px-3.5 py-3 cursor-pointer">
            <input type="radio" checked readOnly className="accent-sea w-4 h-4" />
            <span className="text-xl">💵</span>
            <span className="font-semibold flex-1">كاش عند الاستلام</span>
          </label>
          <div className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-3 opacity-50">
            <input type="radio" disabled className="w-4 h-4" />
            <span className="text-xl">💳</span>
            <span className="font-semibold flex-1">فوترة أونلاين</span>
            <span className="text-xs text-mist">قريباً</span>
          </div>
        </div>
      </div>

      <div className="card p-4 mb-6 space-y-2">
        <h2 className="font-bold mb-1">ملخص الطلب</h2>
        {lines.map(it => (
          <div key={it.id} className="flex justify-between text-sm">
            <span>{it.name} × {cart.qty[it.id]}</span><span>{cart.qty[it.id] * it.price} ج.م</span>
          </div>
        ))}
        <div className="flex justify-between text-sm text-mist"><span>التوصيل</span><span>{DELIVERY_FEE} ج.م</span></div>
        <div className="flex justify-between font-bold border-t border-line pt-2"><span>الإجمالي</span><span className="text-sea">{subtotal + DELIVERY_FEE} ج.م</span></div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">{error}</p>}

      <button className="btn-sea w-full !py-3.5" disabled={!valid || saving} onClick={placeOrder}>
        {saving ? 'جاري الإرسال…' : `تأكيد الطلب · ${subtotal + DELIVERY_FEE} ج.م`}
      </button>
    </div>
  )
}
