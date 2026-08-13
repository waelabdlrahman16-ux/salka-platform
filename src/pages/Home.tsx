import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useDismissable } from '../lib/useDismissable'
import { haversineKm } from '../lib/geo'
import { useDeliveryQuote } from '../lib/deliveryQuote'
import { openLabel } from '../lib/vendorHours'
import { BROWSE_KINDS, vendorKind, type VendorKind } from '../lib/categoryArt'
import Icon from '../components/Icon'
import BannerRail from '../components/BannerRail'
import RestaurantCard from '../components/RestaurantCard'
import type { Compound, Discount, Restaurant } from '../lib/types'
import { getCompoundId, setCompoundId as setStoredCompoundId } from '../lib/place'
import { publicCatalog } from '../lib/publicCatalog'

const STORAGE_KEY = 'salka_compound_id'

export default function Home() {
  const [compounds, setCompounds] = useState<Compound[]>([])
  const [compoundId, setCompoundId] = useState<number | null>(null)
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  /** restaurant_id -> the badge text, e.g. «خصم ٢٠٪». A fixed-amount offer
   *  falls back to «عروض»: "20 ج.م off" means nothing without the price. */
  const [discountLabels, setDiscountLabels] = useState<Map<number, string>>(new Map())
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
  // Food search. The home screen has never had one, so the only way to find a
  // dish was to already know which restaurant sold it.
  const [foodQ, setFoodQ] = useState('')
  const [foodHits, setFoodHits] = useState<
    { id: number; name: string; price: number; is_from_price: boolean
      image_url: string | null; category: string
      restaurant_id: number; restaurant_name: string; is_open: boolean }[]
  >([])
  const [foodSearching, setFoodSearching] = useState(false)

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

  // Debounced, because this fires per keystroke in Arabic where a word is
  // often four taps. 250ms is below the threshold where typing feels laggy and
  // well above the rate that would hammer the database.
  useEffect(() => {
    const q = foodQ.trim()
    if (!compoundId || q.length < 2) { setFoodHits([]); setFoodSearching(false); return }
    setFoodSearching(true)
    const t = setTimeout(() => {
      publicCatalog<typeof foodHits>('searchMenu', { compoundId, q, limit: 12 })
        .then(res => { setFoodHits(res.ok ? res.data : []); setFoodSearching(false) })
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foodQ, compoundId])

  useEffect(() => {
    if (!compoundId) { setLoading(false); return }
    setLoading(true)
    publicCatalog<Restaurant[]>('restaurants', { compoundId })
      .then(async res => {
        if (!res.ok) { setRestaurants([]); setLoading(false); return }
        const list = res.data ?? []
        setRestaurants(list); setLoading(false)
        if (!list.length) return
        // A failed discount read used to be indistinguishable from "no vendor
        // has an offer": both produced an empty Set, so every «خصم» badge
        // silently disappeared from the home screen. That is money -- the
        // badges are what pull a customer into a discounted vendor -- and it
        // failed in the one direction nobody notices, because a screen with no
        // badges looks completely normal.
        const { data: discounts, error: discErr } = await supabase.from('discounts').select('*')
          .in('restaurant_id', list.map(r => r.id)).eq('active', true)
        if (discErr) return   // keep whatever badges are already on screen
        const now = new Date()
        const inEffect = (d: Discount) => (!d.starts_at || new Date(d.starts_at) <= now) && (!d.ends_at || new Date(d.ends_at) >= now)
        // Best offer per vendor, so a restaurant running 10% on one item and
        // 30% on another advertises the 30.
        const labels = new Map<number, string>()
        let bestPct = new Map<number, number>()
        for (const d of (discounts ?? []).filter(inEffect)) {
          if (d.discount_type === 'percent') {
            const cur = bestPct.get(d.restaurant_id) ?? 0
            if (d.value > cur) bestPct.set(d.restaurant_id, d.value)
          } else if (!labels.has(d.restaurant_id)) {
            labels.set(d.restaurant_id, 'عروض')
          }
        }
        for (const [id, pct] of bestPct) labels.set(id, `خصم ${Math.round(pct)}٪`)
        setDiscountLabels(labels)
      })
  }, [compoundId])

  function choose(id: number) {
    setCompoundId(id)
    setStoredCompoundId(id)
    setPicking(false)
  }

  function useMyLocation(compoundsList: Compound[] = compounds) {
    if (!navigator.geolocation) { setLocationError('المتصفح ده مش بيدعم تحديد الموقع'); return }

    // WHY THERE IS A WATCHDOG HERE.
    //
    // "In some phones it doesn't respond" is this: getCurrentPosition is not
    // guaranteed to call EITHER callback. If the permission prompt is dismissed
    // rather than answered -- swiped away, or the user switches apps and comes
    // back -- several mobile browsers simply never resolve it, and the `timeout`
    // option does not apply because the clock only starts once permission is
    // granted. So `locating` stayed true forever, the button stayed disabled
    // showing a spinner, and the only way out was reloading the app.
    //
    // The watchdog is ours, it always fires, and it always re-enables the
    // button. `settled` makes whichever of the three arrives first the winner.
    let settled = false
    const finish = (msg?: string) => {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      setLocating(false)
      if (msg) setLocationError(msg)
    }
    const watchdog = setTimeout(
      () => finish('الموقع اتأخر — اسمح للتطبيق بالوصول لموقعك من إعدادات المتصفح، أو دوّر على اسم مكانك تحت'),
      20000
    )

    setLocating(true); setLocationError('')
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude, accuracy } = pos.coords
        setMyCoords({ lat: latitude, lng: longitude })
        // Number() on both, deliberately. compounds.latitude/longitude are
        // Postgres `numeric`, which PostgREST serialises as a STRING to avoid
        // float precision loss -- so these arrive as "29.6380" even though the
        // Compound type says number. Subtraction coerces and happens to work,
        // which is exactly why this would never have been noticed if any part
        // of the formula ever used + instead of -.
        const withCoords = compoundsList.filter(c => c.latitude != null && c.longitude != null)
        const distKm = (c: Compound) =>
          haversineKm(latitude, longitude, Number(c.latitude), Number(c.longitude))
        const ranked = [...withCoords].sort((a, b) => distKm(a) - distKm(b))
        const nearest = ranked[0]
        const nearestKm = nearest ? distKm(nearest) : null

        setSearch('') // detected results replace a manual text search, not stack with it

        // A BAD FIX MUST NOT PRODUCE A LIST.
        //
        // This used to rank from ANY reading and then add a warning above the
        // results. So a customer sitting in بورتو السخنة was shown لونج بيتش,
        // قرية برنسيس and كورال سي بيتش -- 24 to 30km south -- under a heading
        // promising they were the closest places to him. The ranking maths was
        // correct; the input was not. A desktop browser geolocates by IP, and a
        // phone without a GPS lock falls back to cell towers; both land tens of
        // kilometres out and both report it honestly in `accuracy`.
        //
        // A confidently wrong list is worse than no list, because the heading
        // is the only thing telling the customer what those three names mean.
        // Above 1km of claimed error, or when the entire catalogue is
        // implausibly far, show nothing and say why.
        const accKm = accuracy / 1000
        if (accuracy > 1000) {
          setNearby(null)
          setLocationError(`تحديد الموقع مش دقيق (نطاق خطأ حوالي ${accKm >= 1 ? `${Math.round(accKm)} كم` : `${Math.round(accuracy)} متر`}) — دوّر على اسم مكانك تحت، هيبقى أدق.`)
          finish()
          return
        }
        if (nearestKm !== null && nearestKm > 15) {
          setNearby(null)
          setLocationError(`الموقع اللي وصلنا بيه بعيد عن كل أماكننا (أقربها ${Math.round(nearestKm)} كم) — دوّر على اسم مكانك تحت.`)
          finish()
          return
        }

        setNearby(ranked.slice(0, 3))
        finish()
      },
      err => {
        // Naming the reason matters: "denied" needs a settings change and no
        // amount of re-tapping will help, while "unavailable" or "timeout" are
        // worth another try. One generic sentence for all three sent people
        // back to a button that could not work.
        finish(
          err.code === err.PERMISSION_DENIED
            ? 'التطبيق مش مسموحله يشوف موقعك — فعّلها من إعدادات المتصفح، أو دوّر على اسم مكانك تحت'
            : err.code === err.TIMEOUT
              ? 'الموقع اتأخر — جرب تاني، أو دوّر على اسم مكانك تحت'
              : 'مش قادرين نوصل لموقعك — دوّر على اسم مكانك تحت'
        )
      },
      // 12s, not 15: it has to expire comfortably inside the 20s watchdog so
      // the browser's own error (which names the cause) wins the race whenever
      // the browser is actually answering.
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    )
  }

  const selected = compounds.find(c => c.id === compoundId)
  // Authoritative, same source as the cart and checkout -- never a local guess.
  const { fee: deliveryFee, quote: deliveryQuote } = useDeliveryQuote(compoundId)
  const eta = (r: Restaurant) => selected
    ? { min: r.prep_minutes + selected.est_travel_minutes_min, max: r.prep_minutes + selected.est_travel_minutes_max }
    : { min: r.prep_minutes, max: r.prep_minutes }
  const catalogRestaurants = restaurants.filter(r =>
    r.order_mode !== 'custom_request' && r.vendor_type !== 'pharmacy' && r.vendor_type !== 'supermarket')
  // Only offer a kind that actually has a vendor delivering to this compound --
  const availableKinds = BROWSE_KINDS.filter(({ kind: k }) =>
    catalogRestaurants.some(r => vendorKind(r.category) === k))
  const shownRestaurants = kind
    ? catalogRestaurants.filter(r => vendorKind(r.category) === kind)
    : catalogRestaurants
  // Split rather than interleave. Five of nine vendors are shut at any given
  // moment, and they were mixed through the list at 55% opacity -- so more than
  // half of what a customer scrolled past could not be ordered. Open first,
  // closed collected underneath their own heading.
  const openRestaurants = shownRestaurants.filter(r => r.is_open)
  const closedRestaurants = shownRestaurants.filter(r => !r.is_open)
  // Vendor names are matched locally -- the list is already in memory and a
  // round trip to match nine names would be silly.
  const matchedVendors = foodQ.trim().length >= 2
    ? catalogRestaurants.filter(r =>
        r.name.toLowerCase().includes(foodQ.trim().toLowerCase()) ||
        (r.category ?? '').toLowerCase().includes(foodQ.trim().toLowerCase()))
    : []
  const kindCount = (k: VendorKind) =>
    catalogRestaurants.filter(r => vendorKind(r.category) === k && r.is_open).length
  const filtered = search.trim() ? compounds.filter(c => c.name.toLowerCase().includes(search.toLowerCase())) : []

  return (
    <div>
      {/* The place is not a secondary control, it is the decision that governs
          everything else on this screen -- which vendors exist, what delivery
          costs, how long it takes. It used to be a grey ghost button beside the
          title. Now it IS the title, and the delivery fee sits next to it:
          stated once, because it is a property of the compound and is identical
          on every card, so printing it nine times implied it varied. */}
      <div className="flex items-start justify-between mb-3 gap-3">
        {/* min-h-11: it measured 42px, two short of the 44px minimum, and this
            is the control that decides which vendors the customer sees at all. */}
        <button className="text-right min-w-0 flex-1 min-h-11" onClick={() => setPicking(true)}>
          <span className="block text-[11px] text-mist">التوصيل لـ</span>
          <span className="flex items-center gap-1 min-w-0">
            <Icon name="locationDot" className="w-4 h-4 shrink-0 text-sea" />
            <span className="font-bold text-[17px] truncate">{selected ? selected.name : 'اختر مكانك'}</span>
            <span className="text-mist text-xs shrink-0">▾</span>
          </span>
        </button>
        {deliveryFee !== null && (
          <span className="shrink-0 text-[11px] font-bold text-sandink bg-sand/20 rounded-lg px-2.5 py-1 mt-3">
            {deliveryFee} ج.م توصيل
          </span>
        )}
      </div>

      {/* One box, two kinds of answer: vendor names matched locally, dishes
          matched on the server across every vendor delivering here. */}
      {compoundId && !picking && (
        <div className="relative mb-3">
          <input className="field !pr-10" value={foodQ} onChange={e => setFoodQ(e.target.value)}
            aria-label="دوّر على مطعم أو أكلة"
            placeholder="دوّر على مطعم أو أكلة…" />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-mist pointer-events-none">
            <Icon name="magnifyingGlass" className="w-4 h-4" />
          </span>
          {foodQ.trim() && (
            <button className="absolute left-3 top-1/2 -translate-y-1/2 text-mist text-sm"
              aria-label="مسح" onClick={() => setFoodQ('')}>✕</button>
          )}
        </div>
      )}

      {/* Ads sit above the fee strip but below the place picker: the compound
          decides everything else on this screen, so it stays first. */}
      {!picking && <BannerRail />}

      {/* The delivery-fee strip that used to sit here has moved onto each
          restaurant card. It still has to appear before the cart -- the reason
          it existed is a customer meeting a 350 ج.م fee for the first time at
          checkout -- but as one number in the card's meta line rather than a
          boxed banner competing with the list. */}

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

      {/* The صيدلية / سوبر ماركت tiles that were here are gone at Wael's call,
          2026-08-05. They are reachable from the bottom nav. */}

      {!picking && !loading && compoundId && (
        <div id="restaurants">
          {kind && (
            <div className="flex justify-end mb-2">
              <button className="text-sm text-seadeep font-semibold" onClick={() => setKind(null)}>
                إلغاء الفلتر
              </button>
            </div>
          )}

          {/* Browse by kind. Until now the only way to find food was to already
              know which restaurant sold it -- there was no way to ask "who does
              seafood?". Only kinds that actually have a vendor delivering here
              are offered, so tapping one can never land on an empty list. */}
          {availableKinds.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1 mb-4 -mx-4 px-4 scrollbar-none">
              {availableKinds.map(({ kind: k, emoji }) => {
                // The count is how many are OPEN, not how many exist. A chip
                // that leads to three shut restaurants is a wasted tap, and the
                // number is the only warning available before taking it.
                const n = kindCount(k)
                return (
                  <button key={k}
                    className={`tab shrink-0 ${kind === k ? 'tab-active' : 'bg-shellup/60'}`}
                    onClick={() => setKind(kind === k ? null : k)}>
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden="true">{emoji}</span>{k}
                      {n > 0 && <span className="text-[11px] text-mist">{n}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Search takes over the whole list while there is a query: a
              customer who typed "برجر" is asking one question, and answering it
              underneath the full restaurant list would bury it. */}
          {foodQ.trim().length >= 2 ? (
            <div>
              {foodSearching && <p className="text-mist text-sm py-4">بندوّر…</p>}
              {!foodSearching && foodHits.length === 0 && matchedVendors.length === 0 && (
                <p className="text-mist text-sm py-6 text-center">
                  مفيش نتائج لـ «{foodQ.trim()}» — جرب اسم تاني
                </p>
              )}

              {matchedVendors.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-mist mb-2">مطاعم</p>
                  <div className="space-y-3">
                    {matchedVendors.map(r => (
                      <RestaurantCard key={r.id} restaurant={r}
                        etaMinutes={selected ? eta(r) : null}
                        discountLabel={discountLabels.get(r.id)} />
                    ))}
                  </div>
                </div>
              )}

              {foodHits.length > 0 && (
                <div>
                  <p className="text-xs text-mist mb-2">أكلات</p>
                  <div className="card divide-y divide-line">
                    {foodHits.map(h => (
                      <Link key={h.id} to={`/restaurant/${h.restaurant_id}`}
                        className={`flex items-center gap-3 p-3 ${h.is_open ? '' : 'opacity-60'}`}>
                        <span className="w-11 h-11 rounded-lg overflow-hidden bg-shellup grid place-items-center text-base shrink-0">
                          {h.image_url
                            ? <img src={h.image_url} alt="" loading="lazy" className="w-full h-full object-cover"
                                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                            : '🍽️'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold truncate">{h.name}</span>
                          <span className="block text-xs text-mist truncate">
                            {h.restaurant_name}{h.is_open ? '' : ' · مقفول'}
                          </span>
                        </span>
                        {/* "من" when the number is a starting point, exactly as
                            the menu card renders it. Without this the search
                            quoted menu_items.price for size-only items -- 6
                            وينجز reads 190 in that column and cannot be bought
                            for less than 300. */}
                        <span className="text-sm font-bold text-sea shrink-0">
                          {h.is_from_price ? 'من ' : ''}{h.price} ج.م
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
          <div className="space-y-3">
            {shownRestaurants.length === 0 && (
              <p className="text-mist py-6">
                {kind ? `مفيش مطاعم ${kind} بتوصل لمكانك حاليًا` : 'لا يوجد مطاعم بتوصل لمكانك حاليًا'}
              </p>
            )}
            {openRestaurants.map(r => (
              <RestaurantCard
                key={r.id}
                restaurant={r}
                etaMinutes={selected ? eta(r) : null}
                discountLabel={discountLabels.get(r.id)}
              />
            ))}

            {/* Closed vendors, collected. Still reachable -- people browse a
                menu before a place opens -- but no longer taking up half the
                scroll between things that can actually be ordered. */}
            {closedRestaurants.length > 0 && (
              <div className="pt-2">
                <p className="text-xs text-mist mb-2 pt-3 border-t border-line">هيفتحوا بعدين</p>
                <div className="flex flex-wrap gap-2">
                  {closedRestaurants.map(r => (
                    <Link key={r.id} to={`/restaurant/${r.id}`}
                      className="flex items-center gap-2 rounded-full border border-line bg-shell px-3 py-1.5 min-h-[40px]">
                      <span className="w-6 h-6 rounded-md overflow-hidden bg-shellup grid place-items-center text-[11px] shrink-0">
                        {r.logo_url
                          ? <img src={r.logo_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                          : '🍽️'}
                      </span>
                      <span className="min-w-0">
                        <span className="text-xs font-semibold truncate max-w-[130px] block">{r.name}</span>
                        {/* «هيفتحوا بعدين» says they open later; it does not say
                            WHEN, and without that there is no reason to come
                            back. The card variant has carried the opening time
                            since vendorHours landed -- this chip is a second,
                            older rendering of the same fact and was missed. */}
                        {openLabel(r).text !== 'مقفول' && (
                          <span className="text-[10px] text-sandink block">{openLabel(r).text}</span>
                        )}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}
        </div>
      )}


      {picking && (
        <div ref={pickerRef} className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" role="dialog" aria-modal="true"
          onClick={() => (selected || compoundsFailed) && setPicking(false)}>
          <div className="card w-full max-w-md p-4 max-h-[85vh] overflow-y-auto relative" onClick={e => e.stopPropagation()}>
            {/* The only way to dismiss this was tapping the backdrop *while a
                compound was already selected*. If the compound query failed the
                list was empty, nothing could be selected, and the overlay became
                permanent -- a search box that can never match anything. */}
            {(selected || compoundsFailed) && (
              <button className="absolute top-2 left-2 w-11 h-11 grid place-items-center text-mist hover:text-foam text-xl"
                aria-label="إغلاق" onClick={() => setPicking(false)}>✕</button>
            )}
            <h3 className="font-bold text-lg mb-3">فين مكانك؟</h3>

            {compoundsFailed && (
              <div className="bg-red-500/10 rounded-xl p-3 mb-3 text-center">
                <p className="text-sm text-red-600">مش قادرين نجيب الأماكن دلوقتي</p>
                <button className="btn-ghost mt-2 text-sm" onClick={loadCompounds}>جرب تاني</button>
              </div>
            )}

            {/* min-w-0 on BOTH the field and the input, and it is load-bearing.
                A flex item defaults to min-width:auto, which means it refuses
                to shrink below its content's intrinsic minimum -- and a bare
                <input> reports a minimum of roughly its default 20-character
                size regardless of the placeholder. So the search box would not
                give up any width, the row overflowed the card, and in RTL the
                overflow goes LEFT: the location button was pushed off the left
                edge and clipped by the card's rounded corner. Reported from a
                real phone with a screenshot showing a sliver of it outside the
                dialog. */}
            <div className="flex items-center gap-2 mb-4">
              <div className="field flex-1 min-w-0 flex items-center gap-2 !px-3.5">
                <Icon name="magnifyingGlass" className="w-4 h-4 shrink-0 text-mist" />
                <input className="flex-1 min-w-0 bg-transparent focus:outline-none placeholder:text-mist/60" value={search}
                  onChange={e => { setSearch(e.target.value); if (e.target.value.trim()) setNearby(null) }}
                  aria-label="دوّر على اسم المكان"
            placeholder="دوّر على اسم المكان…" />
              </div>
              <button className="w-12 h-12 rounded-xl border border-line bg-night grid place-items-center shrink-0 disabled:opacity-60"
                disabled={locating} onClick={() => useMyLocation()}
                title="استخدم موقعي الحالي" aria-label="استخدم موقعي الحالي">
                {locating
                  ? <span className="inline-block w-4 h-4 rounded-full border-2 border-mist/40 border-t-sea animate-spin" />
                  : <Icon name="locationDot" className="w-4 h-4 text-sea" />}
              </button>
            </div>

            {locationError && <p className="text-xs text-sandink mb-3 text-center">{locationError}</p>}

            {nearby && (
              <div className="mb-4">
                <p className="text-sm text-mist mb-2">أقرب الأماكن ليك</p>
                <div className="space-y-1.5">
                  {nearby.map(c => {
                    // HOW FAR IT IS FROM *YOU*, under a heading that says
                    // "أقرب الأماكن ليك".
                    //
                    // This row used to print est_travel_minutes, which is the
                    // hub-to-compound delivery time and has nothing to do with
                    // where the customer is standing. Sitting in Porto Sokhna
                    // and reading "~42 دقيقة توصيل" against the top result is
                    // how you conclude the app cannot find you -- when in fact
                    // the ranking was right and the number was answering a
                    // different question.
                    //
                    // Kilometres are still kept off every OTHER customer
                    // screen, because a distance next to a place implies the
                    // delivery fee is computed from it and it is not. Here it
                    // is not a price, it is the whole point of the list.
                    const km = myCoords && c.latitude != null && c.longitude != null
                      ? haversineKm(myCoords.lat, myCoords.lng, Number(c.latitude), Number(c.longitude))
                      : null
                    return (
                      <button key={c.id} className={`w-full card !bg-night p-3 text-right border-sea/40 ${compoundId === c.id ? 'border-sea' : ''}`}
                        onClick={() => choose(c.id)}>
                        <span className="font-semibold block truncate">{c.name}</span>
                        <span className="text-mist text-xs block mt-0.5">
                          {km === null ? `~${c.est_travel_minutes_min}-${c.est_travel_minutes_max} دقيقة توصيل`
                            : km < 1 ? 'إنت هنا تقريبًا'
                            : `على بعد ${km < 10 ? km.toFixed(1) : Math.round(km)} كم منك`}
                        </span>
                      </button>
                    )
                  })}
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
                  <span className="text-mist text-xs block mt-0.5">~{c.est_travel_minutes_min}-{c.est_travel_minutes_max} دقيقة توصيل</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
