import { useEffect, useState, type ReactNode } from 'react'
import EmptyState from '../components/EmptyState'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useDismissable } from '../lib/useDismissable'
import { haversineKm } from '../lib/geo'
import { useDeliveryQuote } from '../lib/deliveryQuote'
import { openLabel } from '../lib/vendorHours'
import { BROWSE_KINDS, vendorKind, normaliseArabic, VENDOR_TYPE_ART, type VendorKind } from '../lib/categoryArt'
import Icon from '../components/Icon'
import BannerRail from '../components/BannerRail'
import RestaurantCard from '../components/RestaurantCard'
import FeedAdCard, { type FeedAdCardData } from '../components/FeedAdCard'
import FeaturedProductsRail, { type FeaturedProductCard } from '../components/FeaturedProductsRail'
import type { Compound, Discount, Restaurant } from '../lib/types'
import { getCompoundId, setCompoundId as setStoredCompoundId } from '../lib/place'
import { publicCatalog } from '../lib/publicCatalog'


// Off until the category art exists. The chips currently carry the food emoji,
// which is fine as an appetite cue at 20px next to a word -- but with the label
// removed they became five emoji in five boxes and read as decoration rather
// than a filter. Wael is drawing a dish illustration per category; this comes
// back on when they land.
//
// A flag rather than deleting the block: everything downstream still works --
// `kind` filtering, the filtered-empty state, «شوف كل المطاعم» -- so switching
// this to true is the whole re-enable.
const SHOW_CATEGORY_CHIPS = false

