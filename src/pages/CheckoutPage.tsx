import { useEffect, useMemo, useState, useId } from 'react'
import Icon from '../components/Icon'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { customerOrderCreation } from '../lib/customerOrderCreation'
import { displayEgyptPhone, isValidEgyptPhone, PHONE_HINT } from '../lib/validation'
import { useCart } from '../lib/cart'
import { loadMenuOptions } from '../lib/menuOptions'
import { lineIsStale, priceLine } from '../lib/linePricing'
import { useDeliveryQuote } from '../lib/deliveryQuote'
import { track, trackOnce } from '../lib/analytics'
import { serviceFeeFor, useServiceFeePct } from '../lib/serviceFee'
import { PROMO_SCOPE_LABEL, type PromoScope } from '../lib/promoScope'
import { useCustomerAuth, getSessionToken } from '../lib/customerAuth'
import { rememberLiveOrder } from '../lib/liveOrder'
import LocationPreviewMap from '../components/LocationPreviewMap'
import type { Compound, Discount, MenuItem, MenuItemAddon, MenuItemCombo, MenuItemSize, Restaurant, Slot } from '../lib/types'
import { getCompoundId, setCompoundId as setStoredCompoundId } from '../lib/place'
import { publicCatalog } from '../lib/publicCatalog'
import { customerSessionAccess } from '../lib/customerSessionAccess'
import { customerAccount } from '../lib/customerAccounts'
import { cairoToday } from '../lib/cairoTime'
import { reportOrderFailure } from '../lib/reportOrderFailure'
import { SUPPORT_PHONE } from '../lib/support'

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
  // optionsLoaded stays FALSE on failure, which keeps the confirm button and
  // the displayed total locked. This flag is what turns that lock into an
  // explanation and a retry instead of a spinner that never resolves.
  const [optionsFailed, setOptionsFailed] = useState(false)
  const [optionsAttempt, setOptionsAttempt] = useState(0)
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
  const [phone, setPhone] = useState(() => displayEgyptPhone(customer?.phone) || localStorage.getItem('salka_phone') || '')
  // Which fields the customer has actually left, so an error appears when they
  // move on rather than scolding an empty form on first paint.
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  // Fill from the account once it lands, but never overwrite something the
  // customer has already typed -- they may be ordering for someone else.
  useEffect(() => {
    if (!customer) return
    setName(prev => prev.trim() ? prev : (customer.name ?? ''))
    setPhone(prev => prev.trim() ? prev : (displayEgyptPhone(customer.phone) || prev))
  // Depends on the three customer FIELDS this reads, not the object. The object
  // gets a new identity on every auth refresh, which would re-run this and
  // re-fill a form the customer may already be typing into.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // settings.cod_deposit_threshold_egp says 3000, so for the moment between
  // first paint and the settings fetch landing, a 451 ج.م order was told it
  // needed a 208 ج.م InstaPay deposit that it does not need -- a false
  // statement about payment terms, on the checkout screen, in the second
  // someone is deciding whether to go through with it. On a *failed* fetch it
  // was not a flash at all: every order between 300 and 3000 kept the warning.
  // Same rule as the delivery fee and the service fee: never guess a
  // server-owned number.
  const [codDepositThreshold, setCodDepositThreshold] = useState<number | null>(null)
  const [codThresholdFailed, setCodThresholdFailed] = useState(false)
  const [useWallet, setUseWallet] = useState(true)
  const [promoCode, setPromoCode] = useState('')
  const [promoQuote, setPromoQuote] = useState<{ valid: boolean; discount?: number; reason?: string; minimum?: number; applies_to?: PromoScope } | null>(null)
  const [promoChecking, setPromoChecking] = useState(false)

  // Saved addresses, and the default one preselected. Guarded on `customer`
  // because the RPC is account-scoped -- a guest gets an empty list, not an error.
  useEffect(() => {
    if (!customer) { setSavedAddresses([]); return }
    customerAccount<typeof savedAddresses>('myAddresses').then(res => {
      if (!res.ok) return
      const list = res.data ?? []
      setSavedAddresses(list)
      const preferred = list.find(a => a.is_default) ?? list[0]
      if (!preferred) return
      // Never overwrite something already chosen -- a compound restored from
      // the previous screen, or a unit the customer has started typing.
      setCompoundId(prev => prev ?? preferred.compound_id)
      setUnit(prev => prev.trim() ? prev : preferred.unit_number)
      setNotes(prev => prev.trim() ? prev : (preferred.notes ?? ''))
    })
  // Depends on the three customer FIELDS this reads, not the object. The object
  // gets a new identity on every auth refresh, which would re-run this and
  // re-fill a form the customer may already be typing into.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id])

  // Funnel step 5. Once per session, not per mount -- this screen remounts on
  // every field-driven navigation and under StrictMode, and an inflated step 5
  // would make the checkout->order drop look worse than it is, which is exactly
  // the number this instrumentation exists to get right.
  useEffect(() => {
    if (cart.restaurantId) trackOnce('checkout_started', { restaurantId: cart.restaurantId })
  }, [cart.restaurantId, optionsAttempt])

  useEffect(() => {
    if (!isValidEgyptPhone(phone)) { setWalletBalance(0); setWalletFailed(false); return }
    // A failed lookup used to be indistinguishable from an empty wallet, so the
    // customer's credit was silently not offered at checkout.
    const key = `salka_wallet_seen_${phone.trim()}`
    customerSessionAccess<number>('wallet', { phone: phone.trim(), sessionToken: getSessionToken() })
      .then(result => {
        if (!result.ok) {
          // Only warn someone who has actually HAD credit.
          //
          // The banner used to fire on any failed lookup, which meant a warning
          // about a wallet on the checkout screen of the overwhelming majority
          // of customers who have never had one -- 1 of 16 accounts has a
          // balance today. It is noise that reads as a payment problem at the
          // exact moment someone is deciding whether to go through with the
          // order. We cannot know the balance when the call fails, so use the
          // last one we successfully read for this number.
          let hadCredit = false
          try { hadCredit = Number(localStorage.getItem(key) || 0) > 0 } catch { /* private mode */ }
          setWalletFailed(hadCredit)
          setWalletBalance(0)
          return
        }
        setWalletFailed(false)
        const balance = Number(result.data) || 0
        setWalletBalance(balance)
        try { localStorage.setItem(key, String(balance)) } catch { /* private mode */ }
      })
  }, [phone])

  useEffect(() => {
    if (!isValidEgyptPhone(phone) || addressLoaded) return
    const t = setTimeout(async () => {
      const result = await customerSessionAccess<{
        customer_name: string | null; unit_number: string | null; address_notes: string | null; compound_id: number | null
      } | null>('lastAddress', { phone, sessionToken: getSessionToken() })
      const data = result.ok ? result.data : null
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
    publicCatalog<Slot[]>('openSlots', { restaurantId: cart.restaurantId })
      .then(res => setSlots(res.ok ? res.data : []))
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
    // One shared loader -- see lib/menuOptions.ts. This block used to exist
    // identically in both this screen and the other one, and both swallowed
    // every error while still declaring the options loaded.
    ;(async () => {
      const opts = await loadMenuOptions(cart.restaurantId)
      if (!opts.ok) { setOptionsFailed(true); return }
      setOptionsFailed(false)
      setSizes(opts.sizes)
      setCombos(opts.combos)
      setAddons(opts.addons)
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
  const scheduled = !!restaurant?.uses_delivery_slots
  const hasRx = lines.some(l => priceFor(l).item?.requires_prescription)
  const selectedCompound = compounds.find(c => c.id === compoundId)
  // Authoritative fee from the server. null while loading or on failure -- we
  // never substitute 0 or a local estimate, because every number below it
  // (wallet applied, COD deposit threshold, the confirm button) would be wrong.
  // The vendor is passed because the SLA is prep + travel and prep is per
  // vendor. Without it the server falls back to a default prep time and quotes
  // a 45-minute supermarket shop like a 10-minute burger.
  const { fee: deliveryFee, quote, loading: feeLoading, failed: feeFailed, retry: retryFee } =
    useDeliveryQuote(compoundId, cart.restaurantId)
  // Same rule as the delivery fee: settings.service_fee_percent is what
  // place_order actually charges, so it is fetched, not assumed. The old
  // hardcoded 0.02 quoted the customer one number and billed them another for
  // any setting other than 2.
  const { pct: serviceFeePct, loading: serviceFeeLoading, failed: serviceFeeFailed, retry: retryServiceFee } =
    useServiceFeePct()
  const serviceFee = serviceFeeFor(subtotal, serviceFeePct)
  // A code is only an estimate here. The database validates it again against
  // the final server-priced basket inside the order transaction.
  //
  // The fees go with the quote because a code can now be scoped to them: a
  // delivery-only code is worth a percentage of deliveryFee, not of subtotal.
  // Quoting before both fees have loaded would price the code off zero and show
  // the customer a discount the order transaction is about to disagree with, so
  // this waits for them the same way the confirm button does.
  useEffect(() => {
    const code = promoCode.trim().toUpperCase()
    if (!code || !cart.restaurantId || !compoundId || subtotal <= 0 || deliveryFee === null || serviceFee === null) {
      setPromoQuote(null); setPromoChecking(false); return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setPromoChecking(true)
      const { data, error } = await supabase.rpc('quote_promo_code', {
        p_code: code, p_restaurant_id: cart.restaurantId, p_compound_id: compoundId, p_subtotal: subtotal,
        p_delivery_fee: deliveryFee, p_service_fee: serviceFee,
      })
      if (!cancelled) { setPromoQuote(error ? { valid: false, reason: 'promo_invalid' } : data as typeof promoQuote); setPromoChecking(false) }
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [promoCode, cart.restaurantId, compoundId, subtotal, deliveryFee, serviceFee])
  const promoDiscount = promoQuote?.valid ? Number(promoQuote.discount ?? 0) : 0
  const preWalletTotal = subtotal + (deliveryFee ?? 0) + (serviceFee ?? 0) - promoDiscount
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
    const result = await customerOrderCreation<{ token: string; id: number; cod_deposit_amount?: number | null }>('catalog', {
      restaurantId: restaurant.id,
      customerName: name.trim(),
      customerPhone: phone.trim(),
      zone: selectedCompound?.name ?? '',
      unitNumber: unit.trim(),
      addressNotes: notes.trim(),
      deliveryFee: deliveryFee ?? 0, // server recomputes and ignores this
      items: payload,
      slotId: slot?.id ?? null,
      scheduledDate: slot?.scheduled_date ?? null,
      compoundId,
      paymentMethod: isInstapay ? 'instapay' : 'cod',
      useWallet: walletBalance > 0 && useWallet,
      sessionToken: getSessionToken(),
      customerNote: customerNote.trim() || null,
      promoCode: promoCode.trim().toUpperCase() || null,
    })
    const data = result.ok ? result.data : null
    const err = result.ok ? null : { message: result.code }
    if (!result.ok || !data?.token) {
      setSaving(false)
      // Record the server's own error code, not a bucket.
      //
      // This used to map ten known codes to friendly labels and send 'unknown'
      // for everything else. The edge function can return roughly forty --
      // order_rate_limit, daily_order_limit, account_blocked, slot_unavailable,
      // restaurant_not_found, order_creation_failed, 'network' -- so every
      // block outside that list arrived as 'unknown'. It made the metric
      // useless in exactly the cases worth knowing about: all 66 blocks
      // recorded between 10 and 15 August, from 14 people averaging 4.7
      // attempts each, said 'unknown'.
      //
      // The code is already an allowlisted server token (see ORDER_ERRORS in
      // customer-order-creation) and carries no personal data, so it can be
      // stored verbatim. The shape check is belt-and-braces: anything that is
      // not a bare snake_case token is not a code we recognise, and must not
      // be forwarded in case a raw driver message ever reaches this path.
      const rawCode = (err?.message ?? '').trim()
      const reason = /^[a-z0-9_]{1,64}$/.test(rawCode) ? rawCode : 'unknown'
      // Analytics records every block, for funnel work. Sentry hears only the
      // ones that mean something is wrong with us -- see reportOrderFailure for
      // why an expired promo code must not page anybody. Until now nothing
      // reported a failed checkout at all, which is why the 2026-08-13 outage
      // ran for two hours in silence.
      reportOrderFailure(reason, {
        action: 'catalog',
        restaurantId: restaurant.id,
        compoundId,
      })
      track('checkout_blocked', {
        restaurantId: restaurant.id,
        compoundId,
        props: { reason, payment: isInstapay ? 'instapay' : 'cod' },
      })
      setError(
        // FIRST, because it is the one case where we must NOT tell the customer
        // the order failed. result.code is exactly 'network' when the request
        // never got a response -- and as lib/rpc.ts spells out, a lost response
        // does not mean a lost write: the edge function can process the order
        // and have the reply disappear in a lift or a tunnel. Saying "it was not
        // registered" here is how you get two identical orders and one angry
        // restaurant, so this branch sends them to look before re-ordering.
        err?.message === 'network' ? 'النت قطع ومش متأكدين إن الطلب وصل. افتح «طلباتي» وشوف قبل ما تطلب تاني، عشان ماينزلش طلبين'
        : err?.message.includes('slot_full') ? 'الفترة دي اتملت، اختار فترة تانية'
        : err?.message.includes('invalid_combo') ? 'فيه كومبو في عربتك مابقاش متاح. امسح الصنف وضيفه تاني'
        : err?.message.includes('restaurant_closed') ? 'المكان ده قفل قبل ما تأكد الطلب، جرب تاني بعدين'
        : err?.message.includes('vendor_not_covering_compound') ? 'المكان ده مش بيوصل لمنطقتك للأسف'
        : err?.message.includes('item_not_available_now') ? 'في صنف في عربتك مش متاح دلوقتي (وقت محدود)، شيله وجرب تاني'
        : err?.message.includes('item_unavailable') ? 'في صنف في عربتك خلص، شيله وجرب تاني'
        : err?.message.includes('size_required') || err?.message.includes('invalid_size') ? 'اختار حجم الصنف قبل ما تكمل'
        : err?.message.includes('addon_group_min_not_met') ? 'في اختيار مطلوب لصنف في عربتك لسه ما اتحددش'
        : err?.message.includes('addon_group_max_exceeded') ? 'اخترت إضافات أكتر من المسموح لصنف في عربتك'
        : err?.message.includes('promo_expired') ? 'كود الخصم انتهت صلاحيته'
        : err?.message.includes('promo_minimum_not_met') ? 'الطلب أقل من الحد الأدنى لكود الخصم'
        : err?.message.includes('promo_already_used') ? 'استخدمت كود الخصم ده قبل كده'
        : err?.message.includes('promo_nothing_to_discount') ? 'كود الخصم مش بيخصم حاجة في الطلب ده'
        : err?.message.includes('promo_limit_reached') ? 'كود الخصم خلص'
        : err?.message.includes('promo_not_available') ? 'الكود ده مش متاح للمطعم أو المنطقة دي'
        : err?.message.includes('promo_invalid') ? 'كود الخصم غير صحيح'
        // LAST RESORT, and the only branch here that is not self-explanatory.
      // Every code above tells the customer something they can act on. This one
      // fires when the server raised something we do not recognise -- which in
      // practice means a fault on our side, and it is already on its way to
      // Sentry via reportOrderFailure above.
      //
      // The old text was 'حصل خطأ، جرب تاني'. Two problems with it on a money
      // screen: it never said whether the order had gone through, which is the
      // first thing anyone wants to know after a checkout fails, and 'try again'
      // was the only route offered -- so a customer hitting a real outage just
      // retried into the same wall. place_order runs in one transaction, so a
      // raised exception means nothing was written and we can say so plainly.
      : `معلش، الطلب ماتسجلش وماوصلش للمطعم. جرب تاني، ولو فضلت المشكلة كلّمنا واتساب على ${SUPPORT_PHONE}`
      )
      return
    }

    localStorage.setItem('salka_phone', phone.trim())

    // Funnel step 6, the only one that is money. Fired AFTER the server has
    // returned a token -- i.e. on a row that exists. Firing it beside the RPC
    // call would count every failed attempt as an order and make the funnel
    // report a conversion rate the bank account disagrees with.
    track('order_placed', {
      restaurantId: restaurant.id,
      compoundId: compoundId,
      orderId: typeof data.id === 'number' ? data.id : null,
      props: { payment: isInstapay ? 'instapay' : 'cod' },
    })

    cart.clear()
    // Persist before navigating: the token was previously only ever in the URL,
    // so closing the tab lost the order.
    rememberLiveOrder(String(data.token))
    nav(`/track/${data.token}`)
  }

  if (!cart.restaurantId || lines.length === 0) {
    return (
      <div className="text-center py-16">
        {removedNotice && <p className="text-coral-700 text-sm mb-4 bg-coral-100 rounded-xl p-3 mx-4">{removedNotice}</p>}
        <p className="font-bold text-lg mb-1">مفيش حاجة في العربة</p>
        <button className="btn-sea mt-4" onClick={() => nav('/')}>تصفح المطاعم</button>
      </div>
    )
  }

  return (
    <div className="pb-6">
      <h1 className="text-2xl font-bold mb-4">تأكيد الطلب</h1>

      {removedNotice && (
        <p className="text-coral-700 text-sm mb-4 bg-coral-100 rounded-xl p-3">{removedNotice}</p>
      )}

      {hasRx && (
        <p className="text-coral-700 text-sm mb-4 bg-coral-100 rounded-xl p-3">
          <Icon name="pill" size="sm" className="inline-block align-[-0.15em] me-1" />في صنف محتاج روشتة طبية، الصيدلية هتتواصل معاك تليفونيًا للتأكيد قبل التجهيز
        </p>
      )}

      {scheduled && (
        <div className="mb-4">
          <h2 className="font-bold mb-2">فترة التوصيل</h2>
          {slots.length === 0 && <p className="text-sm text-coral-700">لا توجد فترات متاحة حالياً</p>}
          <div className="grid grid-cols-2 gap-2">
            {slots.map(sl => {
              const on = slot?.id === sl.id && slot?.scheduled_date === sl.scheduled_date
              const today = sl.scheduled_date === cairoToday()
              return (
                <button key={`${sl.id}-${sl.scheduled_date}`} className={`card p-3 text-right ${on ? 'border-sea' : ''}`} onClick={() => setSlot(sl)}>
                  <p className="text-sm font-semibold">{sl.start_time.slice(0, 5)}–{sl.end_time.slice(0, 5)}</p>
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
        {/* A saved address is meant to END the typing, so it is a full card
            with everything on it -- icon, the label as the title, and the
            actual address underneath -- not a narrow chip in a horizontal
            scroller showing two truncated lines. Wael's note: "this should be a
            saved address, not every order I enter my details".
            Tapping one fills the form AND collapses it, so the five fields
            below stop being the first thing a returning customer sees. */}
        {savedAddresses.length > 0 && (
          <div className="space-y-2">
            <p className="label !mb-1">عناوينك المحفوظة</p>
            {savedAddresses.map(a => {
              const on = a.compound_id === compoundId && a.unit_number === unit
              return (
                <button key={a.id} type="button"
                  className={`w-full text-right rounded-xl border-2 p-3 flex items-center gap-3 ${on ? 'border-sea bg-sea/5' : 'border-line'}`}
                  onClick={() => {
                    setCompoundId(a.compound_id)
                    setUnit(a.unit_number)
                    setNotes(a.notes ?? '')
                    setAddressExpanded(false)
                  }}>
                  <span className={`w-10 h-10 rounded-xl grid place-items-center text-lg shrink-0 ${on ? 'bg-sea text-white' : 'bg-shellup'}`}
                    aria-hidden="true">
                    {/* The label decides the icon: a home is a home, anything
                        else is just a pin. */}
                    <Icon size="sm" name={
                      (a.label || '').includes('شغل') || (a.label || '').includes('مكتب') ? 'briefcase'
                        : (a.label || '').includes('منزل') || (a.label || '').includes('بيت') ? 'house'
                        : 'locationDot'} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold truncate">{a.label || a.compound_name}</span>
                    <span className="block text-xs text-mist truncate mt-0.5">{a.compound_name}</span>
                    <span className="block text-xs text-mist truncate">
                      {a.unit_number}{a.notes?.trim() ? `، ${a.notes.trim()}` : ''}
                    </span>
                  </span>
                  {on && <span className="text-sea text-sm font-bold shrink-0"><Icon name="check" size="sm" /></span>}
                </button>
              )
            })}
          </div>
        )}

        {/* Name and phone were the two fields that never collapsed, so even a
            signed-in customer with a saved address still met a form at every
            checkout -- which is the whole complaint. They fold into the same
            summary line the address uses, and the تغيير button opens all of
            it together. */}
        {!addressExpanded && selectedCompound && name.trim() && isValidEgyptPhone(phone) ? (
          <div className="flex items-center gap-2 text-sm">
            <Icon name="user" size="sm" className="shrink-0 text-mist" />
            <span className="flex-1 min-w-0 truncate">{name}</span>
            <span className="text-mist shrink-0" dir="ltr">{phone}</span>
          </div>
        ) : (
          <>
            {/* «(مطلوب)» rather than a bare `*` -- the asterisk is a Western
                form convention that announces as nothing and sits where an
                Arabic reader does not look for it. */}
            <div><label className="label" htmlFor={`${fid}-1`}>الاسم <span className="text-mist font-normal">(مطلوب)</span></label>
              <input id={`${fid}-1`} className={`field ${touched.name && !name.trim() ? '!border-dangerline' : ''}`}
                value={name} onChange={e => setName(e.target.value)}
                onBlur={() => setTouched(t => ({ ...t, name: true }))} placeholder="الاسم بالكامل" />
              {touched.name && !name.trim() && (
                <p className="text-xs text-danger mt-1">اكتب اسمك عشان المندوب يعرف يسأل عليك</p>
              )}</div>
            <div><label className="label" htmlFor={`${fid}-2`}>رقم الموبايل <span className="text-mist font-normal">(مطلوب)</span></label>
              <input id={`${fid}-2`} className={`field ${phone.trim() && !isValidEgyptPhone(phone) ? '!border-dangerline' : ''}`}
                dir="ltr" value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="01xxxxxxxxx" maxLength={13} />
              {phone.trim() && !isValidEgyptPhone(phone) && (
                <p className="text-xs text-danger mt-1">{PHONE_HINT}</p>
              )}</div>
          </>
        )}

        {!addressExpanded && selectedCompound ? (
          <>
            <button type="button" className="w-full flex items-center gap-3 rounded-xl border-2 border-sea/40 bg-sea/5 px-4 py-3.5 text-right"
              onClick={() => setAddressExpanded(true)}>
              <Icon name="locationDot" size="lg" className="shrink-0 text-mist" />
              <span className="flex-1 min-w-0">
                <span className="block font-bold truncate">{selectedCompound.name}{unit.trim() ? `، شاليه ${unit}` : ''}</span>
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
            <div><label className="label" htmlFor={`${fid}-4`}>رقم الشاليه / الفيلا <span className="text-mist font-normal">(مطلوب)</span></label>
              <input id={`${fid}-4`} className={`field ${touched.unit && !unit.trim() ? '!border-dangerline' : ''}`}
                value={unit} onChange={e => setUnit(e.target.value)}
                onBlur={() => setTouched(t => ({ ...t, unit: true }))} placeholder="مثال: B4 - 204" />
              {touched.unit && !unit.trim() && (
                <p className="text-xs text-danger mt-1">من غير رقم الوحدة المندوب مش هيعرف يوصلك</p>
              )}</div>
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

        {optionsFailed && (
          <div className="card p-3 border-dangerline bg-dangerbg flex items-center justify-between gap-3">
            <p className="text-sm text-danger font-semibold">مش قادرين نجيب تفاصيل الأصناف، مش هينفع نأكد الطلب دلوقتي</p>
            <button className="btn-ghost !py-1.5 !px-3 text-xs shrink-0"
              onClick={() => setOptionsAttempt(a => a + 1)}>جرب تاني</button>
          </div>
        )}

        {/* The one thing the reference puts front and centre and this screen
            never said at all: when it arrives. sla_minutes is the server's own
            promise, already stored on the order; it was only ever shown after
            the fact on the tracking page. */}
        {/* The upper bound comes from the server now. It used to be `+ 10`
            here, which was as wide for a 1 km hop as for a 30 km run, and sat
            on top of an SLA that ignored the kitchen entirely -- سوبرماركت
            takes 45 minutes to shop and this line promised 20. */}
        {quote?.sla_minutes && (
          <div className="card p-3.5 flex items-center gap-3 !rounded-2xl">
            <Icon name="moped" size="md" className="shrink-0 text-mist" />
            <div>
              <p className="font-bold text-sm">التوصيل</p>
              <p className="text-xs text-mist">
                يوصلك خلال {quote.sla_minutes}–{quote.sla_max_minutes ?? quote.sla_minutes + 10} دقيقة
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
          <textarea id={`${fid}-notes`} className="field h-20 resize-none" rows={2} value={customerNote} onChange={e => setCustomerNote(e.target.value)}
            placeholder="اكتب أي حاجة تانية…" /></div>
      </div>

      {walletBalance > 0 && (
        <div className="card p-4 mb-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" className="accent-sea w-4 h-4" checked={useWallet} onChange={e => setUseWallet(e.target.checked)} />
            <Icon name="wallet" size="md" className="text-mist" />
            <span className="flex-1">
              <span className="font-semibold block">استخدم رصيدك</span>
              <span className="text-xs text-mist">عندك {walletBalance} ج.م في محفظتك</span>
            </span>
          </label>
        </div>
      )}

      <div className="card p-4 mb-4">
        <label className="label" htmlFor={`${fid}-promo`}>عندك كود خصم؟ <span className="text-mist font-normal">(اختياري)</span></label>
        <input id={`${fid}-promo`} className="field" value={promoCode}
          onChange={e => setPromoCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
          placeholder="مثال: SOKHNA10" maxLength={32} dir="ltr" />
        {promoChecking && <p className="text-xs text-mist mt-2">بنتأكد من الكود…</p>}
        {!promoChecking && promoCode.trim() && promoQuote?.valid && (
          <p className="text-xs text-success font-semibold mt-2">تم تطبيق الخصم على {PROMO_SCOPE_LABEL[promoQuote.applies_to ?? 'all']}: -{promoDiscount} ج.م</p>
        )}
        {!promoChecking && promoCode.trim() && promoQuote && !promoQuote.valid && (
          <p className="text-xs text-danger mt-2">
            {promoQuote.reason === 'promo_expired' ? 'الكود منتهي أو لسه ما بدأش'
              : promoQuote.reason === 'promo_minimum_not_met' ? `الحد الأدنى ${promoQuote.minimum ?? ''} ج.م`
              : promoQuote.reason === 'promo_not_available' ? 'الكود مش متاح للمطعم أو المكان ده'
              : promoQuote.reason === 'promo_nothing_to_discount' ? `الكود ده بيخصم من ${PROMO_SCOPE_LABEL[promoQuote.applies_to ?? 'all']}، ومفيش حاجة يخصم منها في الطلب ده`
              : 'الكود غير صحيح أو غير متاح'}
          </p>
        )}
      </div>

      <div className="card p-4 mb-4">
        <h2 className="font-bold mb-3">الدفع</h2>
        <div className="space-y-2.5">
          <label className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-3 cursor-pointer ${paymentMethod === 'cod' ? 'border-sea bg-sea/5' : 'border-line'}`}>
            <span className="font-semibold flex-1">كاش عند الاستلام</span>
            <input type="radio" checked={paymentMethod === 'cod'} onChange={() => setPaymentMethod('cod')} className="accent-sea w-4 h-4" />
          </label>
          {paymentMethod === 'cod' && serviceFee !== null && deliveryFee !== null
            && codDepositThreshold !== null && finalTotal > codDepositThreshold && (
            <p className="text-xs text-coral-700 -mt-1 px-1">
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
          {/* The same disclosure the cash path already gets, for the same
              reason. An InstaPay order is BORN at awaiting_payment: the button
              says «تأكيد الطلب · {finalTotal} ج.م», the basket is emptied, and
              the customer lands on a full-screen transfer wall they were never
              warned about -- and nothing is cooked until they pay. That exact
              complaint was fixed for the cash-deposit path and left open here,
              which is how one order can be disclosed and the next one ambushed.

              Says the whole amount, not half: InstaPay is prepaid in full. */}
          {paymentMethod === 'instapay' && serviceFee !== null && deliveryFee !== null && (
            <p className="text-xs text-coral-700 -mt-1 px-1">
              هتحوّل {finalTotal} ج.م كاملة على InstaPay قبل ما المطعم يبدأ التحضير، هنوريك الـ QR والرقم بعد التأكيد، ولو غيّرت رأيك تقدر ترجع كاش من نفس الشاشة
            </p>
          )}
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
        {promoDiscount > 0 && (
          <div className="flex justify-between text-sm text-success"><span>كود خصم {promoCode.trim().toUpperCase()} · {PROMO_SCOPE_LABEL[promoQuote?.applies_to ?? 'all']}</span><span>-{promoDiscount} ج.م</span></div>
        )}
        <div className="flex justify-between text-sm text-mist">
          <span>رسوم الخدمة</span>
          <span>
            {serviceFee !== null ? `${serviceFee} ج.م`
              : serviceFeeLoading ? '…'
              : <button className="text-sea underline" onClick={retryServiceFee}>إعادة المحاولة</button>}
          </span>
        </div>
        {walletApplied > 0 && (
          <div className="flex justify-between text-sm text-success"><span>من رصيدك</span><span>-{walletApplied} ج.م</span></div>
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
        <p className="text-sm text-danger bg-dangerbg rounded-xl p-3 mb-4">
          مش قادرين نجيب قايمة الأماكن دلوقتي:{' '}
          <button className="underline font-semibold" onClick={() => window.location.reload()}>حدّث الصفحة</button>
        </p>
      )}

      {/* Only shown to someone whose wallet we have previously seen carrying
          credit -- see the lookup above. */}
      {walletFailed && (
        <p className="text-sm text-coral-700 bg-coral-100 rounded-xl p-3 mb-4">
          مش قادرين نشوف رصيد محفظتك دلوقتي، رصيدك مش هيتخصم من الطلب ده
        </p>
      )}

      {feeFailed && compoundId && (
        <p className="text-sm text-danger bg-dangerbg rounded-xl p-3 mb-4">
          مش قادرين نحسب رسوم التوصيل دلوقتي.{' '}
          <button className="underline font-semibold" onClick={retryFee}>جرب تاني</button>
        </p>
      )}

      {serviceFeeFailed && (
        <p className="text-sm text-danger bg-dangerbg rounded-xl p-3 mb-4">
          مش قادرين نحسب رسوم الخدمة دلوقتي.{' '}
          <button className="underline font-semibold" onClick={retryServiceFee}>جرب تاني</button>
        </p>
      )}

      {codThresholdFailed && paymentMethod === 'cod' && (
        <p className="text-sm text-coral-700 bg-coral-100 rounded-xl p-3 mb-4">
          مش قادرين نتأكد من شروط الدفع دلوقتي. جرب تحدّث الصفحة، أو اختار إنستاباي.
        </p>
      )}

      {error && <p className="text-sm text-danger bg-dangerbg rounded-xl p-3 mb-4">{error}</p>}

      {/* The reason a disabled button is disabled belongs next to the button.
          CustomOrder already does this; checkout did not, and the gap is worse
          here because the missing field is usually the chalet number, which
          sits inside a card the customer may never have opened. Verified on the
          live site: name + phone + compound filled, submit dead, page silent. */}
      {!valid && !saving && (() => {
        // Each reason now knows WHICH control it is about, so the message is a
        // way back to the field rather than a sentence the customer has to map
        // onto a form they may have scrolled past.
        const m: { text: string; field?: string; touch?: string } | null =
          !name.trim() ? { text: 'اكتب اسمك', field: `${fid}-1`, touch: 'name' }
          : !isValidEgyptPhone(phone) ? { text: 'اكتب رقم موبايل صحيح', field: `${fid}-2` }
          // Checked before !selectedCompound, which is also true on this
          // failure (the dropdown that would set it has nothing in it). The
          // generic "اختار مكانك ←" pointed a customer at an empty <select>
          // with no hint that the list itself failed to load, while the
          // honest message + reload button sat in a separate banner far
          // below the fold, easy to miss.
          : compoundsFailed ? { text: 'مش قادرين نجيب الأماكن دلوقتي. حدّث الصفحة' }
          : !selectedCompound ? { text: 'اختار مكانك', field: `${fid}-3` }
          : !unit.trim() ? { text: 'اكتب رقم الشاليه / الفيلا', field: `${fid}-4`, touch: 'unit' }
          : !optionsLoaded ? { text: 'بنحمّل تفاصيل الأصناف…' }
          : deliveryFee === null ? { text: 'بنحسب رسوم التوصيل…' }
          : serviceFee === null ? { text: 'بنحسب رسوم الخدمة…' }
          // slots.length === 0 is a dead end, not a pending choice -- there is
          // nothing to select, so telling the customer to select one is a
          // false instruction with no way forward.
          : (scheduled && !slot) ? (slots.length === 0
              ? { text: 'مفيش فترات توصيل متاحة دلوقتي. جرب تاني بعد شوية' }
              : { text: 'اختار فترة التوصيل' })
          : (paymentMethod === 'cod' && codThresholdFailed)
            ? { text: 'مش قادرين نتأكد من شروط الدفع كاش. جرب تاني أو اختار InstaPay' }
          : null
        if (!m) return null
        const cls = 'w-full text-sm text-coral-700 bg-coral-100 rounded-xl p-3 mb-3 text-center'
        return m.field ? (
          <button className={cls} onClick={() => {
            if (m.touch) setTouched(t => ({ ...t, [m.touch!]: true }))
            const el = document.getElementById(m.field!)
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            ;(el as HTMLInputElement | null)?.focus({ preventScroll: true })
          }}>{m.text}<Icon name="chevronLeft" size="xs" className="inline-block align-[-0.15em] ms-1" /></button>
        ) : <p className={cls}>{m.text}</p>
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
