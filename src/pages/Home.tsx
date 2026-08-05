import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useDismissable } from '../lib/useDismissable'
import { haversineKm } from '../lib/geo'
import { useDeliveryQuote } from '../lib/deliveryQuote'
import { BROWSE_KINDS, vendorKind, type VendorKind } from '../lib/categoryArt'
import Icon from '../components/Icon'
import BannerRail from '../components/BannerRail'
import RestaurantCard from '../components/RestaurantCard'
import type { Compound, Discount, Restaurant } from '../lib/types'
import { getCompoundId, setCompoundId as setStoredCompoundId } from '../lib/place'

const STORAGE_KEY = 'salka_compound_id'

export default function Home() {
  const [compounds, setCompounds] = useState<Compound[]>([])
  const [compoundId, setCompoundId] = useState<number | null>(null)
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [discountedRestaurantIds, setDiscountedRestaurantIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [picking, setPicking] = useState(false)
  // In the URL for the same reason as the restaurant categories: on a phone,
  // Back is how people undo a filter, and as state it would instead take them
  // off the home screen entirely.
  const [searchParams, setSearchParams] = useSearchParams()
  const kind = (searchParams.get('kind') as VendorKind | null) || null
  const setKind = (k: VendorKind | null) => {
    const next = new URLSearchParams(searchParams)
    if (k) next.set('kind', k); else next.delete('kind')
    setSearchParams(next)
  }
  // Escape only closes the picker when there is something to fall back to --
  // the same guard the backdrop uses. With no compound chosen and the query
  // working, closing it would leave the page with no address at all.
  const pickerRef = useDismissable(() => { if (selected || compoundsFailed) setPicking(false) }, picking)
  const [search, setSearch] = useState('')
  const [nearby, setNearby] = useState<Compound[] | null>(null)
  const [myCoords, setMyCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [compoundsFailed, setCompoundsFailed] = useState(false)

  function loadCompounds() {
    setCompoundsFailed(false)
    // Was .lte('distance_km', 30), which silently hid the furthest compounds
    // here while the checkout dropdown still offered them -- so the set of
    // selectable places differed by screen. Coverage is decided server-side by
    // vendor_covers_compound(), not by a magic number in the home picker.
    supabase.from('compounds').select('*').eq('active', true)
      .order('distance_km')
      .then(({ data, error }) => {
        const saved = getCompoundId()
        if (error) {
          setCompoundsFailed(true)
          // Restore the saved choice even on failure. Returning customers keep
          // a usable app (and their in-flight order page) instead of being
          // pinned behind a modal they cannot dismiss; only open the picker for
          // someone who has no place selected at all.
          if (saved) { setCompoundId(saved); return }
          setPicking(true)
          return
        }
        setCompounds(data ?? [])
        if (saved) { setCompoundId(saved); return }
        setPicking(true)
        // try detecting location automatically on first visit rather than
        // making everyone tap a button first -- useMyLocation already has its
        // own permission-denied/error handling, which leaves the manual
        // picker/search showing as a graceful fallback
        useMyLocation(data ?? [])
      })
  }

  useEffect(() => {
    loadCompounds()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!compoundId) { setLoading(false); return }
    setLoading(true)
    supabase.rpc('restaurants_for_compound', { p_compound_id: compoundId })
      .then(async ({ data }) => {
        const list = (data as Restaurant[]) ?? []
        setRestaurants(list); setLoading(false)
        if (!list.length) return
        const { data: discounts } = await supabase.from('discounts').select('*')
          .in('restaurant_id', list.map(r => r.id)).eq('active', true)
        const now = new Date()
        const inEffect = (d: Discount) => (!d.starts_at || new Date(d.starts_at) <= now) && (!d.ends_at || new Date(d.ends_at) >= now)
        setDiscountedRestaurantIds(new Set((discounts ?? []).filter(inEffect).map(d => d.restaurant_id)))
      })
  }, [compoundId])

  function choose(id: number) {
    setCompoundId(id)
    setStoredCompoundId(id)
    setPicking(false)
  }

  function useMyLocation(compoundsList: Compound[] = compounds) {
    if (!navigator.geolocation) { setLocationError('المتصفح ده مش بيدعم تحديد الموقع'); return }
    setLocating(true); setLocationError('')
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude, accuracy } = pos.coords
        setMyCoords({ lat: latitude, lng: longitude })
        const withCoords = compoundsList.filter(c => c.latitude != null && c.longitude != null)
        const ranked = [...withCoords].sort((a, b) =>
          haversineKm(latitude, longitude, a.latitude!, a.longitude!) -
          haversineKm(latitude, longitude, b.latitude!, b.longitude!))
        const nearest = ranked[0]
        const nearestKm = nearest ? haversineKm(latitude, longitude, nearest.latitude!, nearest.longitude!) : null

        setSearch('') // detected results replace a manual text search, not stack with it

        // A low-confidence fix (network/cell-tower rather than real GPS -- common
        // indoors or with weak signal) can be tens of km off. Surface that
        // explicitly rather than silently treating an unreliable reading as accurate.
        if (accuracy > 3000) {
          setLocationError(`الموقع اللي وصلنا بيه مش دقيق (نطاق خطأ ~${Math.round(accuracy / 1000)} كم) — جرب تفعّل GPS دقيق من إعدادات الموبايل، أو دوّر على اسم مكانك تحت`)
        } else if (nearestKm !== null && nearestKm > 15) {
          setLocationError(`أقرب مكان لينا بعيد عنك حوالي ${Math.round(nearestKm)} كم — تأكد من اسم مكانك تحت لو مش قريب`)
        }
        setNearby(ranked.slice(0, 3))
        setLocating(false)
      },
      () => {
        setLocationError('مش قادرين نوصل لموقعك — دوّر على اسم مكانك تحت')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  const selected = compounds.find(c => c.id === compoundId)
  // Authoritative, same source as the cart and checkout -- never a local guess.
  const { fee: deliveryFee, quote: deliveryQuote } = useDeliveryQuote(compoundId)
  const eta = (r: Restaurant) => selected ? r.prep_minutes + selected.est_travel_minutes : r.prep_minutes
  const catalogRestaurants = restaurants.filter(r =>
    r.order_mode !== 'custom_request' && r.vendor_type !== 'pharmacy' && r.vendor_type !== 'supermarket')
  // Pharmacy and supermarket are excluded from the restaurant grid because they
  // are errands, not menus. On 2026-08-04 they moved to the bottom nav and their
  // cards were deleted from Home -- which removed the only thing that told a
  // first-time visitor they exist. A nav icon is a destination for someone who
  // already knows; it is not discovery. Two tiles here, one line each, and no
  // third card offering a choice between the other two (that was the redundancy
  // the deletion was right to remove).
  const errandVendors = restaurants.filter(r =>
    r.vendor_type === 'pharmacy' || r.vendor_type === 'supermarket')
  const errandTiles = (['pharmacy', 'supermarket'] as const)
    .map(t => ({ type: t, vendors: errandVendors.filter(v => v.vendor_type === t) }))
    .filter(g => g.vendors.length > 0)
  // Only offer a kind that actually has a vendor delivering to this compound --
  // a chip that leads to an empty list is worse than no chip.
  const availableKinds = BROWSE_KINDS.filter(({ kind: k }) =>
    catalogRestaurants.some(r => vendorKind(r.category) === k))
  const shownRestaurants = kind
    ? catalogRestaurants.filter(r => vendorKind(r.category) === kind)
    : catalogRestaurants
  const filtered = search.trim() ? compounds.filter(c => c.name.toLowerCase().includes(search.toLowerCase())) : []

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3">
        <h1 className="text-2xl font-bold shrink-0">سالكة</h1>
        <button className="btn-ghost text-sm shrink-0 max-w-[55%]" onClick={() => setPicking(true)}>
          <span className="flex items-center gap-1">
            <Icon name="locationDot" className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{selected ? selected.name : 'اختر مكانك'}</span>
          </span>
        </button>
      </div>

      {/* Ads sit above the fee strip but below the place picker: the compound
          decides everything else on this screen, so it stays first. */}
      {!picking && <BannerRail />}

      {/* The delivery fee used to appear for the first time in the cart. It is
          set per compound and can be 350 ج.م, so someone adding a 90 ج.م burger
          from a far compound met a total three times what they expected, at the
          last step. The compound is chosen before anything else is visible, so
          the fee is knowable this whole time -- state it up front and let people
          decide before they build a basket. Same server quote the cart uses. */}
      {!picking && !loading && compoundId && deliveryFee !== null && (
        <p className="text-sm text-mist bg-shellup rounded-xl px-3.5 py-2.5 mb-4 flex items-center gap-2">
          <Icon name="locationDot" className="w-3.5 h-3.5 shrink-0" />
          <span>
            التوصيل لـ{selected ? ` ${selected.name}` : ''}
            <span className="text-foam font-semibold"> {deliveryFee} ج.م</span>
          </span>
        </p>
      )}


      {!picking && loading && <p className="text-mist">جاري التحميل…</p>}

      {/* Dismissing the picker after a failed compounds load used to leave a
          page with a title, a button and nothing else: loading was already
          false and the restaurants block is gated on compoundId, so neither
          branch rendered and there was no error and no retry outside the modal
          the customer had just closed. */}
      {!picking && !loading && !compoundId && (
        <div className="card p-6 text-center">
          <p className="font-semibold">{compoundsFailed ? 'مش قادرين نحمّل الأماكن' : 'اختار مكانك الأول'}</p>
          <p className="text-sm text-mist mt-1 mb-4">
            {compoundsFailed
              ? 'اتأكد إن النت شغال وجرب تاني.'
              : 'محتاجين نعرف مكانك عشان نعرف المطاعم اللي بتوصله وسعر التوصيل.'}
          </p>
          <button className="btn-sea !py-2 !px-5 text-sm" onClick={() => setPicking(true)}>
            {compoundsFailed ? 'جرب تاني' : 'اختار مكانك'}
          </button>
        </div>
      )}

      {!picking && !loading && compoundId && errandTiles.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-6">
          {errandTiles.map(({ type, vendors: vs }) => {
            const open = vs.some(v => v.is_open)
            const isRx = type === 'pharmacy'
            return (
              <Link key={type} to={`/custom-order?type=${type}`}
                className={`card p-3.5 flex items-center gap-3 hover:border-sea/50 transition-colors ${
                  open ? '' : 'opacity-60'}`}>
                <span className="w-11 h-11 rounded-xl bg-shellup grid place-items-center text-2xl shrink-0" aria-hidden="true">
                  {isRx ? '💊' : '🛒'}
                </span>
                <span className="min-w-0">
                  <span className="block font-bold text-sm truncate">{isRx ? 'صيدلية' : 'سوبر ماركت'}</span>
                  <span className="block text-xs text-mist truncate">
                    {open ? 'قول لنا اللي محتاجه' : 'مقفول دلوقتي'}
                  </span>
                </span>
              </Link>
            )
          })}
        </div>
      )}

      {!picking && !loading && compoundId && (
        <div id="restaurants">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="text-lg font-bold">المطاعم</h2>
            {kind && (
              <button className="text-sm text-seadeep font-semibold" onClick={() => setKind(null)}>
                إلغاء الفلتر
              </button>
            )}
          </div>

          {/* Browse by kind. Until now the only way to find food was to already
              know which restaurant sold it -- there was no way to ask "who does
              seafood?". Only kinds that actually have a vendor delivering here
              are offered, so tapping one can never land on an empty list. */}
          {availableKinds.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1 mb-4 -mx-4 px-4 scrollbar-none">
              {availableKinds.map(({ kind: k, emoji }) => (
                <button key={k}
                  className={`tab shrink-0 ${kind === k ? 'tab-active' : 'bg-shellup/60'}`}
                  onClick={() => setKind(kind === k ? null : k)}>
                  <span className="flex items-center gap-1.5"><span aria-hidden="true">{emoji}</span>{k}</span>
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {shownRestaurants.length === 0 && (
              <p className="text-mist col-span-full">
                {kind ? `مفيش مطاعم ${kind} بتوصل لمكانك حاليًا` : 'لا يوجد مطاعم بتوصل لمكانك حاليًا'}
              </p>
            )}
            {shownRestaurants.map(r => (
              <RestaurantCard
                key={r.id}
                restaurant={r}
                etaMinutes={selected ? eta(r) : null}
                hasDiscount={discountedRestaurantIds.has(r.id)}
              />
            ))}
          </div>
        </div>
      )}


      {picking && (
        <div ref={pickerRef} className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" role="dialog" aria-modal="true"
          onClick={() => (selected || compoundsFailed) && setPicking(false)}>
          <div className="card w-full max-w-md p-5 max-h-[85vh] overflow-y-auto relative" onClick={e => e.stopPropagation()}>
            {/* The only way to dismiss this was tapping the backdrop *while a
                compound was already selected*. If the compound query failed the
                list was empty, nothing could be selected, and the overlay became
                permanent -- a search box that can never match anything. */}
            {(selected || compoundsFailed) && (
              <button className="absolute top-2 left-2 w-11 h-11 grid place-items-center text-mist hover:text-foam text-xl"
                aria-label="إغلاق" onClick={() => setPicking(false)}>✕</button>
            )}
            <h3 className="font-bold text-lg mb-1">فين مكانك؟</h3>
            <p className="text-sm text-mist mb-3">هنعرض بس المطاعم اللي بتوصل لمنطقتك</p>

            {compoundsFailed && (
              <div className="bg-red-500/10 rounded-xl p-3 mb-3 text-center">
                <p className="text-sm text-red-600">مش قادرين نجيب الأماكن دلوقتي</p>
                <button className="btn-ghost mt-2 text-sm" onClick={loadCompounds}>جرب تاني</button>
              </div>
            )}

            <div className="flex items-center gap-2 mb-4">
              <div className="field flex-1 flex items-center gap-2 !px-3.5">
                <Icon name="magnifyingGlass" className="w-4 h-4 shrink-0 text-mist" />
                <input className="flex-1 bg-transparent focus:outline-none placeholder:text-mist/60" value={search}
                  onChange={e => { setSearch(e.target.value); if (e.target.value.trim()) setNearby(null) }}
                  placeholder="دوّر على اسم المكان…" />
              </div>
              <button className="w-12 h-12 rounded-xl border border-line bg-night grid place-items-center shrink-0" disabled={locating} onClick={() => useMyLocation()}
                title="استخدم موقعي الحالي" aria-label="استخدم موقعي الحالي">
                {locating ? '…' : <Icon name="locationDot" className="w-4 h-4" />}
              </button>
            </div>

            {locationError && <p className="text-xs text-sandink mb-3 text-center">{locationError}</p>}

            {nearby && (
              <div className="mb-4">
                <p className="text-sm text-mist mb-2">أقرب الأماكن ليك</p>
                <div className="space-y-2">
                  {nearby.map(c => (
                    <button key={c.id} className={`w-full card !bg-night p-3 text-right border-sea/40 ${compoundId === c.id ? 'border-sea' : ''}`}
                      onClick={() => choose(c.id)}>
                      <span className="font-semibold block truncate">{c.name}</span>
                      {/* No kilometres anywhere a customer can see. They are
                          still used to ORDER this list nearest-first -- that is
                          what the GPS fix is for -- but a distance printed next
                          to a place implies the delivery fee is computed from
                          it, and it is not. */}
                      <span className="text-mist text-xs block mt-0.5">
                        ~{c.est_travel_minutes} دقيقة توصيل
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {search.trim() && filtered.length === 0 && (
              <p className="text-sm text-mist text-center py-6">مفيش نتائج</p>
            )}

            <div className="space-y-2">
              {filtered.map(c => (
                <button key={c.id} className={`w-full card !bg-night p-3 text-right ${compoundId === c.id ? 'border-sea' : ''}`}
                  onClick={() => choose(c.id)}>
                  <span className="font-semibold block truncate">{c.name}</span>
                  <span className="text-mist text-xs block mt-0.5">~{c.est_travel_minutes} دقيقة توصيل</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
