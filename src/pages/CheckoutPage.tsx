import { useEffect, useMemo, useState, useId } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isValidEgyptPhone, PHONE_HINT } from '../lib/validation'
import { useCart } from '../lib/cart'
import { lineIsStale, priceLine } from '../lib/linePricing'
import { useDeliveryQuote } from '../lib/deliveryQuote'
import { serviceFeeFor, useServiceFeePct } from '../lib/serviceFee'
import { useCustomerAuth, getSessionToken } from '../lib/customerAuth'
import { isItemAvailableNow } from '../lib/itemAvailability'
import { applyDiscount, effectiveDiscount } from '../lib/discounts'
import LocationPreviewMap from '../components/LocationPreviewMap'
import type { Compound, Discount, MenuItem, MenuItemAddon, MenuItemCombo, MenuItemSize, Restaurant, Slot } from '../lib/types'
import { getCompoundId, setCompoundId as setStoredCompoundId } from '../lib/place'

export default function CheckoutPage() {
  const fid = useId()
  const nav = useNavigate()
  const cart = useCart()
  const { customer } = useCustomerAuth()
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [items, setItems] = useState<MenuItem[]>([])
  const [sizes, setSizes] = useState<MenuItemSize[]>([])
  const [combos, setCombos] = useState<MenuItemCombo[]>([])
  // Sizes, combos and add-ons arrive several round trips after the items do.
  // Until they land, every combo line prices at the item's base price -- which
  // is the number on the checkout button. Nothing that depends on a total is
  // trusted before this flips.
  const [optionsLoaded, setOptionsLoaded] = useState(false)
  const [addons, setAddons] = useState<MenuItemAddon[]>([])
  const [discounts, setDiscounts] = useState<Discount[]>([])
  const [compounds, setCompounds] = useState<Compound[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [slot, setSlot] = useState<Slot | null>(null)

  // These are lazy initialisers, which run exactly once, on mount. The customer
  // arrives asynchronously -- CustomerAuthProvider starts at
  // { customer: null, loading: true } and resolves a round trip later -- so on
  // first render there was nothing to read, both fields initialised to empty,
  // and nothing ever filled them in afterwards. A signed-in customer retyped
  // their name and phone on every single order while the app already knew both.
  // The effect below is what actually delivers them.
  const [name, setName] = useState(() => customer?.name ?? '')
  const [phone, setPhone] = useState(() => customer?.phone ?? localStorage.getItem('salka_phone') ?? '')

  // Fill from the account once it lands, but never overwrite something the
  // customer has already typed -- they may be ordering for someone else.
  useEffect(() => {
    if (!customer) return
    setName(prev => prev.trim() ? prev : (customer.name ?? ''))
    setPhone(prev => prev.trim() ? prev : (customer.phone ?? prev))
  }, [customer?.id, customer?.name, customer?.phone])
  const [unit, setUnit] = useState('')
  const [notes, setNotes] = useState('')
  const [customerNote, setCustomerNote] = useState('')
  const [compoundId, setCompoundId] = useState<number | null>(() => {
    const saved = getCompoundId()
    return saved ? Number(saved) : null
  })
  const [showLandmark, setShowLandmark] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'instapay'>('cod')
  const [addressLoaded, setAddressLoaded] = useState(false)
  const [addressExpanded, setAddressExpanded] = useState(false)
  const [savedAddresses, setSavedAddresses] = useState<
    { id: number; label: string; compound_id: number; compound_name: string; unit_number: string; notes: string | null; is_default: boolean }[]
  >([])
  const [walletBalance, setWalletBalance] = useState(0)
  const [walletFailed, setWalletFailed] = useState(false)
  const [compoundsFailed, setCompoundsFailed] = useState(false)
  // null until the server answers. This used to default to 300 while
  // settings.cod_deposit_threshold_egp says 1000, so for the moment between
  // first paint and the settings fetch landing, a 451 ج.م order was told it
  // needed a 208 ج.م InstaPay deposit that it does not need -- a false
  // statement about payment terms, on the checkout screen, in the second
  // someone is deciding whether to go through with it. On a *failed* fetch it
  // was not a flash at all: every order between 300 and 1000 kept the warning.
  // Same rule as the delivery fee and the service fee: never guess a
  // server-owned number.
  const [codDepositThreshold, setCodDepositThreshold] = useState<number | null>(null)
  const [codThresholdFailed, setCodThresholdFailed] = useState(false)
  const [useWallet, setUseWallet] = useState(true)

  // Saved addresses, and the default one preselected. Guarded on `customer`
  // because the RPC is account-scoped -- a guest gets an empty list, not an error.
  useEffect(() => {
    if (!customer) { setSavedAddresses([]); return }
    supabase.rpc('my_customer_addresses').then(({ data, error }) => {
      if (error) return
      const list = (data as typeof savedAddresses) ?? []
      setSavedAddresses(list)
      const preferred = list.find(a => a.is_default) ?? list[0]
      if (!preferred) return
      // Never overwrite something already chosen -- a compound restored from
      // the previous screen, or a unit the customer has started typing.
      setCompoundId(prev => prev ?? preferred.compound_id)
      setUnit(prev => prev.trim() ? prev : preferred.unit_number)
      setNotes(prev => prev.trim() ? prev : (preferred.notes ?? ''))
    })
  }, [customer?.id])

  useEffect(() => {
    if (!isValidEgyptPhone(phone)) { setWalletBalance(0); setWalletFailed(false); return }
    // A failed lookup used to be indistinguishable from an empty wallet, so the
    // customer's credit was silently not offered at checkout.
    supabase.rpc('wallet_balance_for_phone', { p_phone: phone.trim(), p_session_token: getSessionToken() })
      .then(({ data, error }) => {
        if (error) { setWalletFailed(true); setWalletBalance(0); return }
        setWalletFailed(false)
        setWalletBalance(Number(data) || 0)
      })
  }, [phone])

  useEffect(() => {
    if (!isValidEgyptPhone(phone) || addressLoaded) return
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('last_address_for_phone', { p_phone: phone, p_session_token: getSessionToken() })
      setAddressLoaded(true)
      if (data) {
        if (!name.trim() && data.customer_name) setName(data.customer_name)
        if (!unit.trim() && data.unit_number) setUnit(data.unit_number)
        if (!notes.trim() && data.address_notes) setNotes(data.address_notes)
        if (!compoundId && data.compound_id) setCompoundId(data.compound_id)
      }
      // nothing saved to summarize yet (first-time customer) -> show the
      // full editable form right away instead of an empty collapsed hero
      if (!data?.compound_id || !data?.unit_number) setAddressExpanded(true)
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone])

  useEffect(() => {
    if (!cart.restaurantId) return
    supabase.from('restaurants').select('*').eq('id', cart.restaurantId).single().then(({ data }) => setRestaurant(data))
    supabase.from('menu_items').select('*').eq('restaurant_id', cart.restaurantId).then(({ data }) => setItems(data ?? []))
    // `valid` requires selectedCompound, so a silent failure here would leave
    // the confirm button permanently disabled with an empty place dropdown and
    // no explanation. Surface it.
    supabase.from('compounds').select('*').eq('active', true).order('direction').order('distance_km')
      .then(({ data, error }) => { setCompoundsFailed(!!error); setCompounds(data ?? []) })
    supabase.rpc('open_slots', { p_restaurant_id: cart.restaurantId }).then(({ data }) => setSlots((data as Slot[]) ?? []))
    supabase.from('discounts').select('*').eq('restaurant_id', cart.restaurantId).eq('active', true)
      .then(({ data }) => setDiscounts(data ?? []))
    // A failed read, a missing row or a value of "0" all left this null, and
    // the deposit warning is gated on it being non-null -- so the customer was
    // shown no payment terms at all, tapped 'تأكيد الطلب · 1215 ج.م' believing
    // it was cash on delivery, and landed on a full-screen InstaPay wall. The
    // old bug quoted the WRONG terms; this one quoted none. Both are the same
    // shape: a server-owned number the screen guesses at.
    supabase.from('settings').select('value').eq('key', 'cod_deposit_threshold_egp').maybeSingle()
      .then(({ data, error }) => {
        if (error || data?.value == null) { setCodThresholdFailed(true); return }
        setCodDepositThreshold(Number(data.value)); setCodThresholdFailed(false)
      })
    ;(async () => {
      const ids = (await supabase.from('menu_items').select('id').eq('restaurant_id', cart.restaurantId)).data?.map(x => x.id) ?? []
      if (!ids.length) { setOptionsLoaded(true); return }
      const { data: sz } = await supabase.from('menu_item_sizes').select('*').in('menu_item_id', ids).eq('available', true)
      setSizes(sz ?? [])
      const { data: cb } = await supabase.from('menu_item_combos').select('*').in('menu_item_id', ids).eq('available', true)
      setCombos((cb as MenuItemCombo[]) ?? [])
      const { data: gr } = await supabase.from('menu_item_addon_groups').select('id').in('menu_item_id', ids)
      const groupIds = (gr ?? []).map(g => g.id)
      if (groupIds.length) {
        const { data: ad } = await supabase.from('menu_item_addons').select('*').in('group_id', groupIds).eq('available', true)
        setAddons(ad ?? [])
      }
      setOptionsLoaded(true)
    })()
  }, [cart.restaurantId])

  const [removedNotice, setRemovedNotice] = useState('')

  useEffect(() => {
    if (!items.length || !optionsLoaded) return
    // Also catches a line whose size or combo has since been deleted -- those
    // used to survive the sweep and silently reprice to the item's base price.
    const stale = cart.lines.filter(l => lineIsStale(l, { items, sizes, combos }))
    if (stale.length > 0) {
      setRemovedNotice(stale.length === 1 ? 'شلنا صنف من عربتك لأنه بقى مش متاح دلوقتي' : `شلنا ${stale.length} أصناف من عربتك لأنها بقت مش متاحة دلوقتي`)
      for (const l of stale) cart.removeLine(l.key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, optionsLoaded])

  // One implementation, shared with the cart. See lib/linePricing.
  const priceFor = (l: { menuItemId: number; sizeId: number | null; comboId: number | null; addonIds: number[] }) =>
    priceLine(l, { items, sizes, combos, addons, discounts })

  const lines = useMemo(() => cart.lines.filter(l => items.some(i => i.id === l.menuItemId)), [items, cart.lines])
  const subtotal = lines.reduce((s, l) => s + priceFor(l).unit * l.qty, 0)
  const scheduled = restaurant?.vendor_type === 'supermarket'
  const hasRx = lines.some(l => priceFor(l).item?.requires_prescription)
  const selectedCompound = compounds.find(c => c.id === compoundId)
  // Authoritative fee from the server. null while loading or on failure -- we
  // never substitute 0 or a local estimate, because every number below it
  // (wallet applied, COD deposit threshold, the confirm button) would be wrong.
  const { fee: deliveryFee, quote, loading: feeLoading, failed: feeFailed, retry: retryFee } =
    useDeliveryQuote(compoundId)
  // Same rule as the delivery fee: settings.service_fee_percent is what
  // place_order actually charges, so it is fetched, not assumed. The old
  // hardcoded 0.02 quoted the customer one number and billed them another for
  // any setting other than 2.
  const { pct: serviceFeePct, loading: serviceFeeLoading, failed: serviceFeeFailed, retry: retryServiceFee } =
    useServiceFeePct()
  const serviceFee = serviceFeeFor(subtotal, serviceFeePct)
  const preWalletTotal = subtotal + (deliveryFee ?? 0) + (serviceFee ?? 0)
  const walletApplied = useWallet ? Math.min(walletBalance, preWalletTotal) : 0
  const finalTotal = preWalletTotal - walletApplied
  // selectedCompound, not just compoundId: a saved id that no longer matches an
  // active compound used to pass validation, submit with an empty p_zone, and
  // fail into the catch-all error.
  // optionsLoaded is in here for the same reason deliveryFee and serviceFee are:
  // confirming while the combo and size prices are still in flight would submit
  // a basket the customer was shown an understated total for.
  const valid = name.trim() && isValidEgyptPhone(phone) && !!selectedCompound && unit.trim()
    && deliveryFee !== null && serviceFee !== null && optionsLoaded && (!scheduled || !!slot)
    && !(paymentMethod === 'cod' && codThresholdFailed)

  // Changing the place here never wrote back, so the cart and home stayed priced
  // for the previous compound.
  useEffect(() => {
    if (compoundId) setStoredCompoundId(compoundId)
  }, [compoundId])

  const isInstapay = paymentMethod === 'instapay'

  async function placeOrder() {
    if (!restaurant || !valid) return
    setSaving(true)
    setError('')
    const payload = lines.map(l => ({ menu_item_id: l.menuItemId, qty: l.qty, size_id: l.sizeId, combo_id: l.comboId, addon_ids: l.addonIds }))
    const { data, error: err } = await supabase.rpc('place_order', {
      p_restaurant_id: restaurant.id,
      p_customer_name: name.trim(),
      p_customer_phone: phone.trim(),
      p_zone: selectedCompound?.name ?? '',
      p_unit_number: unit.trim(),
      p_address_notes: notes.trim(),
      p_delivery_fee: deliveryFee ?? 0, // server recomputes and ignores this
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
        : err?.message.includes('invalid_combo') ? 'فيه كومبو في عربتك مابقاش متاح — امسح الصنف وضيفه تاني'
        : err?.message.includes('restaurant_closed') ? 'المكان ده قفل قبل ما تأكد الطلب، جرب تاني بعدين'
        : err?.message.includes('vendor_not_covering_compound') ? 'المكان ده مش بيوصل لمنطقتك للأسف'
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
        {removedNotice && <p className="text-sandink text-sm mb-4 bg-sand/10 rounded-xl p-3 mx-4">{removedNotice}</p>}
        <p className="font-bold text-lg mb-1">مفيش حاجة في العربة</p>
        <button className="btn-sea mt-4" onClick={() => nav('/')}>تصفح المطاعم</button>
      </div>
    )
  }

  return (
    <div className="pb-6">
      <h1 className="text-2xl font-bold mb-4">تأكيد الطلب</h1>

      {removedNotice && (
        <p className="text-sandink text-sm mb-4 bg-sand/10 rounded-xl p-3">{removedNotice}</p>
      )}

      {hasRx && (
        <p className="text-sandink text-sm mb-4 bg-sand/10 rounded-xl p-3">
          💊 في صنف محتاج روشتة طبية — الصيدلية هتتواصل معاك تليفونيًا للتأكيد قبل التجهيز
        </p>
      )}

      {scheduled && (
        <div className="mb-4">
          <h2 className="font-bold mb-2">فترة التوصيل</h2>
          {slots.length === 0 && <p className="text-sm text-sandink">لا توجد فترات متاحة حالياً</p>}
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

        {/* Saved addresses were reachable from the profile screen and nowhere
            else, so a signed-in customer with three saved addresses still
            retyped a compound and a unit number at every checkout. */}
        {savedAddresses.length > 0 && (
          <div>
            <p className="label">عناوينك المحفوظة</p>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
              {savedAddresses.map(a => {
                const on = a.compound_id === compoundId && a.unit_number === unit
                return (
                  <button key={a.id} type="button"
                    className={`shrink-0 text-right rounded-xl border-2 px-3 py-2 min-h-[44px] ${on ? 'border-sea bg-sea/5' : 'border-line'}`}
                    onClick={() => {
                      setCompoundId(a.compound_id)
                      setUnit(a.unit_number)
                      setNotes(a.notes ?? '')
                      setAddressExpanded(false)
                    }}>
                    <span className="block text-sm font-bold">{a.label || a.compound_name}</span>
                    <span className="block text-xs text-mist">{a.compound_name} · {a.unit_number}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div><label className="label" htmlFor={`${fid}-1`}>الاسم *</label>
          <input id={`${fid}-1`} className="field" value={name} onChange={e => setName(e.target.value)} placeholder="الاسم بالكامل" /></div>
        <div><label className="label" htmlFor={`${fid}-2`}>رقم الموبايل *</label>
          <input id={`${fid}-2`} className={`field ${phone.trim() && !isValidEgyptPhone(phone) ? '!border-red-400' : ''}`}
            dir="ltr" value={phone} onChange={e => setPhone(e.target.value)}
            placeholder="01xxxxxxxxx" maxLength={13} />
          {phone.trim() && !isValidEgyptPhone(phone) && (
            <p className="text-xs text-red-600 mt-1">{PHONE_HINT}</p>
          )}</div>

        {!addressExpanded && selectedCompound ? (
          <>
            <button type="button" className="w-full flex items-center gap-3 rounded-xl border-2 border-sea/40 bg-sea/5 px-4 py-3.5 text-right"
              onClick={() => setAddressExpanded(true)}>
              <span className="text-2xl shrink-0">📍</span>
              <span className="flex-1 min-w-0">
                <span className="block font-bold truncate">{selectedCompound.name}{unit.trim() ? ` — شاليه ${unit}` : ''}</span>
                {notes.trim() && <span className="block text-xs text-mist truncate mt-0.5">{notes}</span>}
              </span>
              <span className="text-sea text-sm font-semibold shrink-0">تغيير</span>
            </button>
            {selectedCompound.latitude != null && selectedCompound.longitude != null && (
              <LocationPreviewMap lat={selectedCompound.latitude} lng={selectedCompound.longitude} />
            )}
          </>
        ) : (
          <>
            <div><label className="label" htmlFor={`${fid}-3`}>المكان *</label>
              <select id={`${fid}-3`} className="field" value={compoundId ?? ''} onChange={e => setCompoundId(Number(e.target.value) || null)}>
                <option value="">اختر مكانك…</option>
                {compounds.map(c => <option key={c.id} value={c.id}>{c.name} (~{c.est_travel_minutes} د)</option>)}
              </select></div>
            <div><label className="label" htmlFor={`${fid}-4`}>رقم الشاليه / الفيلا *</label>
              <input id={`${fid}-4`} className="field" value={unit} onChange={e => setUnit(e.target.value)} placeholder="مثال: B4 - 204" /></div>
            {showLandmark || notes.trim() ? (
              <div><label className="label" htmlFor={`${fid}-5`}>علامة مميزة (اختياري)</label>
                <input id={`${fid}-5`} className="field" value={notes} onChange={e => setNotes(e.target.value)} placeholder="مثال: بجوار حمام السباحة" autoFocus /></div>
            ) : (
              <button type="button" className="text-sea text-sm font-semibold" onClick={() => setShowLandmark(true)}>
                + إضافة علامة مميزة (اختياري)
              </button>
            )}
          </>
        )}

        {/* The one thing the reference puts front and centre and this screen
            never said at all: when it arrives. sla_minutes is the server's own
            promise, already stored on the order; it was only ever shown after
            the fact on the tracking page. */}
        {quote?.sla_minutes && (
          <div className="card p-3.5 flex items-center gap-3 !rounded-2xl">
            <span className="text-xl shrink-0" aria-hidden="true">🛵</span>
            <div>
              <p className="font-bold text-sm">التوصيل</p>
              <p className="text-xs text-mist">
                يوصلك خلال {quote.sla_minutes}–{quote.sla_minutes + 10} دقيقة
              </p>
            </div>
          </div>
        )}

        <div><label className="label" htmlFor={`${fid}-notes`}>ملاحظات على الطلب (اختياري)</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {['من غير بصل', 'حار زيادة', 'اتصل قبل الوصول', 'اترك عند الباب'].map(preset => {
              const included = customerNote.split('، ').includes(preset)
              return (
                <button key={preset} type="button"
                  className={`text-xs px-3 py-1.5 rounded-full border-2 ${included ? 'border-sea bg-sea/5 text-sea font-semibold' : 'border-line text-mist'}`}
                  onClick={() => {
                    const parts = customerNote.split('، ').map(s => s.trim()).filter(Boolean)
                    const next = included ? parts.filter(p => p !== preset) : [...parts, preset]
                    setCustomerNote(next.join('، '))
                  }}>{preset}</button>
              )
            })}
          </div>
          <textarea id={`${fid}-notes`} className="field" rows={2} value={customerNote} onChange={e => setCustomerNote(e.target.value)}
            placeholder="اكتب أي حاجة تانية…" /></div>
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
          {paymentMethod === 'cod' && serviceFee !== null && deliveryFee !== null
            && codDepositThreshold !== null && finalTotal > codDepositThreshold && (
            <p className="text-xs text-sandink -mt-1 px-1">
              {/* Must equal place_order's `ceil(v_net_total * 0.5)` exactly. It
                  previously read Math.round(finalTotal * 50) / 100, which on a
                  1361 ج.م order quoted 680.5 -- half a pound nobody can transfer
                  or hand over in change. Server rounds the deposit UP to a whole
                  pound; if that ever changes, change it in both places or the
                  customer is quoted one figure and charged another. */}
              الطلب ده أكبر من {codDepositThreshold} ج.م، فهيتطلب عربون 50% ({Math.ceil(finalTotal / 2)} ج.م) عن طريق InstaPay قبل التجهيز، والباقي كاش عند الاستلام
            </p>
          )}
          <label className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-3 cursor-pointer ${paymentMethod === 'instapay' ? 'border-sea bg-sea/5' : 'border-line'}`}>
            <span className="font-semibold flex-1">InstaPay</span>
            <input type="radio" checked={paymentMethod === 'instapay'} onChange={() => setPaymentMethod('instapay')} className="accent-sea w-4 h-4" />
          </label>
        </div>
      </div>

      <div className="card p-4 mb-5 space-y-2">
        <h2 className="font-bold mb-1">ملخص الطلب</h2>
        {lines.map(l => {
          const { unit, original, item, sizeName, comboName, addonNames } = priceFor(l)
          return (
            <div key={l.key} className="flex justify-between text-sm">
              <span>
                {item?.name} × {l.qty}
                {(sizeName || comboName || addonNames.length > 0) && (
                  <span className="text-mist"> ({[comboName && `🍟 ${comboName}`, sizeName, ...addonNames].filter(Boolean).join(' · ')})</span>
                )}
              </span>
              <span>
                {original != null && <span className="text-mist line-through ml-1.5">{l.qty * original}</span>}
                {l.qty * unit} ج.م
              </span>
            </div>
          )
        })}
        <div className="flex justify-between text-sm text-mist">
          <span>التوصيل{quote ? ` لـ ${quote.compound_name}` : ''}</span>
          <span>
            {deliveryFee !== null ? `${deliveryFee} ج.م`
              : feeLoading ? '…'
              : compoundId ? <button className="text-sea underline" onClick={retryFee}>إعادة المحاولة</button>
              : '—'}
          </span>
        </div>
        <div className="flex justify-between text-sm text-mist">
          <span>رسوم الخدمة</span>
          <span>
            {serviceFee !== null ? `${serviceFee} ج.م`
              : serviceFeeLoading ? '…'
              : <button className="text-sea underline" onClick={retryServiceFee}>إعادة المحاولة</button>}
          </span>
        </div>
        {walletApplied > 0 && (
          <div className="flex justify-between text-sm text-emerald-700"><span>من رصيدك</span><span>-{walletApplied} ج.م</span></div>
        )}
        <div className="flex justify-between font-bold border-t border-line pt-2">
          <span>الإجمالي</span>
          {/* optionsLoaded belongs here too: a combo line prices from the base
              item price until menu_item_combos lands, so this figure could read
              284 for an order the server charges 410 for. */}
          <span className="text-sea">{optionsLoaded && deliveryFee !== null && serviceFee !== null ? `${finalTotal} ج.م` : '…'}</span>
        </div>
      </div>

      {compoundsFailed && compounds.length === 0 && (
        <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">
          مش قادرين نجيب قايمة الأماكن دلوقتي —{' '}
          <button className="underline font-semibold" onClick={() => window.location.reload()}>حدّث الصفحة</button>
        </p>
      )}

      {walletFailed && (
        <p className="text-sm text-sandink bg-sand/10 rounded-xl p-3 mb-4">
          مش قادرين نشوف رصيد محفظتك دلوقتي — لو عندك رصيد مش هيتخصم من الطلب ده
        </p>
      )}

      {feeFailed && compoundId && (
        <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">
          مش قادرين نحسب رسوم التوصيل دلوقتي.{' '}
          <button className="underline font-semibold" onClick={retryFee}>جرب تاني</button>
        </p>
      )}

      {serviceFeeFailed && (
        <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">
          مش قادرين نحسب رسوم الخدمة دلوقتي.{' '}
          <button className="underline font-semibold" onClick={retryServiceFee}>جرب تاني</button>
        </p>
      )}

      {codThresholdFailed && paymentMethod === 'cod' && (
        <p className="text-sm text-sandink bg-sandink/10 rounded-xl p-3 mb-4">
          مش قادرين نتأكد من شروط الدفع دلوقتي. جرب تحدّث الصفحة، أو اختار إنستاباي.
        </p>
      )}

      {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">{error}</p>}

      {/* The reason a disabled button is disabled belongs next to the button.
          CustomOrder already does this; checkout did not, and the gap is worse
          here because the missing field is usually the chalet number, which
          sits inside a card the customer may never have opened. Verified on the
          live site: name + phone + compound filled, submit dead, page silent. */}
      {!valid && !saving && (() => {
        const missing =
          !name.trim() ? 'اكتب اسمك'
          : !isValidEgyptPhone(phone) ? 'اكتب رقم موبايل صحيح'
          : !selectedCompound ? 'اختار مكانك'
          : !unit.trim() ? 'اكتب رقم الشاليه / الفيلا'
          : !optionsLoaded ? 'بنحمّل تفاصيل الأصناف…'
          : deliveryFee === null ? 'بنحسب رسوم التوصيل…'
          : serviceFee === null ? 'بنحسب رسوم الخدمة…'
          : (scheduled && !slot) ? 'اختار فترة التوصيل'
          : (paymentMethod === 'cod' && codThresholdFailed) ? 'مش قادرين نتأكد من شروط الدفع كاش — جرب تاني أو اختار InstaPay'
          : null
        return missing ? (
          <p className="text-sm text-sandink bg-sand/10 rounded-xl p-3 mb-3 text-center">{missing}</p>
        ) : null
      })()}

      <button className="btn-sea w-full !py-3.5" disabled={!valid || saving} onClick={placeOrder}>
        {saving ? 'جاري التجهيز…'
          : deliveryFee === null ? (feeLoading ? 'بنحسب التوصيل…' : 'تأكيد الطلب')
          : serviceFee === null ? (serviceFeeLoading ? 'بنحسب رسوم الخدمة…' : 'تأكيد الطلب')
          : `تأكيد الطلب · ${finalTotal} ج.م`}
      </button>

      <p className="text-xs text-mist text-center mt-3">
        بضغطك على "تأكيد الطلب" إنت موافق على <Link to="/terms" className="text-sea underline">الشروط والأحكام</Link>
      </p>
    </div>
  )
}