export default function Home() {
  const [compounds, setCompounds] = useState<Compound[]>([])
  const [compoundId, setCompoundId] = useState<number | null>(null)
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  /** restaurant_id -> the badge text, e.g. «خصم ٢٠٪». A fixed-amount offer
   *  falls back to «عروض»: "20 ج.م off" means nothing without the price. */
  const [discountLabels, setDiscountLabels] = useState<Map<number, string>>(new Map())
  const [loading, setLoading] = useState(true)
  // Distinguishes "this compound genuinely has no coverage" from "we could
  // not read the restaurant list" -- both used to render the identical
  // «لا يوجد مطاعم بتوصل لمكانك» message, which is a confident factual claim
  // made on a failed fetch. Every other screen in the app (Offers,
  // RestaurantDetail, CheckoutPage, CustomOrder) already guards against
  // this; the home screen's own primary list was the one gap.
  const [restaurantsFailed, setRestaurantsFailed] = useState(false)
  const [restaurantsAttempt, setRestaurantsAttempt] = useState(0)
  const [picking, setPicking] = useState(false)
  // Whether BannerRail actually has anything to show, so the pharmacy/
  // supermarket shortcuts can sit under real ads but move up to fill that
  // same slot the moment there are none -- never a gap, never two things
  // fighting for the top of the screen.
  const [hasBanners, setHasBanners] = useState(false)
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
  // Always closable, by Escape or by the backdrop. It used to refuse unless a
  // compound had already been chosen, on the reasoning that dismissing it left
  // the page with no address -- true when the page rendered nothing without
  // one. The catalogue now renders unfiltered, so there is always something to
  // go back to, and a modal a first-time visitor cannot close is exactly what
  // turned 4,770 paid arrivals into zero orders.
  const pickerRef = useDismissable(() => setPicking(false), picking)
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

  // Ads and featured products dropped BETWEEN restaurant cards further down --
  // a second ad slot separate from BannerRail, and a cross-restaurant
  // "featured" shelf. Fetched once, platform-wide (not per-compound): the RLS
  // policies already gate on active + the time window the same way
  // BannerRail's own filter does, client-side, as a second check in case the
  // window boundary lands between the query and the render.
  const [feedAds, setFeedAds] = useState<FeedAdCardData[]>([])
  const [featuredProducts, setFeaturedProducts] = useState<FeaturedProductCard[]>([])

  useEffect(() => {
    const now = Date.now()
    const inWindow = (starts_at: string | null, ends_at: string | null) =>
      (!starts_at || new Date(starts_at).getTime() <= now) && (!ends_at || new Date(ends_at).getTime() > now)

    supabase.from('feed_ads').select('id,title,subtitle,image_url,bg_color,link_url,active,sort,starts_at,ends_at')
      .eq('active', true).order('sort').order('id')
      .then(({ data, error }) => {
        if (error) return
        setFeedAds((data ?? []).filter(a => inWindow(a.starts_at, a.ends_at)))
      })

    supabase.from('featured_products')
      .select('menu_item_id,active,sort,starts_at,ends_at,menu_items(id,name,price,image_url,restaurant_id)')
      .eq('active', true).order('sort').order('id')
      .then(({ data, error }) => {
        if (error) return
        const cards = (data ?? [])
          .filter(row => inWindow(row.starts_at, row.ends_at) && row.menu_items)
          .map(row => {
            const item = row.menu_items as unknown as { id: number; name: string; price: number; image_url: string | null; restaurant_id: number }
            return {
              menu_item_id: item.id, restaurant_id: item.restaurant_id,
              // Filled in below once `restaurants` is known -- this query has
              // no join to restaurants and isn't compound-scoped, so the name
              // isn't available here yet.
              restaurant_name: '',
              name: item.name, price: item.price, image_url: item.image_url,
            }
          })
        setFeaturedProducts(cards)
      })
  }, [])

  // Coverage-safe: `restaurants` already reflects which vendors deliver to
  // the chosen compound (publicCatalog('restaurants', {compoundId}) above),
  // so a featured item whose restaurant does not deliver here is dropped
  // rather than promoting a dish the customer cannot actually order.
  //
  // Also open-safe. `restaurants` holds every covering vendor, open or not --
  // openRestaurants below is the further filter the main list uses -- and
  // this shelf skipped that filter entirely, so a closed restaurant's dish
  // sat right on Home advertising a shop that would just say "مغلق" the
  // moment someone tapped it.
  const coveredFeaturedProducts = featuredProducts
    .map(p => {
      const r = restaurants.find(r => r.id === p.restaurant_id)
      return r && r.is_open ? { ...p, restaurant_name: r.name } : null
    })
    .filter((p): p is FeaturedProductCard => p !== null)

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
          if (saved) setCompoundId(saved)
          return
        }
        setCompounds(data ?? [])
        if (saved) setCompoundId(saved)
        // NOTHING ELSE HAPPENS HERE ON A FIRST VISIT, AND THAT IS THE POINT.
        //
        // This used to do two things to a stranger before they had seen a
        // single price: open the «فين مكانك؟» modal over an empty screen, and
        // fire locateMe() -- which in turn asked for GPS permission on
        // page load and, when that was refused or unavailable, printed an error
        // telling them to go and change their browser settings.
        //
        // In Facebook's in-app browser, where 4,049 of 4,770 ad clicks landed,
        // there is no reachable settings screen, so that instruction could not
        // be followed. Between 7 and 16 August those 4,770 paid arrivals
        // produced ZERO orders, while organic visitors -- people who already
        // knew what was behind the gate -- picked a compound 48% of the time.
        //
        // So: no modal, no permission prompt, no error. The catalogue renders
        // unfiltered (see the restaurants effect below) and the customer is
        // asked where they are when it starts to matter -- at checkout, which
        // still requires a compound, or whenever they tap the picker.
        // locateMe() still exists and still works; it now runs only when
        // somebody presses the button that asks for it.
      })
  }

  useEffect(() => {
    loadCompounds()

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

  }, [foodQ, compoundId])

  useEffect(() => {
    setLoading(true)
    setRestaurantsFailed(false)
    // No compound means "browsing before telling us where they are", not an
    // error. public-catalog treats an ABSENT compoundId as a request for the
    // whole catalogue (restaurants_all_public); a malformed one is still
    // rejected, so this cannot widen the list by accident.
    //
    // The gap is small and measured: 16 vendors platform-wide against a
    // per-compound average of 15.3 (min 7, max 16, across 85 compounds, none
    // with zero coverage). As soon as a compound is chosen this effect re-runs
    // and the list narrows to the vendors that actually deliver there, and
    // place_order rejects an out-of-coverage vendor regardless.
    publicCatalog<Restaurant[]>('restaurants', compoundId ? { compoundId } : {})
      .then(async res => {
        if (!res.ok) { setRestaurants([]); setRestaurantsFailed(true); setLoading(false); return }
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
        const bestPct = new Map<number, number>()
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
  }, [compoundId, restaurantsAttempt])

  function choose(id: number) {
    setCompoundId(id)
    setStoredCompoundId(id)
    setPicking(false)
  }

  // Named locateMe, not useMyLocation. It is an ordinary click handler that
// calls no hooks -- but any name starting with `use` makes React's
// rules-of-hooks lint treat it as one, and calling it from an onClick then
// looks like a hook called inside a callback.
  function locateMe(compoundsList: Compound[] = compounds) {
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
      () => finish('الموقع اتأخر. اكتب اسم مكانك تحت'),
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
          setLocationError(`تحديد الموقع مش دقيق (نطاق خطأ حوالي ${accKm >= 1 ? `${Math.round(accKm)} كم` : `${Math.round(accuracy)} متر`}). دوّر على اسم مكانك تحت، هيبقى أدق.`)
          finish()
          return
        }
        if (nearestKm !== null && nearestKm > 15) {
          setNearby(null)
          setLocationError(`الموقع اللي وصلنا بيه بعيد عن كل أماكننا (أقربها ${Math.round(nearestKm)} كم). دوّر على اسم مكانك تحت.`)
          finish()
          return
        }

        setNearby(ranked.slice(0, 3))
        finish()
      },
      err => {
        // Naming the reason still matters -- "timeout" is worth another tap and
        // "denied" is not -- but EVERY branch now leads with the thing that
        // always works: type the name.
        //
        // The denied branch used to read «فعّلها من إعدادات المتصفح» -- enable it
        // in your browser settings. Inside Facebook's in-app browser, where
        // 4,049 of 4,770 paid arrivals landed, there is no settings screen to
        // reach, so the only instruction on the customer's first screen was one
        // they could not carry out. Never send someone somewhere they cannot go.
        finish(
          err.code === err.PERMISSION_DENIED
            ? 'مفيش مشكلة. اكتب اسم مكانك تحت وهتلاقيه'
            : err.code === err.TIMEOUT
              ? 'الموقع اتأخر. اكتب اسم مكانك تحت، أو جرب تاني'
              : 'مش قادرين نوصل لموقعك. اكتب اسم مكانك تحت'
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
  const { fee: deliveryFee } = useDeliveryQuote(compoundId)
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
  // Folded on both sides, not just lowercased: «كشرى» and «كشري» are the same
  // word to a customer and two different strings to includes().
  const matchedVendors = foodQ.trim().length >= 2
    ? (() => {
        const q = normaliseArabic(foodQ).toLowerCase()
        return catalogRestaurants.filter(r =>
          normaliseArabic(r.name).toLowerCase().includes(q) ||
          normaliseArabic(r.category ?? '').toLowerCase().includes(q))
      })()
    : []
  const filtered = search.trim() ? compounds.filter(c => c.name.toLowerCase().includes(search.toLowerCase())) : []

  // These used to be gated on compoundId, on the reasoning that "without one
  // there is nothing for either destination to deliver to yet". That is the
  // same argument finding 01 overturned for the restaurant list: gating the
  // storefront on a location is what turned 4,770 ad clicks into zero orders.
  // The fix was applied to the vendor list and not to these, so two of the
  // three businesses stayed invisible to anyone who had not picked a place.
  //
  // /custom-order carries its own compound state and its own picker, so it is
  // perfectly able to ask when it actually needs to know.
  const quickAccessTiles = (
    <div className="grid grid-cols-2 gap-2.5 mb-4">
      {([['supermarket', 'سوبر ماركت'], ['pharmacy', 'صيدلية']] as const).map(([type, label]) => {
        const art = VENDOR_TYPE_ART[type]
        return (
          <Link key={type} to={`/custom-order?type=${type}`}
            className="card p-2.5 flex items-center gap-2 hover:border-sea/50 transition-colors">
            {/* colour on the TILE, not the icon: Icon paints with currentColor,
                so the tile owns both halves of the pairing. */}
            <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0"
              style={{ background: art.tint, color: art.ink }}>
              <Icon name={art.icon} size="md" />
            </span>
            <span className="font-bold text-sm truncate">{label}</span>
          </Link>
        )
      })}
    </div>
  )

  // Interleave the restaurant list with the featured-products shelf (once,
  // after the 3rd card) and feed ads (round-robin, every 5th card after
  // that). Built as a flat node array rather than nested conditionals inside
  // the .map() below so the insertion points are declared once, here, and the
  // render loop just walks the result.
  const restaurantFeed: ReactNode[] = []
  let adCursor = 0
  openRestaurants.forEach((r, i) => {
    restaurantFeed.push(
      <RestaurantCard key={r.id} restaurant={r} etaMinutes={selected ? eta(r) : null} discountLabel={discountLabels.get(r.id)} />
    )
    const position = i + 1
    if (position === 3 && coveredFeaturedProducts.length > 0) {
      restaurantFeed.push(<FeaturedProductsRail key="featured-products" items={coveredFeaturedProducts} />)
    }
    if (position % 5 === 0 && feedAds.length > 0) {
      const ad = feedAds[adCursor % feedAds.length]
      adCursor += 1
      restaurantFeed.push(<FeedAdCard key={`feed-ad-${position}`} ad={ad} />)
    }
  })

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
            <Icon name="locationDot" size="sm" className="shrink-0 text-sea" />
            <span className="font-bold text-[17px] truncate">{selected ? selected.name : 'اختر مكانك'}</span>
            <Icon name="caretDown" size="xs" className="text-mist shrink-0" />
          </span>
        </button>
        {/* Neutral, not coral. A delivery fee is an ordinary fact, and coral is
            the accent colour -- it made the one number nobody is worried about
            the loudest thing in the header. */}
        {deliveryFee !== null && (
          <span className="shrink-0 text-[11px] font-bold text-mist bg-shellup border border-line rounded-lg px-2.5 py-1 mt-3">
            {deliveryFee} ج.م توصيل
          </span>
        )}
      </div>

      {/* One box, two kinds of answer: vendor names matched locally, dishes
          matched on the server across every vendor delivering here. */}
      {/* The box itself was gated on compoundId, so a first-time visitor -- the
          exact person a paid click delivers -- had no way to search at all.
          Vendor names are matched client-side and need no location, so the box
          works the moment it is shown.

          Dish search still does need one: searchMenu calls
          search_menu_for_compound, which is scoped to a compound by design.
          Rather than hide the whole control for the half it cannot do, say so
          when someone types without a place set. */}
      <div className="relative mb-3">
        <input className="field !pr-10" value={foodQ} onChange={e => setFoodQ(e.target.value)}
          aria-label="دوّر على مطعم أو أكلة"
          placeholder={compoundId ? 'دوّر على مطعم أو أكلة…' : 'دوّر على مطعم…'} />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-mist pointer-events-none">
          <Icon name="magnifyingGlass" size="sm" />
        </span>
        {foodQ.trim() && (
          <button className="absolute left-3 top-1/2 -translate-y-1/2 text-mist text-sm"
            aria-label="مسح" onClick={() => setFoodQ('')}><Icon name="x" size="sm" /></button>
        )}
      </div>
      {!compoundId && foodQ.trim().length >= 2 && (
        <p className="text-xs text-mist -mt-1 mb-3">
          اختار مكانك عشان ندوّرلك في الأصناف كمان، مش في أسامي المطاعم بس
        </p>
      )}

      {/* Ads sit above the fee strip but below the place picker: the compound
          decides everything else on this screen, so it stays first.

          صيدلية / سوبر ماركت share that same top-of-content slot with the ad
          rail rather than owning a fixed position of their own: under real
          banners when there are any (an admin who paid for that space should
          not have it shared), but promoted above -- filling the gap, not
          leaving one -- the moment there are none. */}
      {!hasBanners && quickAccessTiles}
      <BannerRail onBanners={setHasBanners} />
      {hasBanners && quickAccessTiles}

      {/* The delivery-fee strip that used to sit here has moved onto each
          restaurant card. It still has to appear before the cart -- the reason
          it existed is a customer meeting a 350 ج.م fee for the first time at
          checkout -- but as one number in the card's meta line rather than a
          boxed banner competing with the list. */}

      {loading && <p className="text-mist">جاري التحميل…</p>}

      {/* There is no separate «اختار مكانك» card here.
          There was one for a few hours: a full-width invitation above the food.
          It said exactly what the header control two rows above it already
          says, so the screen asked the same question twice and spent a chunk of
          the first viewport doing it. The header button carries it alone --
          it grows a prompt underneath itself while no place is set (see the
          header block above), which is the same nudge in the space that was
          already committed to it. */}

      {/* The compounds query itself failed -- a different problem from having no
          compound chosen, and the only one that still needs its own card,
          because without the list the picker cannot be used at all. The
          catalogue below still renders unfiltered, so the customer can browse
          while this is broken. */}
      {!loading && !compoundId && compoundsFailed && (
        <div className="card p-4 mb-3 text-center">
          <p className="font-semibold text-sm">مش قادرين نحمّل الأماكن</p>
          <p className="text-xs text-mist mt-1 mb-3">اتأكد إن النت شغال وجرب تاني. تقدر تتفرج على المطاعم دلوقتي.</p>
          <button className="btn-sea !py-2 !px-5 text-sm" onClick={loadCompounds}>جرب تاني</button>
        </div>
      )}

      {/* The صيدلية / سوبر ماركت tiles that were here are gone at Wael's call,
          2026-08-05. They are reachable from the bottom nav. */}

      {!loading && (
        <div id="restaurants">
          {/* Browse by kind. Until now the only way to find food was to already
              know which restaurant sold it -- there was no way to ask "who does
              seafood?". Only kinds that actually have a vendor delivering here
              are offered, so tapping one can never land on an empty list. */}
          {/* Two lines, icon over label. On one line the emoji and the word
              competed for the same horizontal space and the rail read as a run of
              similar-width pills. Stacked, the icon is what you scan and the word
              confirms it.

              The idle state was bg-shellup/60 -- a 60% wash of an already pale
              surface, so a chip barely separated from the page. Solid surface with
              a real border now, and the active state is ink rather than a tint, so
              which one is on is unmistakable.

              There is no «إلغاء الفلتر» button any more: onClick already does
              setKind(kind === k ? null : k), so tapping the active chip clears it.
              The button was a second control for behaviour the chip already had. */}
          {SHOW_CATEGORY_CHIPS && availableKinds.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1 mb-4 -mx-4 px-4 scrollbar-none">
              {availableKinds.map(({ kind: k, emoji }) => {
                return (
                  <button key={k} aria-pressed={kind === k} aria-label={k} title={k}
                    className={`shrink-0 w-[58px] rounded-xl border px-2 py-2.5 transition-colors ${
                      kind === k
                        ? 'bg-foam text-night border-foam'
                        : 'bg-shell border-line text-foam hover:border-sea/40'}`}
                    onClick={() => setKind(kind === k ? null : k)}>
                    {/* Icon only. The label lives in aria-label rather than on
                        screen, so the rail stays a row of recognisable shapes and
                        a screen reader still hears the category name. */}
                    <span className="block text-2xl leading-none" aria-hidden="true">{emoji}</span>
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
                  مفيش نتائج لـ «{foodQ.trim()}». جرب اسم تاني
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
            {/* Order matters: the failure state has to win. A network
                failure and a genuinely uncovered compound both leave
                shownRestaurants empty, and telling the customer their
                location has no delivery coverage when we simply could not
                read the list is a false statement, not an empty state. */}
            {restaurantsFailed && (
              <div className="card p-6 text-center">
                <p className="font-semibold">مش قادرين نجيب المطاعم دلوقتي</p>
                <p className="text-sm text-mist mt-1 mb-4">اتأكد إن النت شغال وجرب تاني.</p>
                <button className="btn-sea !py-2 !px-5 text-sm" onClick={() => setRestaurantsAttempt(a => a + 1)}>
                  جرب تاني
                </button>
              </div>
            )}
            {/* «بتوصل لمكانك» -- "delivers to your place" -- is only true once a
                place is known. With no compound chosen the list is the whole
                catalogue, so an empty one means the filter matched nothing, not
                that nowhere delivers to them. */}
            {!restaurantsFailed && shownRestaurants.length === 0 && (
              <EmptyState compact icon="forkKnife"
                title={kind ? `مفيش مطاعم ${kind} دلوقتي` : 'مفيش مطاعم متاحة دلوقتي'}
                body={compoundId ? 'جرب قسم تاني أو شوف اللي هيفتحوا بعدين' : undefined}
                action={kind ? { label: 'شوف كل المطاعم', onClick: () => setKind(null) } : undefined} />
            )}
            {restaurantFeed}

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
                          <span className="text-[10px] text-coral-700 block">{openLabel(r).text}</span>
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
          aria-labelledby="place-picker-title"
          onClick={() => setPicking(false)}>
          <div className="card w-full max-w-md p-4 max-h-[85vh] overflow-y-auto relative" onClick={e => e.stopPropagation()}>
            {/* Unconditional. This close button, the backdrop and Escape used
                to work only *while a compound was already selected*, so on a
                first visit the dialog had no exit at all. */}
            <button className="absolute top-2 left-2 w-11 h-11 grid place-items-center text-mist hover:text-foam text-xl"
              aria-label="إغلاق" onClick={() => setPicking(false)}><Icon name="x" size="sm" /></button>
            <h3 id="place-picker-title" className="font-bold text-lg mb-3">فين مكانك؟</h3>

            {compoundsFailed && (
              <div className="bg-dangerbg rounded-xl p-3 mb-3 text-center">
                <p className="text-sm text-danger">مش قادرين نجيب الأماكن دلوقتي</p>
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
                <Icon name="magnifyingGlass" size="sm" className="shrink-0 text-mist" />
                <input className="flex-1 min-w-0 bg-transparent focus:outline-none placeholder:text-mist/60" value={search}
                  onChange={e => { setSearch(e.target.value); if (e.target.value.trim()) setNearby(null) }}
                  aria-label="دوّر على اسم المكان"
            placeholder="دوّر على اسم المكان…" />
              </div>
              <button className="w-12 h-12 rounded-xl border border-line bg-night grid place-items-center shrink-0 disabled:opacity-60"
                disabled={locating} onClick={() => locateMe()}
                title="استخدم موقعي الحالي" aria-label="استخدم موقعي الحالي">
                {locating
                  ? <span className="inline-block w-4 h-4 rounded-full border-2 border-mist/40 border-t-sea animate-spin" />
                  : <Icon name="locationDot" size="sm" className="text-sea" />}
              </button>
            </div>

            {locationError && <p className="text-xs text-coral-700 mb-3 text-center">{locationError}</p>}

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
