import { useEffect, useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isValidEgyptPhone, PHONE_HINT } from '../lib/validation'
import { useCart } from '../lib/cart'
import { estimateDeliveryFee } from '../lib/deliveryFee'
import { useCustomerAuth, getSessionToken } from '../lib/customerAuth'
import { isItemAvailableNow } from '../lib/itemAvailability'
import { applyDiscount, effectiveDiscount } from '../lib/discounts'
import type { Compound, Discount, MenuItem, MenuItemAddon, MenuItemSize, Restaurant, Slot } from '../lib/types'

export default function CheckoutPage() {
  const nav = useNavigate()
  const cart = useCart()
  const { customer } = useCustomerAuth()
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [items, setItems] = useState<MenuItem[]>([])
  const [sizes, setSizes] = useState<MenuItemSize[]>([])
  const [addons, setAddons] = useState<MenuItemAddon[]>([])
  const [discounts, setDiscounts] = useState<Discount[]>([])
  const [compounds, setCompounds] = useState<Compound[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [slot, setSlot] = useState<Slot | null>(null)

  const [name, setName] = useState(() => customer?.name ?? '')
  const [phone, setPhone] = useState(() => customer?.phone ?? localStorage.getItem('salka_phone') ?? '')
  const [unit, setUnit] = useState('')
  const [notes, setNotes] = useState('')
  const [customerNote, setCustomerNote] = useState('')
  const [compoundId, setCompoundId] = useState<number | null>(() => {
    const saved = sessionStorage.getItem('salka_compound_id')
    return saved ? Number(saved) : null
  })
  const [showLandmark, setShowLandmark] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'instapay'>('cod')
  const [addressLoaded, setAddressLoaded] = useState(false)
  const [walletBalance, setWalletBalance] = useState(0)
  const [useWallet, setUseWallet] = useState(true)

  useEffect(() => {
    if (!isValidEgyptPhone(phone)) { setWalletBalance(0); return }
    supabase.rpc('wallet_balance_for_phone', { p_phone: phone.trim(), p_session_token: getSessionToken() })
      .then(({ data }) => setWalletBalance(Number(data) || 0))
  }, [phone])

  useEffect(() => {
    if (!isValidEgyptPhone(phone) || addressLoaded) return
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('last_address_for_phone', { p_phone: phone, p_session_token: getSessionToken() })
      if (data) {
        setAddressLoaded(true)
        if (!name.trim() && data.customer_name) setName(data.customer_name)
        if (!unit.trim() && data.unit_number) setUnit(data.unit_number)
        if (!notes.trim() && data.address_notes) setNotes(data.address_notes)
        if (!compoundId && data.compound_id) setCompoundId(data.compound_id)
      }
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone])

  useEffect(() => {
    if (!cart.restaurantId) return
    supabase.from('restaurants').select('*').eq('id', cart.restaurantId).single().then(({ data }) => setRestaurant(data))
    supabase.from('menu_items').select('*').eq('restaurant_id', cart.restaurantId).then(({ data }) => setItems(data ?? []))
    supabase.from('compounds').select('*').eq('active', true).order('direction').order('distance_km')
      .then(({ data }) => setCompounds(data ?? []))
    supabase.rpc('open_slots', { p_restaurant_id: cart.restaurantId }).then(({ data }) => setSlots((data as Slot[]) ?? []))
    supabase.from('discounts').select('*').eq('restaurant_id', cart.restaurantId).eq('active', true)
      .then(({ data }) => setDiscounts(data ?? []))
    ;(async () => {
      const ids = (await supabase.from('menu_items').select('id').eq('restaurant_id', cart.restaurantId)).data?.map(x => x.id) ?? []
      if (!ids.length) return
      const { data: sz } = await supabase.from('menu_item_sizes').select('*').in('menu_item_id', ids).eq('available', true)
      setSizes(sz ?? [])
      const { data: gr } = await supabase.from('menu_item_addon_groups').select('id').in('menu_item_id', ids)
      const groupIds = (gr ?? []).map(g => g.id)
      if (groupIds.length) {
        const { data: ad } = await supabase.from('menu_item_addons').select('*').in('group_id', groupIds).eq('available', true)
        setAddons(ad ?? [])
      }
    })()
  }, [cart.restaurantId])

  const [removedNotice, setRemovedNotice] = useState('')

  useEffect(() => {
    if (!items.length) return
    const stale = cart.lines.filter(l => {
      const item = items.find(i => i.id === l.menuItemId)
      return !item || !item.available || !isItemAvailableNow(item.available_from, item.available_until)
    })
    if (stale.length > 0) {
      setRemovedNotice(stale.length === 1 ? 'شلنا صنف من عربتك لأنه بقى مش متاح دلوقتي' : `شلنا ${stale.length} أصناف من عربتك لأنها بقت مش متاحة دلوقتي`)
      for (const l of stale) cart.removeLine(l.key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  function priceFor(menuItemId: number, sizeId: number | null, addonIds: number[]) {
    const item = items.find(i => i.id === menuItemId)
    const size = sizeId ? sizes.find(s => s.id === sizeId) : null
    const base = size ? size.price : (item?.price ?? 0)
    const discount = item ? effectiveDiscount(item.id, item.category, discounts) : null
    const discountedBase = applyDiscount(base, discount)
    const selectedAddons = addonIds.map(id => addons.find(a => a.id === id)).filter((a): a is MenuItemAddon => !!a)
    const addonsTotal = selectedAddons.reduce((s, a) => s + a.price, 0)
    return {
      unit: discountedBase + addonsTotal, original: discount ? base + addonsTotal : null,
      item, sizeName: size?.name ?? null, addonNames: selectedAddons.map(a => a.name)
    }
  }

  const lines = useMemo(() => cart.lines.filter(l => items.some(i => i.id === l.menuItemId)), [items, cart.lines])
  const subtotal = lines.reduce((s, l) => s + priceFor(l.menuItemId, l.sizeId, l.addonIds).unit * l.qty, 0)
  const scheduled = restaurant?.vendor_type === 'supermarket'
  const hasRx = lines.some(l => priceFor(l.menuItemId, l.sizeId, l.addonIds).item?.requires_prescription)
  const selectedCompound = compounds.find(c => c.id === compoundId)
  const deliveryFee = selectedCompound ? estimateDeliveryFee(selectedCompound.distance_km) : 0
  const serviceFee = Math.round(subtotal * 0.02)
  const preWalletTotal = subtotal + deliveryFee + serviceFee
  const walletApplied = useWallet ? Math.min(walletBalance, preWalletTotal) : 0
  const finalTotal = preWalletTotal - walletApplied
  const valid = name.trim() && isValidEgyptPhone(phone) && compoundId && unit.trim() && (!scheduled || !!slot)

  const isInstapay = paymentMethod === 'instapay'

  async function placeOrder() {
    if (!restaurant || !valid) return
    setSaving(true)
    setError('')
    const payload = lines.map(l => ({ menu_item_id: l.menuItemId, qty: l.qty, size_id: l.sizeId, addon_ids: l.addonIds }))
    const { data, error: err } = await supabase.rpc('place_order', {
      p_restaurant_id: restaurant.id,
      p_customer_name: name.trim(),
      p_customer_phone: phone.trim(),
      p_zone: selectedCompound?.name ?? '',
      p_unit_number: unit.trim(),
      p_address_notes: notes.trim(),
      p_delivery_fee: deliveryFee,
      p_items: payload,
      p_slot_id: slot?.id ?? null,
      p_scheduled_date: slot?.scheduled_date ?? null,
      p_compound_id: compoundId,
      p_payment_method: isInstapay ? 'instapay' : 'cod',
      p_use_wallet: walletBalance > 0 && useWallet,
      p_session_token: getSessionToken(),
      p_customer_note: customerNote.trim() || null
    })
    if (err || !data?.token) {
      setSaving(false)
      setError(
        err?.message.includes('slot_full') ? 'الفترة دي اتملت، اختار فترة تانية'
        : err?.message.includes('restaurant_closed') ? 'المطعم قفل قبل ما تأكد الطلب، جرب تاني بعدين'
        : err?.message.includes('vendor_not_covering_compound') ? 'المطعم ده مش بيوصل لمنطقتك للأسف'
        : err?.message.includes('item_not_available_now') ? 'في صنف في عربتك مش متاح دلوقتي (وقت محدود)، شيله وجرب تاني'
        : err?.message.includes('item_unavailable') ? 'في صنف في عربتك خلص، شيله وجرب تاني'
        : err?.message.includes('size_required') || err?.message.includes('invalid_size') ? 'اختار حجم الصنف قبل ما تكمل'
        : err?.message.includes('addon_group_min_not_met') ? 'في اختيار مطلوب لصنف في عربتك لسه ما اتحددش'
        : err?.message.includes('addon_group_max_exceeded') ? 'اخترت إضافات أكتر من المسموح لصنف في عربتك'
        : 'حصل خطأ، جرب تاني'
      )
      return
    }

    localStorage.setItem('salka_phone', phone.trim())

    cart.clear()
    nav(`/track/${data.token}`)
  }

  if (!cart.restaurantId || lines.length === 0) {
    return (
      <div className="text-center py-16">
        {removedNotice && <p className="text-sand text-sm mb-4 bg-sand/10 rounded-xl p-3 mx-4">{removedNotice}</p>}
        <p className="font-bold text-lg mb-1">مفيش حاجة في العربة</p>
        <button className="btn-sea mt-4" onClick={() => nav('/')}>تصفح المطاعم</button>
      </div>
    )
  }

  return (
    <div className="pb-6">
      <h1 className="text-2xl font-bold mb-4">تأكيد الطلب</h1>

      {removedNotice && (
        <p className="text-sand text-sm mb-4 bg-sand/10 rounded-xl p-3">{removedNotice}</p>
      )}

      {hasRx && (
        <p className="text-sand text-sm mb-4 bg-sand/10 rounded-xl p-3">
          💊 في صنف محتاج روشتة طبية — الصيدلية هتتواصل معاك تليفونيًا للتأكيد قبل التجهيز
        </p>
      )}

      {scheduled && (
        <div className="mb-4">
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

      <div className="card p-4 mb-4 space-y-3">
        <h2 className="font-bold">عنوان التوصيل</h2>
        <div><label className="label">الاسم *</label>
          <input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="الاسم بالكامل" /></div>
        <div><label className="label">رقم الموبايل *</label>
          <input className={`field ${phone.trim() && !isValidEgyptPhone(phone) ? '!border-red-400' : ''}`}
            dir="ltr" value={phone} onChange={e => setPhone(e.target.value)}
            placeholder="01xxxxxxxxx" maxLength={13} />
          {phone.trim() && !isValidEgyptPhone(phone) && (
            <p className="text-xs text-red-600 mt-1">{PHONE_HINT}</p>
          )}</div>
        <div><label className="label">المكان *</label>
          <select className="field" value={compoundId ?? ''} onChange={e => setCompoundId(Number(e.target.value) || null)}>
            <option value="">اختر مكانك…</option>
            {compounds.map(c => <option key={c.id} value={c.id}>{c.name} (~{c.est_travel_minutes} د)</option>)}
          </select></div>
        <div><label className="label">رقم الشاليه / الفيلا *</label>
          <input className="field" value={unit} onChange={e => setUnit(e.target.value)} placeholder="مثال: B4 - 204" /></div>
        {showLandmark || notes.trim() ? (
          <div><label className="label">علامة مميزة (اختياري)</label>
            <input className="field" value={notes} onChange={e => setNotes(e.target.value)} placeholder="مثال: بجوار حمام السباحة" autoFocus /></div>
        ) : (
          <button type="button" className="text-sea text-sm font-semibold" onClick={() => setShowLandmark(true)}>
            + إضافة علامة مميزة (اختياري)
          </button>
        )}
        <div><label className="label">ملاحظات على الطلب (اختياري)</label>
          <textarea className="field" rows={2} value={customerNote} onChange={e => setCustomerNote(e.target.value)}
            placeholder="مثال: من غير بصل، اتصل قبل ما توصل" /></div>
      </div>

      {walletBalance > 0 && (
        <div className="card p-4 mb-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" className="accent-sea w-4 h-4" checked={useWallet} onChange={e => setUseWallet(e.target.checked)} />
            <span className="text-xl">👛</span>
            <span className="flex-1">
              <span className="font-semibold block">استخدم رصيدك</span>
              <span className="text-xs text-mist">عندك {walletBalance} ج.م في محفظتك</span>
            </span>
          </label>
        </div>
      )}

      <div className="card p-4 mb-4">
        <h2 className="font-bold mb-3">الدفع</h2>
        <div className="space-y-2.5">
          <label className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-3 cursor-pointer ${paymentMethod === 'cod' ? 'border-sea bg-sea/5' : 'border-line'}`}>
            <span className="font-semibold flex-1">كاش عند الاستلام</span>
            <input type="radio" checked={paymentMethod === 'cod'} onChange={() => setPaymentMethod('cod')} className="accent-sea w-4 h-4" />
          </label>
          <label className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-3 cursor-pointer ${paymentMethod === 'instapay' ? 'border-sea bg-sea/5' : 'border-line'}`}>
            <span className="font-semibold flex-1">InstaPay</span>
            <input type="radio" checked={paymentMethod === 'instapay'} onChange={() => setPaymentMethod('instapay')} className="accent-sea w-4 h-4" />
          </label>
        </div>
      </div>

      <div className="card p-4 mb-5 space-y-2">
        <h2 className="font-bold mb-1">ملخص الطلب</h2>
        {lines.map(l => {
          const { unit, original, item, sizeName, addonNames } = priceFor(l.menuItemId, l.sizeId, l.addonIds)
          return (
            <div key={l.key} className="flex justify-between text-sm">
              <span>
                {item?.name} × {l.qty}
                {(sizeName || addonNames.length > 0) && (
                  <span className="text-mist"> ({[sizeName, ...addonNames].filter(Boolean).join(' · ')})</span>
                )}
              </span>
              <span>
                {original != null && <span className="text-mist line-through ml-1.5">{l.qty * original}</span>}
                {l.qty * unit} ج.م
              </span>
            </div>
          )
        })}
        <div className="flex justify-between text-sm text-mist"><span>التوصيل{selectedCompound ? ` (${selectedCompound.distance_km} كم)` : ''}</span><span>{deliveryFee} ج.م</span></div>
        <div className="flex justify-between text-sm text-mist"><span>رسوم الخدمة</span><span>{serviceFee} ج.م</span></div>
        {walletApplied > 0 && (
          <div className="flex justify-between text-sm text-emerald-700"><span>من رصيدك</span><span>-{walletApplied} ج.م</span></div>
        )}
        <div className="flex justify-between font-bold border-t border-line pt-2"><span>الإجمالي</span><span className="text-sea">{finalTotal} ج.م</span></div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">{error}</p>}

      <button className="btn-sea w-full !py-3.5" disabled={!valid || saving} onClick={placeOrder}>
        {saving ? 'جاري التجهيز…' : `تأكيد الطلب · ${finalTotal} ج.م`}
      </button>

      <p className="text-xs text-mist text-center mt-3">
        بضغطك على "تأكيد الطلب" إنت موافق على <Link to="/terms" className="text-sea underline">الشروط والأحكام</Link>
      </p>
    </div>
  )
}
