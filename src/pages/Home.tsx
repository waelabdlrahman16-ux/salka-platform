import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useDismissable } from '../lib/useDismissable'
import { haversineKm } from '../lib/geo'
import { useDeliveryQuote } from '../lib/deliveryQuote'
import { BROWSE_KINDS, vendorKind, type VendorKind } from '../lib/categoryArt'
import Icon from '../components/Icon'
import type { Compound, Discount, Restaurant } from '../lib/types'

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
        const saved = sessionStorage.getItem(STORAGE_KEY)
        if (error) {
          setCompoundsFailed(true)
          // Restore the saved choice even on failure. Returning customers keep
          // a usable app (and their in-flight order page) instead of being
          // pinned behind a modal they cannot dismiss; only open the picker for
          // someone who has no place selected at all.
          if (saved) { setCompoundId(Number(saved)); return }
          setPicking(true)
          return
        }
        setCompounds(data ?? [])
        if (saved) { setCompoundId(Number(saved)); return }
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
    sessionStorage.setItem(STORAGE_KEY, String(id))
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

      {/* The delivery fee used to appear for the first time in the cart. It is
          distance-based and can be 350 ج.م, so someone adding a 90 ج.م burger
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
            {deliveryQuote ? ` · ${deliveryQuote.distance_km} كم` : ''}
          </span>
        </p>
      )}


      {!picking && loading && <p className="text-mist">جاري التحميل…</p>}

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
              <Link key={r.id} to={`/restaurant/${r.id}`} className="card p-4 hover:border-sea/50 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    {r.logo_url
                      ? <img src={r.logo_url} alt="" className="w-11 h-11 rounded-xl object-cover shrink-0 border border-line" />
                      : <div className="w-11 h-11 rounded-xl bg-shellup grid place-items-center shrink-0 text-lg font-bold text-mist">{r.name.charAt(0)}</div>}
                    <div className="min-w-0">
                      <h2 className="font-bold truncate">{r.name}</h2>
                      <p className="text-xs text-mist truncate">{r.category}</p>
                    </div>
                  </div>
                  <span className={r.is_open ? 'badge-open' : 'badge-closed'}>{r.is_open ? 'مفتوح' : 'مغلق'}</span>
                </div>
                {discountedRestaurantIds.has(r.id) && (
                  <span className="inline-flex items-center gap-1 bg-sand/15 text-sandink text-xs font-bold rounded-full px-2 py-0.5 mt-2">
                    🏷️ عروض وخصومات
                  </span>
                )}
                <p className="text-sm text-mist mt-1.5 leading-relaxed">{r.description}</p>
                <div className="flex items-center gap-3 mt-3 text-sm text-mist">
                  <span className="flex items-center gap-1"><Icon name="star" className="w-3.5 h-3.5 text-sand" /> {r.rating}</span>
                  <span className="flex items-center gap-1">
                    {r.order_mode === 'pickup_request' ? '🛵 اطلب مندوب توصيل' : <><Icon name="clock" className="w-3.5 h-3.5" /> {eta(r)} دقيقة</>}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Three entry points, one flow -- and deliberately BELOW the restaurants.

          This block used to sit above the restaurant list and hold four tiles.
          Two things were wrong with it.

          The first tile, "مطاعم", was a bare <a href="#restaurants"> rather than
          a router Link, and it pointed at a list that was already on the screen
          a few hundred pixels further down. It bought nothing and cost
          something real: the anchor pushed a `/#restaurants` history entry, so
          after visiting the pharmacy the Back button landed on Home-with-a-hash
          instead of Home -- the same screen at a different URL, which reads as
          having been dumped somewhere else.

          And the restaurants -- the reason anyone opens this app -- were pushed
          below a 2x2 grid of secondary entry points. They now come first.

          The remaining three all lead to /custom-order. They are one flow with
          three starting points, so they read as one group under a heading that
          says what the group is for, rather than as three separate
          destinations. */}
      {!picking && !loading && compoundId && (
        <>
        <h2 className="text-lg font-bold mb-2">اطلب أي حاجة تانية</h2>
        <p className="text-sm text-mist mb-3">مش لاقي اللي عايزه في المطاعم؟ اكتب طلبك وإحنا نجيبهولك.</p>
        <div className="grid grid-cols-3 gap-3 mb-7">
          <Link to="/custom-order?type=supermarket" className="card p-3 flex flex-col items-center text-center gap-2 hover:border-sea/50 transition-colors">
            <span className="w-11 h-11 rounded-xl grid place-items-center text-2xl shrink-0" style={{ background: 'rgba(212,163,42,.12)' }}>🛒</span>
            <span className="font-bold text-sm leading-tight">سوبر ماركت</span>
          </Link>
          <Link to="/custom-order?type=pharmacy" className="card p-3 flex flex-col items-center text-center gap-2 hover:border-sea/50 transition-colors">
            <span className="w-11 h-11 rounded-xl grid place-items-center text-2xl shrink-0" style={{ background: 'rgba(200,60,60,.1)' }}>💊</span>
            <span className="font-bold text-sm leading-tight">صيدلية</span>
          </Link>
          <Link to="/custom-order" className="card p-3 flex flex-col items-center text-center gap-2 hover:border-sea/50 transition-colors">
            <span className="w-11 h-11 rounded-xl grid place-items-center text-2xl shrink-0" style={{ background: 'rgba(100,113,111,.12)' }}>📝</span>
            <span className="font-bold text-sm leading-tight">طلب خاص</span>
          </Link>
        </div>
        </>
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
                      <span className="text-mist text-xs block mt-0.5">
                        ~{c.est_travel_minutes} دقيقة توصيل
                        {myCoords && c.latitude != null && c.longitude != null &&
                          ` · على بعد ${haversineKm(myCoords.lat, myCoords.lng, c.latitude, c.longitude).toFixed(1)} كم منك`}
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
