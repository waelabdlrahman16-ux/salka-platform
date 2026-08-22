import { useEffect, useRef, useState, useId } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import PromoSection from '../components/PromoSection'
import { type PromoQuote } from '../lib/promoOffers'
import { customerOrderCreation } from '../lib/customerOrderCreation'
import { useDeliveryQuote } from '../lib/deliveryQuote'
import { serviceFeeFor, useServiceFeePolicy } from '../lib/serviceFee'
import { displayEgyptPhone, isValidEgyptPhone, PHONE_HINT } from '../lib/validation'
import { VENDOR_TYPE_ART } from '../lib/categoryArt'
import Icon from '../components/Icon'
import { getSessionToken, useCustomerAuth } from '../lib/customerAuth'
import { rememberLiveOrder } from '../lib/liveOrder'
import type { Compound, MenuItem, Restaurant, Slot } from '../lib/types'
import { getCompoundId } from '../lib/place'
import { publicCatalog } from '../lib/publicCatalog'
import { customerSessionAccess } from '../lib/customerSessionAccess'
import { customerAccount } from '../lib/customerAccounts'
import { cairoToday } from '../lib/cairoTime'
import { openLabel } from '../lib/vendorHours'

export default function CustomOrder() {
  const fid = useId()
  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  // ?type= narrows the chooser; ?vendor= names one outright. Both arrive only
  // from a redirect off a custom_request vendor page -- the nav tab links here
  // bare, which is why the chooser is the normal first screen.
  const typeFilter = searchParams.get('type')
  const vendorParam = Number(searchParams.get('vendor')) || null
  const [vendors, setVendors] = useState<Restaurant[]>([])
  /** The vendor read failed. Distinct from "no vendor is open" -- the two
   *  look identical on screen and mean opposite things. */
  const [loadFailed, setLoadFailed] = useState(false)
  // The chooser displays only vendors that can accept an order now, but the
  // empty state must still be able to answer *when* to come back. Keep the
  // server-calculated opening moments separately instead of guessing from the
  // browser clock or reimplementing the hours rules here.
  const [closedVendorOpenings, setClosedVendorOpenings] = useState<{ vendor_type: string; next_open_at: string | null }[]>([])
  const [vendor, setVendor] = useState<Restaurant | null>(null)
  // The vendor's known items. Deliberately used as typing shortcuts and NOT as
  // a priced catalogue: of the supermarket's 13 rows, nine are shelf labels
  // ("مستلزمات التنظيف المنزلي") carrying round placeholder prices. Showing
  // those numbers would be the client-side-default bug in its purest form --
  // a price the customer reads as a quote that no server will honour.
  const [knownItems, setKnownItems] = useState<MenuItem[]>([])
  // Structured lines, not a text blob.
  //
  // submit_custom_order has always ACCEPTED p_request_items, and the UI has
  // always sent `[]`, putting the whole order into the notes field instead. So
  // the pharmacist received one paragraph to read and interpret: no quantities
  // they could rely on, no way to tick an item off, no way to price line by
  // line. The server was ready; the screen never used it.
  const [lines, setLines] = useState<{ name: string; qty: number }[]>([])
  const [notes, setNotes] = useState('')
  // Search replaced the category chips as the PRIMARY way in. Categories made
  // the customer guess which shelf their thing lives on before they could see
  // it; search works from the first letter, and when nothing matches it offers
  // to add exactly what was typed -- so free text still works, it is just the
  // fallback now rather than the only road.
  const [search, setSearch] = useState('')
  const [popular, setPopular] = useState<string[]>([])
  const [lastRequest, setLastRequest] = useState<{ id: number; created_at: string; request_items: { name: string; qty: number }[] } | null>(null)
  // The address form used to sit under the item list on the same screen, so
  // every order -- including a one-line "بنادول" -- was a long scroll past six
  // delivery fields before the send button. It is a separate step now: build
  // the list, then say where it goes. A signed-in customer whose address we
  // already have never sees the step at all; they get a summary line and a
  // تغيير button on the confirm screen.
  const [step, setStep] = useState<'items' | 'address'>('items')
  /** Open slots per vendor, for the chooser cards. Keyed by restaurant id. */
  const [vendorSlots, setVendorSlots] = useState<Record<number, Slot[]>>({})
  const [rxPath, setRxPath] = useState<string | null>(null)
  const [rxPreview, setRxPreview] = useState<string | null>(null)
  const [rxUploading, setRxUploading] = useState(false)
  const [slots, setSlots] = useState<Slot[]>([])
  const [slot, setSlot] = useState<Slot | null>(null)

  const [compounds, setCompounds] = useState<Compound[]>([])
  // Same three-way disagreement as CheckoutPage -- see the long note there.
  // The account name comes from Google and was beating the name the customer
  // actually orders under.
  // The code the customer picks now is HELD on the request and applied when
  // staff confirm the price -- see 20260821090000. Quoted here only to catch a
  // code that is wrong for reasons that do not need a price (expired, wrong
  // vendor, wrong area); the two price-dependent verdicts are ignored, because
  // at a subtotal of zero they are true of every code and mean nothing yet.
  const [promoCode, setPromoCode] = useState('')
  const [promoQuote, setPromoQuote] = useState<PromoQuote | null>(null)
  const [promoChecking, setPromoChecking] = useState(false)
  const nameEdited = useRef(false)
  const [name, setName] = useState(''); const [phone, setPhone] = useState(() => localStorage.getItem('salka_phone') ?? '')
  const [unit, setUnit] = useState('')
  const [addrNotes, setAddrNotes] = useState('')
  const [compoundId, setCompoundId] = useState<number | null>(() => {
    const saved = getCompoundId()
    return saved ? Number(saved) : null
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [addressLoaded, setAddressLoaded] = useState(false)

  const { customer } = useCustomerAuth()
  const [savedAddresses, setSavedAddresses] = useState<
    { id: number; label: string; compound_id: number; compound_name: string; unit_number: string; notes: string | null; is_default: boolean }[]
  >([])
  const [addressExpanded, setAddressExpanded] = useState(false)
  const [showLandmark, setShowLandmark] = useState(false)

  // A signed-in customer already told us their name and number when they made
  // the account, and their address the last time they ordered. Asking again is
  // not a safety check -- it is five fields between someone with a headache and
  // a box of paracetamol.
  //
  // Only fills blanks, never overwrites: `customer` resolves asynchronously, so
  // a plain assignment would wipe whatever had been typed while auth was still
  // loading.
  useEffect(() => {
    if (!customer) return
    setName(prev => prev.trim() ? prev : (customer.name ?? ''))
    setPhone(prev => prev.trim() ? prev : (displayEgyptPhone(customer.phone) || prev))
  // Depends on the three customer FIELDS this reads, not the object. The object
  // gets a new identity on every auth refresh, which would re-run this and
  // re-fill a form the customer may already be typing into.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id, customer?.name, customer?.phone])

  useEffect(() => {
    if (!customer) { setSavedAddresses([]); return }
    customerAccount<typeof savedAddresses>('myAddresses').then(res => {
      if (!res.ok) return
      const list = res.data ?? []
      setSavedAddresses(list)
      const preferred = list.find(a => a.is_default) ?? list[0]
      if (!preferred) return
      setCompoundId(prev => prev ?? preferred.compound_id)
      setUnit(prev => prev.trim() ? prev : preferred.unit_number)
      setAddrNotes(prev => prev.trim() ? prev : (preferred.notes ?? ''))
      // The debounced last_address_for_phone lookup below exists for guests.
      // An account address is better than a phone-number guess, so latch the
      // flag and stop that fetch from firing and overwriting nothing usefully.
      setAddressLoaded(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id])

  useEffect(() => {
    if (!isValidEgyptPhone(phone) || addressLoaded) return
    const t = setTimeout(async () => {
      const result = await customerSessionAccess<{
        customer_name: string | null; unit_number: string | null; address_notes: string | null; compound_id: number | null
      } | null>('lastAddress', { phone, sessionToken: getSessionToken() })
      const data = result.ok ? result.data : null
      // Was set inside `if (data)`, so a first-time customer with no saved
      // address never latched the flag and this debounced RPC re-fired on every
      // subsequent keystroke in the phone field, forever.
      setAddressLoaded(true)
      if (data) {
        if (data.customer_name && !nameEdited.current) setName(data.customer_name)
        if (!unit.trim() && data.unit_number) setUnit(data.unit_number)
        if (!addrNotes.trim() && data.address_notes) setAddrNotes(data.address_notes)
        if (!compoundId && data.compound_id) setCompoundId(data.compound_id)
      }
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone])

  useEffect(() => {
    // NOT `.eq('is_open', true)`. That column stopped being the authority when
    // opening hours landed -- vendor_is_open_now() never reads it, and nothing
    // resets it to true, so every live vendor sits at false permanently. This
    // filter returned ZERO vendors while صيدلية and سوبرماركت were both open and
    // submit_custom_order would have accepted the order: the whole custom-order
    // revenue line, invisible. Measured 2026-08-07. The server's computed value
    // comes back on `is_open` from vendor_open_states(), same as the home screen.
    Promise.all([
      supabase.from('restaurants').select('*').eq('order_mode', 'custom_request').eq('archived', false),
      supabase.rpc('vendor_open_states'),
    ]).then(([r, s]) => {
      // Was `setVendors([])`, which renders the empty state -- a customer sees
      // "nothing available" and leaves, when in fact the read failed. Offers.tsx
      // already distinguishes the two; this screen is the custom-order revenue
      // line and did not.
      if (r.error || s.error) { setLoadFailed(true); return }
      setLoadFailed(false)
      const stateRows = (s.data ?? []) as { id: number; is_open: boolean; next_open_at: string | null }[]
      const states = new Map(stateRows.map(v => [v.id, v]))
      const restaurantRows = (r.data ?? []) as Restaurant[]
      setClosedVendorOpenings(restaurantRows.flatMap(v => {
        const state = states.get(v.id)
        return state && !state.is_open
          ? [{ vendor_type: v.vendor_type, next_open_at: state.next_open_at }]
          : []
      }))
      setVendors(restaurantRows
        .filter(v => states.get(v.id)?.is_open)
        .map(v => ({ ...v, is_open: true, next_open_at: states.get(v.id)?.next_open_at ?? null })))
    })
    supabase.from('compounds').select('*').eq('active', true).order('direction').order('distance_km')
      .then(({ data }) => setCompounds(data ?? []))
  }, [])

  // Re-resolve the vendor whenever the requested type changes -- not just once
  // on mount. صيدلية and ماركت are now two tabs in the bottom nav that both
  // render THIS component, so tapping from one to the other changes only the
  // query string: React keeps the component mounted and no fetch re-fires.
  // Resolved on mount alone, a customer who opened the pharmacy and then tapped
  // ماركت would still be sitting in the pharmacy's order form, under a heading
  // that said السوبر ماركت.
  //
  // Auto-select when the type has exactly one vendor, which today is both of
  // them: a chooser containing a single card is a tap that asks a question with
  // one answer.
  useEffect(() => {
    if (!vendors.length) return
    // A named vendor wins over everything. If it is closed or archived it will
    // not be in the list, and we fall through to the chooser rather than
    // showing an order form for a shop that cannot take the order.
    const named = vendorParam ? vendors.find(v => v.id === vendorParam) : null
    if (named) { setVendor(named); return }
    if (!typeFilter) { setVendor(null); return }
    const matches = vendors.filter(v => v.vendor_type === typeFilter)
    setVendor(matches.length === 1 ? matches[0] : null)
  }, [typeFilter, vendorParam, vendors])

  // Slots for EVERY custom-request vendor, so the chooser can say "أقرب فترة
  // ٢:٠٠ م" or "فترات محددة" before the customer commits to a tap. Finding out
  // a mandatory slot step exists only after writing half a shopping list is
  // the single most annoying thing about the old flow.
  useEffect(() => {
    const markets = vendors.filter(v => v.uses_delivery_slots)
    if (!markets.length) return
    Promise.all(markets.map(v =>
      publicCatalog<Slot[]>('openSlots', { restaurantId: v.id })
        .then(res => [v.id, res.ok ? res.data : []] as const)
    )).then(pairs => setVendorSlots(Object.fromEntries(pairs)))
  }, [vendors])

  useEffect(() => {
    if (!vendor) { setPopular([]); setLastRequest(null); return }
    publicCatalog<string[]>('popularItems', { restaurantId: vendor.id })
      .then(res => setPopular(res.ok ? res.data : []))
    // Returns null for anyone we cannot identify -- it refuses to answer to a
    // typed phone number, unlike every other lookup here.
    customerSessionAccess<typeof lastRequest>('lastRequest', {
      restaurantId: vendor.id, sessionToken: getSessionToken()
    }).then(res => setLastRequest(res.ok ? res.data : null))
  }, [vendor, customer?.id])

  // Everything the customer has built belongs to ONE vendor. Switching vendors
  // used to keep it all: open the pharmacy, photograph a prescription, go back
  // and tap الماركت, and the prescription was still attached -- invisibly,
  // because the upload card only renders for a pharmacy, so there was no sign
  // it was there and no way to remove it. The submit button read "ابعت
  // الروشتة" on a supermarket screen and the server accepted it, because it
  // checks "items OR prescription" and cannot know which shop it is for. Same
  // path sends a grocery list to the pharmacist via the new "الماركت مقفول →
  // روح للصيدلية" button, which only changes the query string.
  const vendorId = vendor?.id ?? null
  const lastVendorRef = useRef<number | null>(null)
  useEffect(() => {
    const prevId = lastVendorRef.current
    if (vendorId !== null) lastVendorRef.current = vendorId

    // Only clear when moving from one REAL vendor to a DIFFERENT one.
    //
    // Keying straight off vendorId destroyed the basket on a path that has
    // nothing to do with switching shops: tapping ← رجوع sets vendor to null,
    // and re-picking the SAME shop from the chooser then read as a change. A
    // customer who went back to check the opening hours lost their whole list.
    // A null in the middle is navigation, not a switch.
    if (prevId === null || vendorId === null || prevId === vendorId) return

    setLines([]); setNotes(''); setSearch(''); setStep('items')
    setRxPath(null)
    setRxPreview(prev => { if (prev) URL.revokeObjectURL(prev); return null })
  }, [vendorId])

  useEffect(() => {
    if (!vendor) return
    supabase.from('menu_items').select('*').eq('restaurant_id', vendor.id).eq('available', true)
      .then(({ data }) => setKnownItems((data as MenuItem[]) ?? []))
    setSlot(null)
    if (vendor.uses_delivery_slots) {
      publicCatalog<Slot[]>('openSlots', { restaurantId: vendor.id })
        .then(res => setSlots(res.ok ? res.data : []))
    } else {
      setSlots([])
    }
  }, [vendor])

  // Tapping a known item is a shortcut for typing its name -- same list, same
  // pricing-by-phone. It is not "adding to a cart".
  function addNamed(itemName: string) {
    setLines(ls => {
      const i = ls.findIndex(l => l.name.toLowerCase() === itemName.toLowerCase())
      if (i === -1) return [...ls, { name: itemName, qty: 1 }]
      const copy = [...ls]; copy[i] = { ...copy[i], qty: copy[i].qty + 1 }; return copy
    })
  }

  const setQty = (i: number, d: number) =>
    setLines(ls => ls.flatMap((l, j) => j !== i ? [l] : (l.qty + d <= 0 ? [] : [{ ...l, qty: l.qty + d }])))

  async function uploadRx(file: File) {
    setError('')
    if (!['image/jpeg','image/png','image/webp','image/avif'].includes(file.type)) {
      setError('لازم تكون صورة'); return
    }
    if (file.size > 5 * 1024 * 1024) { setError('الصورة أكبر من ٥ ميجا'); return }
    setRxUploading(true)
    // The extension comes from the MIME type, which was just validated against a
    // four-item allowlist -- NOT from file.name.
    //
    // `file.name.split('.').pop()` looks like it extracts an extension, but on a
    // name with no dot it returns the WHOLE filename. Android camera captures
    // routinely arrive as "1000012345" with no extension, so the key became
    // "rx-<uuid>.1000012345", which fails the storage policy's
    //   ^rx-[A-Za-z0-9_-]{6,60}\.(jpg|jpeg|png|webp|avif)$
    // and the upload was rejected with "مش قادرين نرفع الصورة، جرب تاني".
    // Reported from a real phone, 2026-08-05.
    const ext = file.type === 'image/png' ? 'png'
      : file.type === 'image/webp' ? 'webp'
      : file.type === 'image/avif' ? 'avif'
      : 'jpg'
    const path = `rx-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}.${ext}`
    const { error: upErr } = await supabase.storage.from('prescriptions').upload(path, file, { upsert: false })
    setRxUploading(false)
    if (upErr) { setError('مش قادرين نرفع الصورة، جرب تاني'); return }
    setRxPath(path)
    // Local preview only. The bucket is private and has no public URL -- this
    // object URL never leaves the customer's own browser.
    setRxPreview(URL.createObjectURL(file))
  }

  useEffect(() => {
    const code = promoCode.trim().toUpperCase()
    if (!code || !vendor?.id || !compoundId) { setPromoQuote(null); setPromoChecking(false); return }
    let cancelled = false
    const timer = setTimeout(async () => {
      setPromoChecking(true)
      const { data, error } = await supabase.rpc('quote_promo_code', {
        p_code: code, p_restaurant_id: vendor.id, p_compound_id: compoundId,
        p_subtotal: 0, p_delivery_fee: 0, p_service_fee: 0,
      })
      if (!cancelled) { setPromoQuote(error ? { valid: false, reason: 'promo_invalid' } : data as PromoQuote); setPromoChecking(false) }
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [promoCode, vendor?.id, compoundId])

  const selectedCompound = compounds.find(c => c.id === compoundId)
  const { fee: deliveryFee, quote, loading: feeLoading, failed: feeFailed, retry: retryFee } =
    useDeliveryQuote(compoundId)
  const scheduled = !!vendor?.uses_delivery_slots

  // Only real products are searchable or addable. is_shelf_label is now a real
  // column, so this is no longer the `name !== category` guess -- which still
  // let "أدوية بروشتة" through, because its category is "أدوية".
  const products = knownItems.filter(it => !it.is_shelf_label)

  const searchQ = search.trim().toLowerCase()
  const matches = searchQ
    ? products.filter(it => it.name.toLowerCase().includes(searchQ)).slice(0, 6)
    : []
  const exactMatch = matches.some(it => it.name.trim().toLowerCase() === searchQ)

  /** Catalogue price for a line, or null when we genuinely do not know it. */
  const priceOf = (lineName: string) => {
    const hit = products.find(it => it.name.trim().toLowerCase() === lineName.trim().toLowerCase())
    // `?? null` would let a price of 0 through as a known price: the line would
    // render a confident "0 ج.م", drop out of the unpriced count, and the card
    // would claim the whole basket was priced. No such row exists today, but
    // the pharmacy has no orderable products at all yet and the add-item form
    // accepts "0" -- so the first products added there are exactly where this
    // would land. A zero price means nobody has priced it.
    return hit && hit.price > 0 ? hit.price : null
  }

  // An estimate, and labelled as one everywhere it appears. Four of the eight
  // supermarket rows carry a real price; hiding them made every order
  // unknowable for no reason. The unpriced lines say so on their own row, so
  // the "we call you with the price" promise is not quietly broken.
  const knownSubtotal = lines.reduce((sum, l) => {
    const p = priceOf(l.name)
    return p === null ? sum : sum + p * l.qty
  }, 0)
  const unpricedCount = lines.filter(l => priceOf(l.name) === null).length

  // The server-side quote snapshot charges the same service fee as checkout,
  // on the same subtotal-only base and rounding. This remains an estimate here;
  // the customer sees the immutable authoritative total only in the offer.
  //
  // The percentage and its ceiling come from the server, never a hardcoded 0.08
  // -- same rule as CartPage and CheckoutPage. serviceFeeFor returns null while
  // either is unknown, and null is rendered as «…» rather than folded into the
  // total as a zero, which would understate it exactly as before.
  const { policy: serviceFeePolicy } = useServiceFeePolicy()
  const serviceFee = serviceFeeFor(knownSubtotal, serviceFeePolicy)

  // selectedCompound, not compoundId. CheckoutPage already learned this: a
  // stored id whose compound has since been deactivated passes a truthiness
  // check, renders a blank المكان select, and submits p_zone: ''.
  const addressComplete = !!(name.trim() && isValidEgyptPhone(phone) && selectedCompound && unit.trim())
  // A prescription IS an order. It already contains everything the pharmacist
  // needs, so making someone also transcribe the medicine names -- probably
  // misspelt -- was asking for the same information twice. The server enforces
  // the same rule (items OR prescription), so this cannot drift.
  const hasSomethingToOrder = lines.length > 0 || !!rxPath
  const valid = vendor && addressComplete
    && hasSomethingToOrder && deliveryFee !== null && (!scheduled || !!slot)

  // Collapse only for someone whose details we actually have. A guest, or a
  // signed-in customer with a gap (no saved unit number yet), still gets the
  // form -- a summary card with a blank in it is worse than the form.
  const collapsedAddress = !addressExpanded && !!customer && addressComplete && !!selectedCompound

  async function submit() {
    if (!vendor || !valid) return
    setSaving(true); setError('')
    const result = await customerOrderCreation<{ token: string; id: number }>('custom', {
      restaurantId: vendor.id,
      customerName: name.trim(),
      customerPhone: phone.trim(),
      zone: selectedCompound?.name ?? '',
      unitNumber: unit.trim(),
      addressNotes: addrNotes.trim(),
      deliveryFee: deliveryFee ?? 0, // server recomputes and ignores this
      items: lines,
      requestNotes: notes.trim(),
      compoundId,
      promoCode: promoCode.trim().toUpperCase() || null,
      sessionToken: getSessionToken(),
      slotId: slot?.id ?? null,
      scheduledDate: slot?.scheduled_date ?? null,
      prescriptionPath: rxPath
    })
    const data = result.ok ? result.data : null
    const err = result.ok ? null : { message: result.code }
    if (!result.ok || !data?.token) {
      setSaving(false)
      setError(err?.message.includes('slot_full') ? 'الفترة دي اتملت، اختار فترة تانية' : 'حصل خطأ، جرب تاني')
      return
    }
    localStorage.setItem('salka_phone', phone.trim())
    rememberLiveOrder(String(data.token))
    nav(`/track/${data.token}`)
  }

  // Step 1 -- pick the vendor
  if (!vendor) {
    // Salka's own two errands lead, always. They are the reason this tab
    // exists; the brands underneath are the extras. Server order put them
    // wherever the query happened to return them, so «صيدلية» could sit sixth.
    const ERRAND_FIRST = ['supermarket', 'pharmacy']
    const rank = (v: Restaurant) => {
      const i = ERRAND_FIRST.indexOf(v.vendor_type ?? '')
      return i === -1 ? ERRAND_FIRST.length : i
    }
    const shownVendors = (typeFilter ? vendors.filter(v => v.vendor_type === typeFilter) : vendors)
      .slice().sort((a, b) => rank(a) - rank(b))
    const pharmacyOpen = vendors.some(v => v.vendor_type === 'pharmacy')
    const nextClosedOpening = closedVendorOpenings
      .filter(v => !typeFilter || v.vendor_type === typeFilter)
      .sort((a, b) => {
        const aTime = a.next_open_at ? Date.parse(a.next_open_at) : Number.POSITIVE_INFINITY
        const bTime = b.next_open_at ? Date.parse(b.next_open_at) : Number.POSITIVE_INFINITY
        return aTime - bTime
      })[0]
    const openingText = nextClosedOpening
      ? openLabel({ is_open: false, next_open_at: nextClosedOpening.next_open_at }).text
      : null

    return (
      <div>
        {/* A gradient band, bleeding to the screen edges and fading into the
            page. This tab is the one screen with no photography at all -- a
            plain heading over a list of logos had nothing carrying it -- so the
            surface does the work instead of a bigger typeface.

            cream to transparent, not a new colour: the token already exists
            and the band has to end in the page's own white or it reads as a
            block with a hard edge rather than a header. The van glyph is the
            same one the tab bar uses for this destination. */}
        <div className="-mx-4 -mt-6 mb-4 px-4 pt-8 pb-5 bg-gradient-to-b from-shellup to-night">
          <span className="w-11 h-11 rounded-2xl bg-white/70 text-[#6B4A18] grid place-items-center mb-2.5">
            <Icon name="van" size="lg" />
          </span>
          <h1 className="text-xl font-bold leading-tight">
            {typeFilter === 'pharmacy' ? 'الصيدلية' : typeFilter === 'supermarket' ? 'السوبر ماركت' : 'محتاج إيه دلوقتي؟'}
          </h1>
          <p className="text-mist text-[13px] mt-1">قول لنا اللي محتاجه، وإحنا هنجهزه معاك</p>
        </div>

        {loadFailed && (
          <div className="card p-4 mb-4 border-coral-300 bg-coral-100">
            <p className="text-sm text-coral-700 font-semibold"><Icon name="broadcast" size="sm" className="inline-block align-[-0.15em] me-1" />مش قادرين نحمّل المحلات دلوقتي</p>
            <p className="text-xs text-mist mt-1">اتأكد إن النت شغال، ده مش معناه إن كله مقفول.</p>
          </div>
        )}

        {/* Rebuilt as answer-shaped cards rather than two emoji tiles.
            The old chooser was a screen that ASKED a question ("pharmacy or
            market?") while withholding every fact needed to answer it: whether
            the shop is open, what delivery costs, how long it takes, what it
            even sells. Worse, the supermarket's mandatory delivery slot was
            invisible until the customer was inside with half a list written.
            Each card now carries its own status, fee, timing and range. */}
        <div className="space-y-3">
          {shownVendors.map(v => {
            // Slotted or not, NOT market or not: a market with slots turned off
            // delivers as soon as it is picked, exactly like the pharmacy, and
            // must say so on the card rather than promising windows it no
            // longer has.
            const usesSlots = !!v.uses_delivery_slots
            const vSlots = vendorSlots[v.id] ?? []
            const next = vSlots[0]
            const today = next?.scheduled_date === cairoToday()
            // Same arithmetic as the home card: prep plus the compound's own
            // travel window, never a constant.
            const eta = selectedCompound
              ? { min: v.prep_minutes + selectedCompound.est_travel_minutes_min,
                  max: v.prep_minutes + selectedCompound.est_travel_minutes_max }
              : null
            return (
              <button key={v.id}
                className="card px-2.5 py-2.5 w-full text-right flex items-center gap-2.5 hover:border-sea/40 transition-colors"
                onClick={() => setVendor(v)}>
                {/* Salka's OWN two errand destinations get an icon; every other
                    vendor in this list is a real brand and keeps its logo.
                    «صيدلية» and «سوبرماركت» are categories we operate, not shops a
                    customer recognises by their mark -- Krispy Kreme, Costa and KFC
                    are the opposite, and stripping their logos made them harder to
                    find, not more consistent. */}
                <span className="w-10 h-10 rounded-lg overflow-hidden grid place-items-center shrink-0 border border-line"
                  style={(v.vendor_type === 'pharmacy' || v.vendor_type === 'supermarket')
                    ? { background: VENDOR_TYPE_ART[v.vendor_type].tint,
                        color: VENDOR_TYPE_ART[v.vendor_type].ink }
                    : { background: '#F4EEE3' }}>
                  {v.vendor_type === 'pharmacy' || v.vendor_type === 'supermarket'
                    ? <Icon name={VENDOR_TYPE_ART[v.vendor_type].icon} size="lg" />
                    : v.logo_url
                        ? <img src={v.logo_url} alt="" loading="eager" className="w-full h-full object-cover"
                            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                        : <Icon name="storefront" size="lg" className="text-mist" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5 min-w-0">
                    <span className="font-bold text-[15px] truncate leading-tight">{v.name}</span>
                    {/* «مفتوحة» carried no information: a shop that is closed is not
                        in this list at all, so the badge was true of every row and
                        told you nothing. «فترات محددة» stays -- that one is a real
                        difference between two rows. */}
                    {usesSlots && (
                      <span className="shrink-0 text-[10px] font-bold text-mist bg-shellup border border-line rounded px-1.5 py-0.5">فترات محددة</span>
                    )}
                  </span>
                  {v.description && (
                    <span className="block text-xs text-mist mt-0.5 truncate">{v.description}</span>
                  )}
                  {/* The same meta row as the home card: rating, time, category,
                      one weight, bullets between. The fee is gone from here for
                      the reason it left the home card -- it belongs to the
                      compound, is identical on every row, and is already stated
                      in the header above.

                      The TIME still waits for a compound. prep_minutes + a
                      constant treats the drive as fixed on a coast that runs
                      31km, so an unlocated customer was quoted a time we cannot
                      know. A fixed slot is different: it is the vendor's own
                      schedule and holds wherever you are. */}
                  <span className="flex items-center gap-1.5 text-[13px] text-mist flex-wrap mt-0.5">
                    {(v.review_count ?? 0) > 0 && (
                      <>
                        <span className="flex items-center gap-1">
                          <Icon name="star" size="xs" className="text-coral-600" />
                          <span className="text-foam">{v.rating_real ?? v.rating}</span>
                        </span>
                        <span aria-hidden="true" className="text-slate-300">•</span>
                      </>
                    )}
                    {eta ? (
                      <span className="flex items-center gap-1">
                        <Icon name="clock" size="xs" className="text-mist" />
                        <span className="text-seadeep"><bdi dir="ltr">{eta.min} – {eta.max}</bdi> د</span>
                      </span>
                    ) : (
                      <span>الوقت حسب مكانك</span>
                    )}
                    {v.category && (
                      <>
                        <span aria-hidden="true" className="text-slate-300">•</span>
                        <span className="truncate">{v.category}</span>
                      </>
                    )}
                    {usesSlots && (
                      <>
                        <span aria-hidden="true" className="text-slate-300">•</span>
                        <span>{next
                          ? `أقرب فترة ${today ? '' : 'بكرة '}${next.start_time.slice(0, 5)}`
                          : 'مفيش فترات دلوقتي'}</span>
                      </>
                    )}
                  </span>
                </span>
              </button>
            )
          })}

          {shownVendors.length === 0 && (
            <div className="card p-6 text-center">
              <p className="font-semibold">مقفول دلوقتي</p>
              <p className="text-sm text-mist mt-1 mb-4">
                {typeFilter === 'supermarket' && pharmacyOpen
                  ? 'الماركت بيفتح في مواعيد محددة، بس الصيدلية شغالة دلوقتي.'
                  : openingText ?? 'الصيدلية والماركت بيفتحوا في مواعيد محددة. جرب تاني بعد شوية.'}
              </p>
              {/* An empty list used to be a screen with nothing on it and
                  nowhere to go. When one of the two is closed the other is
                  usually the nearest thing to what they came for, so say so
                  instead of leaving them to work it out. */}
              {typeFilter === 'supermarket' && pharmacyOpen ? (
                <button className="btn-sea !py-2 !px-5 text-sm" onClick={() => nav('/custom-order?type=pharmacy')}>
                  روح للصيدلية
                </button>
              ) : (
                <button className="btn-sea !py-2 !px-5 text-sm" onClick={() => nav('/')}>شوف المطاعم</button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Step 2 -- one simple list, no fake matching
  return (
    <div className="pb-6">
      {/* This always returns to the supermarket/pharmacy chooser. It is a
          destination choice, not browser history, so it stays predictable on
          a cold start and after a redirect. */}
      <div className="-mx-4 -mt-6 mb-4 px-4 pt-4 pb-5 bg-gradient-to-b from-shellup to-night">
        <button aria-label="اختيار متجر آخر" title="اختيار متجر آخر"
          className="grid place-items-center min-w-[44px] min-h-[44px] -mr-2.5 mb-1"
          onClick={() => setVendor(null)}>
          <span className="w-8 h-8 rounded-full bg-white/70 text-slate-700 grid place-items-center">
            <Icon name="chevronLeft" size="sm" className="rotate-180" />
          </span>
        </button>
        <div className="flex items-center gap-3">
          <span className="w-12 h-12 rounded-xl overflow-hidden grid place-items-center shrink-0 bg-white/70 border border-line">
            {vendor.vendor_type === 'pharmacy' || vendor.vendor_type === 'supermarket'
              ? <Icon name={VENDOR_TYPE_ART[vendor.vendor_type].icon} size="lg"
                  className="text-[#6B4A18]" />
              : vendor.logo_url
                  ? <img src={vendor.logo_url} alt="" className="w-full h-full object-cover" />
                  : <Icon name="storefront" size="lg" className="text-mist" />}
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate leading-tight">{vendor.name}</h1>
          </div>
        </div>
      </div>

      {step === 'items' ? (
        <>
      {/* A prescription is a complete order, so it goes FIRST -- ahead of the
          search box, the chips and the list. It is the shortest possible
          pharmacy order (one photo, zero typing) and it used to sit below the
          category chips where most people never scrolled. */}
      {vendor.vendor_type === 'pharmacy' && (
        <div className="card p-4 mb-4 border-sea/40 bg-sea/[0.04]">
          {rxPreview ? (
            <div className="flex items-center gap-3">
              <img src={rxPreview} alt="الروشتة" className="w-14 h-14 rounded-xl object-cover border border-line shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-success">الروشتة اترفعت<Icon name="check" size="xs" className="inline-block align-[-0.15em] ms-1" /></p>
                <p className="text-xs text-mist mt-0.5">الصيدلي هيقراها ويتصل بيك بالسعر</p>
              </div>
              <button className="btn-ghost !py-1.5 !px-3 text-xs shrink-0"
                onClick={() => { setRxPath(null); setRxPreview(null) }}>شيلها</button>
            </div>
          ) : (
            <>
              <p className="font-bold text-sm"><Icon name="camera" size="sm" className="inline-block align-[-0.15em] me-1" />عندك روشتة؟</p>
              <p className="text-xs text-mist mt-1 mb-3">
                صوّرها وابعتها، مش محتاج تكتب أي حاجة تانية.
              </p>
              <input type="file" accept="image/jpeg,image/png,image/webp,image/avif"
                capture="environment" disabled={rxUploading}
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadRx(f) }}
                className="text-sm" />
              {rxUploading && <p className="text-xs text-mist mt-1">جاري الرفع…</p>}
            </>
          )}
        </div>
      )}

      {/* The slot picker used to sit between the notes field and the address,
          two thirds of the way down. Supermarket is the only flow that requires
          one, so a customer who had already written a full list met a mandatory
          step they had no warning about -- and the submit button stayed dead
          with the explanation scrolled off screen. It is now the second thing
          on the page, framed as a choice rather than a blocker. */}
      {/* A closed market used to be one grey sentence, after which the
          customer could still write a full shopping list against an order that
          would never be accepted. It is a state with two good answers -- book
          the first slot tomorrow, or go to the pharmacy, which is usually open
          and is the nearest thing to what they came for -- so offer both. */}
      {scheduled && slots.length === 0 && (
        <div className="card p-4 mb-4 border-coral-300 bg-coral-100">
          <p className="font-bold text-sm text-coral-700">الماركت مقفول دلوقتي</p>
          <p className="text-xs text-mist mt-1 mb-3">
            الماركت بيوصل في فترات محددة ومفيش فترة متاحة دلوقتي. جرب بكرة الصبح،
            أو الصيدلية شغالة دلوقتي.
          </p>
          <button className="btn-sea w-full !py-2.5 text-sm"
            onClick={() => nav('/custom-order?type=pharmacy')}>
            روح للصيدلية
          </button>
        </div>
      )}

      {scheduled && (
        <div className="mb-4">
          <h2 className="font-bold mb-1">فترة التوصيل</h2>
          <p className="text-xs text-mist mb-2">
            الماركت بيوصل في فترات محددة، فاختار فترة الأول عشان نعرف نجهّزلك.
          </p>
          {slots.length === 0 && (
            <p className="text-sm text-coral-700">
              مفيش فترات متاحة دلوقتي. جرب بكرة الصبح.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {slots.map(sl => {
              const on = slot?.id === sl.id && slot?.scheduled_date === sl.scheduled_date
              const today = sl.scheduled_date === cairoToday()
              return (
                <button key={`${sl.id}-${sl.scheduled_date}`}
                  aria-pressed={on}
                  className={`card p-3 text-right ${on ? 'border-sea' : ''}`}
                  onClick={() => setSlot(sl)}>
                  <p className="text-sm font-semibold"><bdi dir="ltr">{sl.start_time.slice(0, 5)}–{sl.end_time.slice(0, 5)}</bdi></p>
                  <p className="text-xs text-mist mt-0.5">{today ? 'النهاردة' : 'بكرة'} • باقي {sl.remaining}</p>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* SEARCH, not categories.
          Categories made the customer guess which shelf their thing lives on
          before they were allowed to see it -- and the shelf names themselves
          leaked onto orders ("أدوية بروشتة × 1", a real order today). Search
          works from the first letter and, when nothing matches, offers to add
          exactly what was typed. Free text still works; it is the fallback now
          rather than the only road.

          Only products are searchable. is_shelf_label is a real column now, so
          this is no longer the `name !== category` guess that still let
          "أدوية بروشتة" through. */}
      <div className="mb-4">
        <label className="label" htmlFor={`${fid}-1`}>عايز إيه؟</label>
        <div className="relative">
          <input id={`${fid}-1`} className="field !pr-10" value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              const typed = search.trim()
              const first = matches[0]
              // The old addDraft() opened with `if (!t) return`; losing that
              // guard meant Enter on an empty box added a nameless line with
              // qty 1 -- which counted towards "1 صنف", satisfied the submit
              // check, and reached the vendor as an order line with no name.
              if (!first && !typed) return
              addNamed(first && !exactMatch ? first.name : typed)
              setSearch('')
            }}
            placeholder={vendor.vendor_type === 'pharmacy' ? 'دوّر على دوا أو منتج…' : 'دوّر على منتج…'} />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-mist pointer-events-none"><Icon name="magnifyingGlass" size="sm" /></span>
        </div>

        {searchQ && (
          <div className="card divide-y divide-line mt-2">
            {matches.map(it => {
              const added = lines.some(l => l.name.toLowerCase() === it.name.toLowerCase())
              return (
                <button key={it.id} className="w-full flex items-center gap-2 px-3 py-2.5 text-right"
                  onClick={() => { addNamed(it.name); setSearch('') }}>
                  <span className="flex-1 min-w-0 text-sm truncate">{it.name}</span>
                  {it.price > 0 && <span className="text-xs font-bold text-sea shrink-0">{it.price} ج.م</span>}
                  <span className={`w-7 h-7 rounded-lg grid place-items-center shrink-0 text-sm ${
                    added ? 'bg-sea/10 text-sea' : 'bg-sea text-white'}`}><Icon name={added ? 'check' : 'plus'} size="sm" /></span>
                </button>
              )
            })}
            {/* Always offered, never hidden behind "no results". The catalogue
                has 13 rows; almost everything a customer wants is not in it. */}
            {!exactMatch && (
              <button className="w-full flex items-center gap-2 px-3 py-2.5 text-right"
                onClick={() => { addNamed(search.trim()); setSearch('') }}>
                <span className="flex-1 min-w-0 text-sm text-mist truncate">
                  {matches.length === 0 ? 'مش في القايمة، ' : ''}ضيف «<b className="text-foam">{search.trim()}</b>» زي ما كتبته
                </span>
                <span className="w-7 h-7 rounded-lg grid place-items-center shrink-0 text-sm bg-shellup text-foam">+</span>
              </button>
            )}
          </div>
        )}

        {/* One-tap starting points for someone who does not know what to write.
            Server-ranked by what people actually ordered, falling back to real
            products; shelf labels are excluded on both sides. Empty for the
            pharmacy until history exists, which is honest -- better an absent
            row than five fake suggestions. */}
        {!searchQ && popular.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-mist mb-2">الأكتر طلبًا</p>
            <div className="flex flex-wrap gap-2">
              {popular.map(nm => {
                const added = lines.some(l => l.name.toLowerCase() === nm.toLowerCase())
                return (
                  <button key={nm}
                    className={`rounded-full border px-3 min-h-[36px] text-xs font-semibold transition-colors ${
                      added ? 'border-sea bg-sea/10 text-sea' : 'border-line bg-shell text-foam'}`}
                    onClick={() => addNamed(nm)}>
                    <Icon name={added ? 'check' : 'plus'} size="xs" className="inline-block align-[-0.15em] me-1" />{nm}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Reordering is the single most useful thing we can offer a repeat
            customer of a shop like this -- people rebuy the same things. Only
            shown to someone we can identify; my_last_request refuses to answer
            to a typed phone number. */}
        {!searchQ && lines.length === 0 && lastRequest && lastRequest.request_items?.length > 0 && (
          <button className="card p-3 mt-3 w-full text-right flex items-center gap-3 border-sea/30"
            onClick={() => lastRequest.request_items.forEach(it => {
              for (let n = 0; n < Math.max(1, it.qty); n++) addNamed(it.name)
            })}>
            <Icon name="arrowCounterClockwise" size="md" className="shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-bold">اطلب زي المرة اللي فاتت</span>
              <span className="block text-xs text-mist truncate mt-0.5">
                {lastRequest.request_items.map(it => it.name).join(' • ')}
              </span>
            </span>
          </button>
        )}
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <label className="label !mb-0">قايمتك</label>
          {lines.length > 0 && <span className="text-xs text-mist">{lines.length} صنف</span>}
        </div>

        {lines.length === 0 && (
          <p className="text-xs text-mist mb-2">
            {rxPath
              ? 'الروشتة لوحدها كفاية، تقدر تبعت كده، أو تضيف حاجات تانية فوق.'
              : 'دوّر فوق أو اكتب اللي محتاجه، كل صنف لوحده عشان اللي بيجهّز يقدر يشطبه.'}
          </p>
        )}

        {lines.map((l, i) => {
          const price = priceOf(l.name)
          return (
            <div key={i} className="flex items-center gap-2 card p-2.5 mb-2">
              <span className="flex-1 min-w-0">
                <span className="block text-sm truncate">{l.name}</span>
                {/* Says which of the two kinds of line this is, on the line
                    itself. A price here is the catalogue price; no price means
                    the phone call decides, and it should say so rather than
                    leave a silent gap. */}
                <span className="block text-[11px] mt-0.5">
                  {price !== null
                    ? <span className="text-sea font-semibold">{price} ج.م</span>
                    : <span className="text-coral-700">السعر بالمكالمة</span>}
                </span>
              </span>
              <div className="flex items-center gap-1 bg-shellup rounded-lg p-1 shrink-0">
                <button className="w-8 h-8 rounded-md grid place-items-center" aria-label="تقليل"
                  onClick={() => setQty(i, -1)}>−</button>
                <span className="font-bold text-sm w-6 text-center">{l.qty}</span>
                <button className="w-8 h-8 rounded-md grid place-items-center bg-sea text-white" aria-label="زيادة"
                  onClick={() => setQty(i, +1)}>+</button>
              </div>
              <button className="w-9 h-9 grid place-items-center text-mist shrink-0" aria-label="حذف"
                onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}><Icon name="x" size="sm" /></button>
            </div>
          )
        })}

        {/* An estimate, labelled as one in three places. Four of the eight
            supermarket rows carry a real price and the old screen hid every one
            of them, so a basket of entirely-known items was still presented as
            a total mystery. The unpriced count is stated rather than folded in,
            so "تقريبًا" cannot be mistaken for a quote. */}
        {lines.length > 0 && knownSubtotal > 0 && (
          <div className="card p-3.5 bg-shellup border-none mt-1">
            <div className="flex justify-between text-sm py-0.5">
              <span className="text-mist">الأصناف المعروفة</span>
              <span>{Math.round(knownSubtotal * 100) / 100} ج.م</span>
            </div>
            {deliveryFee !== null && (
              <div className="flex justify-between text-sm py-0.5">
                <span className="text-mist">التوصيل</span><span>{deliveryFee} ج.م</span>
              </div>
            )}
            <div className="flex justify-between text-sm py-0.5">
              <span className="text-mist">رسوم الخدمة</span>
              <span>
                {serviceFee !== null
                  ? `${serviceFee} ج.م${unpricedCount > 0 ? ' +' : ''}`
                  : <span className="text-mist">…</span>}
              </span>
            </div>
            {unpricedCount > 0 && (
              <div className="flex justify-between text-sm py-0.5 text-coral-700">
                <span>{unpricedCount === 1 ? 'صنف واحد لسه بالمكالمة' : `${unpricedCount} أصناف لسه بالمكالمة`}</span>
                <span>؟</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold border-t border-line mt-1.5 pt-2">
              <span>تقريبًا</span>
              {/* The '+' now also fires when the service fee is still unknown --
                  the total is genuinely incomplete then, and a bare number would
                  read as final. */}
              <span>
                {Math.round((knownSubtotal + (deliveryFee ?? 0) + (serviceFee ?? 0)) * 100) / 100} ج.م
                {unpricedCount > 0 || serviceFee === null ? ' +' : ''}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="mb-4">
        <label className="label" htmlFor={`${fid}-notes`}>ملاحظات (اختياري)</label>
        <input id={`${fid}-notes`} className="field" value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="مثال: لو مش موجود، جيب أي بديل" />
      </div>

          {/* The whole point of the split: this screen ends here. Someone
              ordering one box of paracetamol no longer scrolls past six
              delivery fields to reach a button. */}
          {/* The slot picker lives on THIS step, so the slot has to be chosen
              before moving on -- otherwise step two shows a dead send button
              next to a hint pointing "فوق" at a picker on the previous
              screen. */}
          <button className="btn-sea w-full !py-3.5"
            disabled={!hasSomethingToOrder || (scheduled && !slot)}
            onClick={() => setStep('address')}>
            {!hasSomethingToOrder
              ? (vendor.vendor_type === 'pharmacy' ? 'ضيف صنف أو صوّر الروشتة' : 'ضيف اللي محتاجه الأول')
              : scheduled && slots.length === 0 ? 'مفيش فترات متاحة'
              : scheduled && !slot ? 'اختار فترة التوصيل'
              : addressComplete ? 'كمّل الطلب' : 'كمّل، فين نوصّله؟'}
          </button>
        </>
      ) : (
        <>
          {/* Final check before send: the address card answers “where?”, this
              matching card answers “what?”. It is deliberately a compact
              summary, not the former duplicate vendor recap. */}
          <button type="button" className="w-full card p-4 mb-4 text-right flex items-start gap-3 border-sea/40"
            onClick={() => setStep('items')}>
            <Icon name="basket" size="md" className="shrink-0 mt-0.5" />
            <span className="flex-1 min-w-0">
              <span className="block font-bold text-sm">طلبك</span>
              <span className="block text-xs text-mist mt-1 leading-5">
                {rxPath && <span className="block">روشتة مرفوعة</span>}
                {lines.map(item => <span key={item.name} className="block truncate">{item.name} <bdi dir="ltr">×{item.qty}</bdi></span>)}
              </span>
            </span>
            <span className="text-sea text-xs font-semibold shrink-0 mt-1"><Icon name="pencilSimple" size="xs" className="inline-block align-[-0.15em] me-0.5" />تغيير</span>
          </button>

      {/* Six fields collapse to one line as soon as we already know the answers.
          A signed-in customer with a saved address sees a summary and a تغيير
          button; the inputs only exist for someone we have never met, or for
          someone changing something. */}
      {collapsedAddress ? (
        <button type="button" className="w-full card p-4 mb-4 text-right flex items-start gap-3 border-sea/40"
          onClick={() => setAddressExpanded(true)}>
          <Icon name="locationDot" size="md" className="shrink-0 mt-0.5" />
          <span className="flex-1 min-w-0">
            <span className="block font-bold text-sm">{selectedCompound?.name} • {unit}</span>
            <span className="block text-xs text-mist mt-0.5 truncate">{name} • <span dir="ltr">{phone}</span></span>
          </span>
          <span className="text-sea text-xs font-semibold shrink-0 mt-1"><Icon name="pencilSimple" size="xs" className="inline-block align-[-0.15em] me-0.5" />تغيير</span>
        </button>
      ) : (
        <div className="card p-4 mb-4 space-y-3">
          <h2 className="font-bold">عنوان التوصيل</h2>

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
                        setAddrNotes(a.notes ?? '')
                        setAddressExpanded(false)
                      }}>
                      <span className="block text-sm font-bold">{a.label || a.compound_name}</span>
                      <span className="block text-xs text-mist">{a.compound_name} • {a.unit_number}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div><label className="label" htmlFor={`${fid}-2`}>الاسم *</label>
            <input id={`${fid}-2`} className="field" value={name} onChange={e => { nameEdited.current = true; setName(e.target.value) }} placeholder="الاسم بالكامل" /></div>
          <div><label className="label" htmlFor={`${fid}-3`}>رقم الموبايل *</label>
            <input id={`${fid}-3`} className={`field ${phone.trim() && !isValidEgyptPhone(phone) ? '!border-dangerline' : ''}`}
              dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01xxxxxxxxx" maxLength={13} />
            {phone.trim() && !isValidEgyptPhone(phone) && <p className="text-xs text-danger mt-1">{PHONE_HINT}</p>}</div>
          <div><label className="label" htmlFor={`${fid}-4`}>المكان *</label>
            <select id={`${fid}-4`} className="field" value={compoundId ?? ''} onChange={e => setCompoundId(Number(e.target.value) || null)}>
              <option value="">اختر مكانك…</option>
              {compounds.map(c => <option key={c.id} value={c.id}>{c.name} (~{c.est_travel_minutes} د)</option>)}
            </select></div>
          <div><label className="label" htmlFor={`${fid}-5`}>رقم الشاليه / الفيلا *</label>
            <input id={`${fid}-5`} className="field" value={unit} onChange={e => setUnit(e.target.value)} placeholder="مثال: B4 - 204" /></div>

          {/* Optional, and behind a disclosure. It was a permanent sixth field
              that almost everyone left blank and everyone had to scroll past. */}
          {/* Also open whenever there is already a landmark to show -- a saved
              address can carry one, and a value that is submitted but invisible
              is worse than no disclosure at all. */}
          {showLandmark || addrNotes.trim() ? (
            <div><label className="label" htmlFor={`${fid}-6`}>علامة مميزة</label>
              <input id={`${fid}-6`} className="field" value={addrNotes} onChange={e => setAddrNotes(e.target.value)} placeholder="مثال: بجوار حمام السباحة" /></div>
          ) : (
            <button type="button" className="text-xs text-sea font-semibold" onClick={() => setShowLandmark(true)}>
              + ضيف علامة مميزة (اختياري)
            </button>
          )}
        </div>
      )}

      {/* Delivery is known up front even though the items aren't priced yet --
          the customer used to first see this charge on the tracking page. */}
      {/* When the estimate is present it already contains delivery, so repeating
          it in a second card makes the same charge look like it may be added
          twice. Keep the standalone fee only when there is no estimate yet. */}
      {compoundId && !(lines.length > 0 && knownSubtotal > 0) && (
        <div className="card p-3.5 mb-3">
          <div className="flex justify-between text-sm">
            <span className="text-mist">رسوم التوصيل{quote ? ` لـ ${quote.compound_name}` : ''}</span>
            <span className="font-semibold">
              {deliveryFee !== null ? `${deliveryFee} ج.م`
                : feeLoading ? '…'
                : <button className="text-sea underline" onClick={retryFee}>إعادة المحاولة</button>}
            </span>
          </div>
        </div>
      )}

      <p className="text-sm text-mist bg-shellup/60 rounded-xl p-3 mb-4">
        <Icon name="chatCircle" size="sm" className="inline-block align-[-0.15em] me-1" />لسه مش هتدفع حاجة دلوقتي. هنتصل بيك بسعر الأصناف وتقرر وقتها.
      </p>

      {/* priceKnown={false}: there is no price yet, so no honest saving to show.
          The card promises when the discount lands instead of quoting a number
          that would change the moment staff send the quote. */}
      <PromoSection
        basket={{ restaurantId: vendor?.id ?? null, compoundId, subtotal: 0, deliveryFee: 0, serviceFee: 0 }}
        code={promoCode}
        quote={promoQuote}
        checking={promoChecking}
        priceKnown={false}
        onApply={setPromoCode}
        onRemove={() => { setPromoCode(''); setPromoQuote(null) }}
      />

      {feeFailed && compoundId && (
        <p className="text-sm text-danger bg-dangerbg rounded-xl p-3 mb-4">
          مش قادرين نحسب رسوم التوصيل دلوقتي.{' '}
          <button className="underline font-semibold" onClick={retryFee}>جرب تاني</button>
        </p>
      )}

      <p className="text-xs text-mist text-center mb-4">
        عنوان الطلب بيتثبت وقت الإرسال؛ تعديل حسابك بعد كده بيأثر على الطلبات الجديدة بس.
      </p>

      {error && <p className="text-sm text-danger bg-dangerbg rounded-xl p-3 mb-4">{error}</p>}

      {/* The reason a disabled button is disabled belongs next to the button.
          A supermarket order with no open slot used to sit behind a dead
          'إرسال الطلب' whose only explanation was several sections further up
          the page, unconnected to it. */}
      {scheduled && slots.length === 0 && (
        <p className="text-sm text-coral-700 bg-coral-100 rounded-xl p-3 mb-3">
          مفيش فترات توصيل متاحة دلوقتي، فمش هينفع نستقبل الطلب. جرب بكرة الصبح.
        </p>
      )}
      {scheduled && slots.length > 0 && !slot && hasSomethingToOrder && (
        <p className="text-sm text-mist bg-shellup/60 rounded-xl p-3 mb-3">
          <button className="underline font-semibold" onClick={() => setStep('items')}>
            ارجع اختار فترة التوصيل
          </button>{' '}عشان تكمل
        </p>
      )}

      <button className="btn-sea w-full !py-3.5" disabled={!valid || saving} onClick={submit}>
        {saving ? 'جاري الإرسال…'
          : deliveryFee === null && compoundId ? 'بنحسب التوصيل…'
          : scheduled && slots.length === 0 ? 'مفيش فترات متاحة'
          // A scheduled order sent with a button that just says "ابعت الطلب"
          // reaches a customer who thinks it is coming now. Name the moment.
          : scheduled && slot
            ? `ابعت الطلب، التسليم ${slot.scheduled_date === cairoToday() ? 'النهاردة' : 'بكرة'} ${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`
          : rxPath && lines.length === 0 ? 'ابعت الروشتة، هيوصلك إشعار بالسعر'
          : 'ابعت الطلب، هيوصلك إشعار بالسعر'}
      </button>
        </>
      )}
    </div>
  )
}
