import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, DELIVERY_FEE } from '../lib/supabase'
import type { Compound, MenuItem, Restaurant, Slot } from '../lib/types'

export default function RestaurantDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [items, setItems] = useState<MenuItem[]>([])
  const [cart, setCart] = useState<Record<number, number>>({})
  const [checkout, setCheckout] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState(''); const [phone, setPhone] = useState('')
  const [unit, setUnit] = useState('')
  const [notes, setNotes] = useState('')
  const [compounds, setCompounds] = useState<Compound[]>([])
  const [compoundId, setCompoundId] = useState<number | null>(() => {
    const saved = sessionStorage.getItem('talah_compound_id')
    return saved ? Number(saved) : null
  })
  const [slots, setSlots] = useState<Slot[]>([])
  const [slot, setSlot] = useState<Slot | null>(null)

  useEffect(() => {
    supabase.from('restaurants').select('*').eq('id', id).single().then(({ data }) => setRestaurant(data))
    supabase.from('menu_items').select('*').eq('restaurant_id', id).eq('available', true).then(({ data }) => setItems(data ?? []))
    supabase.from('compounds').select('*').eq('active', true).order('direction').order('distance_km')
      .then(({ data }) => setCompounds(data ?? []))
    supabase.rpc('open_slots', { p_restaurant_id: Number(id) })
      .then(({ data }) => setSlots((data as Slot[]) ?? []))
  }, [id])

  const grouped = useMemo(() => {
    const g: Record<string, MenuItem[]> = {}
    for (const it of items) (g[it.category] ??= []).push(it)
    return g
  }, [items])

  const count = Object.values(cart).reduce((a, b) => a + b, 0)
  const hasRx = items.filter(it => cart[it.id]).some(it => it.requires_prescription)
  const subtotal = items.reduce((s, it) => s + (cart[it.id] ?? 0) * it.price, 0)
  const scheduled = restaurant?.vendor_type === 'supermarket'
  const selectedCompound = compounds.find(c => c.id === compoundId)
  const totalEta = restaurant && selectedCompound ? restaurant.prep_minutes + selectedCompound.est_travel_minutes : null
  const valid = name.trim() && phone.trim() && compoundId && unit.trim() && (!scheduled || !!slot)

  function add(itemId: number, delta: number) {
    setCart(c => {
      const q = Math.max(0, (c[itemId] ?? 0) + delta)
      const next = { ...c, [itemId]: q }
      if (q === 0) delete next[itemId]
      return next
    })
  }

  async function placeOrder() {
    if (!restaurant || !valid) return
    setSaving(true)
    const payload = items.filter(it => cart[it.id]).map(it => ({
      menu_item_id: it.id, name: it.name, qty: cart[it.id], unit_price: it.price
    }))
    const { data, error } = await supabase.rpc('place_order', {
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
    if (error || !data?.token) {
      setSaving(false)
      alert(
        error?.message.includes('slot_full') ? 'الفترة دي اتملت، اختار فترة تانية'
        : error?.message.includes('restaurant_closed') ? 'المطعم قفل قبل ما تأكد الطلب، جرب تاني بعدين'
        : error?.message.includes('vendor_not_covering_compound') ? 'المطعم ده مش بيوصل لمنطقتك للأسف'
        : 'حصل خطأ، جرب تاني'
      )
      return
    }
    nav(`/track/${data.token}`)
  }

  if (!restaurant) return <p className="text-mist">جاري التحميل…</p>

  return (
    <div>
      <Link to="/" className="text-sm text-mist hover:text-foam">← العودة للمطاعم</Link>
      <div className="mt-3 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{restaurant.name}</h1>
          <span className={restaurant.is_open ? 'badge-open' : 'badge-closed'}>{restaurant.is_open ? 'مفتوح' : 'مغلق'}</span>
        </div>
        <p className="text-mist mt-1.5">{restaurant.description}</p>
        <div className="flex items-center gap-3 mt-2 text-sm text-mist">
          <span className="text-sand">★ {restaurant.rating}</span>
          <span>⏱ {restaurant.vendor_type === 'supermarket'
            ? 'توصيل بفترات محددة'
            : totalEta ? `يوصلك خلال ${totalEta} دقيقة تقريبًا` : `التحضير حوالي ${restaurant.prep_minutes} دقيقة`}</span>
        </div>
      </div>

      {Object.entries(grouped).map(([cat, list]) => (
        <section key={cat} className="mb-6">
          <h2 className="font-bold text-mist mb-3">{cat}</h2>
          <div className="space-y-3">
            {list.map(it => (
              <div key={it.id} className="card p-4 flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-semibold">{it.name}</h3>
                  <p className="text-sm text-mist mt-0.5">{it.description}</p>
                  <p className="text-sea font-bold mt-1.5">{it.price} ج.م{it.requires_prescription ? ' · 💊 يحتاج روشتة' : ''}</p>
                </div>
                {cart[it.id] ? (
                  <div className="flex items-center gap-2.5">
                    <button className="btn-ghost !px-3" onClick={() => add(it.id, 1)}>+</button>
                    <span className="font-bold w-5 text-center">{cart[it.id]}</span>
                    <button className="btn-ghost !px-3" onClick={() => add(it.id, -1)}>−</button>
                  </div>
                ) : (
                  <button className="btn-sea shrink-0" onClick={() => add(it.id, 1)} disabled={!restaurant.is_open}>إضافة</button>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {count > 0 && (
        <div className="fixed bottom-20 inset-x-4 z-40 max-w-5xl mx-auto">
          <button className="btn-sea w-full !py-3.5 shadow-lg shadow-sea/20" onClick={() => setCheckout(true)}>
            طلب ({count}) · {subtotal} ج.م
          </button>
        </div>
      )}

      {checkout && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => setCheckout(false)}>
          <div className="card w-full max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-1">تأكيد الطلب</h3>
            <p className="text-sm text-mist mb-4">الدفع كاش عند الاستلام + {DELIVERY_FEE} ج.م توصيل</p>
            {hasRx && (
              <p className="text-sand text-sm mb-4 bg-sand/10 rounded-xl p-3">
                💊 في صنف محتاج روشتة طبية — الصيدلية هتتواصل معاك تليفونيًا للتأكيد قبل التجهيز
              </p>
            )}

            <div className="space-y-2 mb-4">
              {items.filter(it => cart[it.id]).map(it => (
                <div key={it.id} className="flex justify-between text-sm">
                  <span>{it.name} × {cart[it.id]}</span><span>{cart[it.id] * it.price} ج.م</span>
                </div>
              ))}
              <div className="flex justify-between text-sm text-mist"><span>التوصيل</span><span>{DELIVERY_FEE} ج.م</span></div>
              <div className="flex justify-between font-bold border-t border-line pt-2"><span>الإجمالي</span><span className="text-sea">{subtotal + DELIVERY_FEE} ج.م</span></div>
            </div>

            <div className="space-y-3.5">
              {scheduled && (
                <div>
                  <label className="label">فترة التوصيل *</label>
                  {slots.length === 0 && (
                    <p className="text-sm text-sand">لا توجد فترات متاحة حالياً</p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {slots.map(sl => {
                      const on = slot?.id === sl.id && slot?.scheduled_date === sl.scheduled_date
                      const today = sl.scheduled_date === new Date().toISOString().slice(0, 10)
                      return (
                        <button key={`${sl.id}-${sl.scheduled_date}`}
                          className={`card p-3 text-right ${on ? 'border-sea' : ''}`}
                          onClick={() => setSlot(sl)}>
                          <p className="text-sm font-semibold">
                            {sl.start_time.slice(0,5)} — {sl.end_time.slice(0,5)}
                          </p>
                          <p className="text-xs text-mist mt-0.5">
                            {today ? 'النهاردة' : 'بكرة'} · باقي {sl.remaining}
                          </p>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
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

            <div className="flex gap-3 mt-5">
              <button className="btn-ghost flex-1" onClick={() => setCheckout(false)}>إلغاء</button>
              <button className="btn-sea flex-1" disabled={!valid || saving} onClick={placeOrder}>
                {saving ? 'جاري الإرسال…' : 'تأكيد الطلب'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
