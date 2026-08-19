import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCart } from '../lib/cart'
import ProductCard from '../components/ProductCard'
import ProductDetailSheet from '../components/ProductDetailSheet'
import CustomizeSheet from '../components/CustomizeSheet'
import Icon from '../components/Icon'
import { useDismissable } from '../lib/useDismissable'
import { sized, IMG } from '../lib/imageUrl'
import { isItemAvailableNow } from '../lib/itemAvailability'
import { useDeliveryQuote } from '../lib/deliveryQuote'
import { applyDiscount, effectiveDiscount } from '../lib/discounts'
import { priceLine } from '../lib/linePricing'
import type { Compound, Discount, MenuItem, MenuItemAddon, MenuItemAddonGroup, MenuItemCombo, MenuItemSize, Restaurant } from '../lib/types'
import { getCompoundId } from '../lib/place'
import { track } from '../lib/analytics'
import { publicCatalog } from '../lib/publicCatalog'
import { useCatalogSync } from '../lib/useCatalogSync'

const ALL = '__all__'

export default function RestaurantDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const cart = useCart()
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [items, setItems] = useState<MenuItem[]>([])
  const [sizes, setSizes] = useState<MenuItemSize[]>([])
  const [combos, setCombos] = useState<MenuItemCombo[]>([])
  // Items arrive one round trip before their sizes/combos/add-ons do. In that
  // window every card computed hasOptions=false and priced from
  // menu_items.price -- so "6 وينجز" showed 190 with a direct + button while
  // its only size is 300. Tapping it built a line with sizeId:null that the
  // cart happily priced at 190 and place_order refuses with size_required,
  // with no size control anywhere on the cart or checkout to fix it. The
  // basket was dead until "مسح الكل".
  const [optionsLoaded, setOptionsLoaded] = useState(false)
  const [addonGroups, setAddonGroups] = useState<MenuItemAddonGroup[]>([])
  const [addons, setAddons] = useState<MenuItemAddon[]>([])
  const [discounts, setDiscounts] = useState<Discount[]>([])
  const [customizing, setCustomizing] = useState<MenuItem | null>(null)
  const customizationFinished = useRef(false)
  // What is currently stopping CustomizeSheet's add button, kept up to date by
  // the sheet itself and read when it is dismissed. See abandonCustomization.
  const customizeBlocked = useRef<string | null>(null)
  const [detailItem, setDetailItem] = useState<MenuItem | null>(null)
  // أرابياتا has 85 items across 8 categories. Categories are a filing system,
  // not a way to find one specific dish, and there was nothing else.
  const [menuQ, setMenuQ] = useState('')
  // The box is closed by default. It sat permanently above the chips saying
  // «دوّر في قايمة ماكدونالدز» -- a whole 40px row asking a question most
  // people do not have, on a screen whose job is to show food. The magnifier
  // on the cover opens it, which is the same control Talabat uses.
  const [searchOpen, setSearchOpen] = useState(false)
  // An add that would replace a basket belonging to another restaurant waits
  // here until the customer says yes.
  const [pendingAdd, setPendingAdd] = useState<(() => void) | null>(null)
  // Which section the customer is currently looking at, tracked so the sticky
  // bar can say where they are. Every section is rendered at once now -- the
  // chips scroll to a heading rather than filtering the page down to one.
  const [visibleCat, setVisibleCat] = useState<string | null>(null)
  const [headerGone, setHeaderGone] = useState(false)
  const headerSentinel = useRef<HTMLDivElement | null>(null)
  const [compounds, setCompounds] = useState<Compound[]>([])
  // The chosen category lives in the URL, not in component state.
  //
  // As state, tapping a category then pressing the phone's Back button left the
  // restaurant completely -- Back had nothing of ours to consume, so it fell
  // through to the router. On Android, where Back is the primary navigation
  // gesture, a customer filtering to "دجاج" and then wanting the full menu
  // again got thrown out to the restaurant list instead. In the URL, Back
  // returns them to "الكل", and a link to a filtered menu can be shared.
  const [searchParams, setSearchParams] = useSearchParams()
  const activeCat = searchParams.get('cat') || ALL
  const setActiveCat = (cat: string) => {
    const next = new URLSearchParams(searchParams)
    if (cat === ALL) next.delete('cat'); else next.set('cat', cat)
    setSearchParams(next)
  }
  // The chip bar pins to the top, so a section scrolled with scrollIntoView
  // landed UNDER it. Measure the bar and land the heading just below its
  // bottom edge instead of guessing a constant.
  //
  // Motion, per Apple's HIG: it is here to explain where the content went, so
  // it is a single continuous move, and Reduce Motion turns it into an instant
  // jump rather than a slower animation. The tapped chip also slides itself
  // into view horizontally, so the bar never leaves the active chip offscreen.
  const chipBarRef = useRef<HTMLDivElement | null>(null)
  // «الكل» returns to the top of the menu rather than filtering: the list is
  // already complete, so "all" can only mean "start again from the beginning".
  const jumpToAll = () => {
    setActiveCat(ALL)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const first = document.querySelector<HTMLElement>('section[data-cat]')
    if (!first) return
    const bar = chipBarRef.current
    const barH = bar?.getBoundingClientRect().height ?? 0
    const stickyTop = bar ? parseFloat(getComputedStyle(bar).top) || 0 : 0
    const top = Math.max(0, first.getBoundingClientRect().top + window.scrollY - stickyTop - barH - 8)
    const far = Math.abs(top - window.scrollY) > window.innerHeight * 2
    window.scrollTo({ top, behavior: reduce || far ? 'auto' : 'smooth' })
  }

  const jumpToCategory = (cat: string) => {
    setActiveCat(cat)
    const section = document.getElementById(`cat-${cat}`)
    if (!section) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const targetTop = () => {
      const bar = chipBarRef.current
      const barH = bar?.getBoundingClientRect().height ?? 0
      // The bar's own sticky offset (the compact header above it) counts too --
      // read it rather than hard-coding 48, so safe-area insets are included.
      const stickyTop = bar ? parseFloat(getComputedStyle(bar).top) || 0 : 0
      return Math.max(0, section.getBoundingClientRect().top + window.scrollY - stickyTop - barH - 8)
    }
    // Animate only when the animation can still be read as a movement. A long
    // menu puts «صوصات» 7,800px away, and gliding that whole distance is
    // several seconds of blurred content -- motion that makes you wait rather
    // than telling you where you went. Past two screens, cut instead.
    const far = Math.abs(targetTop() - window.scrollY) > window.innerHeight * 2
    window.scrollTo({ top: targetTop(), behavior: reduce || far ? 'auto' : 'smooth' })
    // The dish images below the fold are lazy, so the document is still short
    // when the jump starts: a near section landed ~28px off and a far one did
    // not move at all, because the browser clamped the target to a height the
    // page had not grown into yet. Re-measure once layout settles and close the
    // gap. Silent when there is nothing to correct.
    let tries = 0
    const settle = () => {
      const top = targetTop()
      if (Math.abs(window.scrollY - top) > 4) window.scrollTo({ top, behavior: 'auto' })
      if (++tries < 3) setTimeout(settle, 220)
    }
    setTimeout(settle, reduce || far ? 60 : 420)
    chipBarRef.current
      ?.querySelector(`[data-chip="${CSS.escape(cat)}"]`)
      ?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest', inline: 'center' })
  }

  // Same rule as the home card: the vendor's own cover when set, otherwise
  // the best-ranked photographed dish, computed server-side.
  const cover = restaurant?.cover_image_url || restaurant?.hero_image_url || null

  // One order is tied to one vendor, so adding here empties a basket built
  // somewhere else. That is the customer's call, not ours -- it used to happen
  // silently the moment this page loaded.
  const otherVendorInCart =
    cart.count > 0 && cart.restaurantId != null && cart.restaurantId !== Number(id)
  const guardAdd = (run: () => void) => {
    if (otherVendorInCart) setPendingAdd(() => run)
    else run()
  }

  const [loadFailed, setLoadFailed] = useState(false)
  const [catalogRevision, setCatalogRevision] = useState(0)

  useCatalogSync({
    restaurantId: Number(id),
    refresh: () => setCatalogRevision(revision => revision + 1),
    fallbackIntervalMs: 45_000,
  })

  useEffect(() => {
    // The error was discarded, so a bad id, an RLS denial or being offline all
    // produced restaurant === null and an eternal "جاري التحميل…" with no
    // message and no way back (the back link sits below the early return).
    setLoadFailed(false)
    setOptionsLoaded(false)
    // restaurant_public() rather than the table, because the table has no
    // review_count -- and without it this page displayed restaurants.rating
    // unconditionally. That column is hand-typed and unconnected to
    // order_ratings: 8 of the 9 catalogue vendors have never been rated and all
    // of them showed a score, including "★ 3.0" on كنتاكي. The home card had
    // the count and suppressed it correctly; this page did not and could not.
    publicCatalog<Restaurant | null>('restaurant', { restaurantId: Number(id) }).then(res => {
      if (!res.ok || !res.data) { setLoadFailed(true); return }
      setRestaurant(res.data)
    })
    supabase.from('menu_items').select('*').eq('restaurant_id', id).eq('available', true).then(async ({ data }) => {
      const list = data ?? []
      setItems(list)
      if (!list.length) setOptionsLoaded(true)
      if (list.length) {
        const ids = list.map(it => it.id)
        const [{ data: sz }, { data: gr }, { data: cb }] = await Promise.all([
          supabase.from('menu_item_sizes').select('*').in('menu_item_id', ids).eq('available', true).order('display_order').order('id'),
          supabase.from('menu_item_addon_groups').select('*').in('menu_item_id', ids).order('display_order').order('id'),
          supabase.from('menu_item_combos').select('*').in('menu_item_id', ids).eq('available', true).order('display_order').order('id')
        ])
        setSizes(sz ?? [])
        setCombos((cb as MenuItemCombo[]) ?? [])
        setAddonGroups(gr ?? [])
        const groupIds = (gr ?? []).map(g => g.id)
        if (groupIds.length) {
          const { data: ad, error: adErr } = await supabase.from('menu_item_addons').select('*').eq('available', true).in('group_id', groupIds).order('display_order').order('id')
          // A required add-on group with no add-ons in it is unanswerable:
          // CustomizeSheet shows the group, the customer cannot pick anything,
          // and place_order rejects the order with addon_group_min_not_met at
          // the final tap. Leaving optionsLoaded false keeps the sheet closed
          // instead, which is the honest failure.
          if (adErr) return
          setAddons(ad ?? [])
        }
        setOptionsLoaded(true)
      }
    })
    supabase.from('compounds').select('*').eq('active', true).order('direction').order('distance_km')
      .then(({ data }) => setCompounds(data ?? []))
    supabase.from('discounts').select('*').eq('restaurant_id', id).eq('active', true)
      .then(({ data }) => setDiscounts(data ?? []))
  }, [id, catalogRevision])

  useEffect(() => {
    if (restaurant && restaurant.order_mode === 'catalog') cart.setForRestaurant(restaurant)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant?.id])

  // Deep link into a single item's sheet -- e.g. Home's featured-products
  // shelf, which used to only be able to land someone on the restaurant page
  // and make them go find the dish themselves. Guarded to fire once: without
  // openedFromUrlRef, closing the sheet while ?item= was still in the URL
  // (or any catalogRevision refetch) would pop it straight back open.
  const openedFromUrlRef = useRef(false)
  useEffect(() => {
    if (openedFromUrlRef.current || !items.length) return
    const itemParam = searchParams.get('item')
    if (!itemParam) return
    openedFromUrlRef.current = true
    const found = items.find(it => it.id === Number(itemParam))
    if (found) setDetailItem(found)
    // Consumed either way -- an invalid/stale id should not linger and retry
    // forever, and a valid one has done its job once the sheet is open.
    const next = new URLSearchParams(searchParams)
    next.delete('item')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  // Funnel step 3. Keyed on the LOADED restaurant rather than the URL param, so
  // a vendor that failed to load is not counted as one the customer opened --
  // that would make a broken page look like interest.
  useEffect(() => {
    if (restaurant) track('vendor_opened', {
      restaurantId: restaurant.id,
      compoundId: getCompoundId(),
      props: { is_open: restaurant.is_open, order_mode: restaurant.order_mode },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant?.id])

  // Pharmacy/supermarket go through the Custom Order flow. This used to call
  // nav() directly in the render body, which is a router state update during
  // render -- React warns, and the redirect can double-fire under StrictMode.
  //
  // The vendor's own type is carried across. Without it the customer tapped a
  // named pharmacy and landed on an untyped chooser listing every pharmacy AND
  // every supermarket -- one step further from the thing they had just picked.
  useEffect(() => {
    if (restaurant?.order_mode === 'custom_request') {
      const t = restaurant.vendor_type === 'supermarket' ? 'supermarket' : 'pharmacy'
      // Carry the id, not just the type. With the type alone, tapping a NAMED
      // pharmacy landed on a chooser listing every pharmacy -- the choice the
      // customer had just made was thrown away while its id was in hand.
      nav(`/custom-order?type=${t}&vendor=${restaurant.id}`, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant?.order_mode])

  const categories = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    for (const it of items) if (!seen.has(it.category)) { seen.add(it.category); list.push(it.category) }
    return list
  }, [items])

  const menuQuery = menuQ.trim().toLowerCase()
  const shown = (cat: string) => items.filter(it =>
    it.category === cat
    && isItemAvailableNow(it.available_from, it.available_until)
    && (!menuQuery || it.name.toLowerCase().includes(menuQuery) || it.category.toLowerCase().includes(menuQuery)))
  const menuMatchCount = menuQuery
    ? items.filter(it => isItemAvailableNow(it.available_from, it.available_until)
        && (it.name.toLowerCase().includes(menuQuery) || it.category.toLowerCase().includes(menuQuery))).length
    : 0

  function openCustomization(item: MenuItem) {
    customizationFinished.current = false
    customizeBlocked.current = null
    track('customization_opened', {
      restaurantId: restaurant?.id,
      props: { item_id: item.id },
    })
    setCustomizing(item)
  }

  function abandonCustomization() {
    if (!customizing) return
    if (!customizationFinished.current) {
      customizationFinished.current = true
      // Three quarters of the people who open this sheet leave without adding
      // anything (40 of 52 devices, 9-15 August), and the event used to record
      // only that it happened. `reason` separates the two cases that need
      // completely different fixes: 'changed_mind' means the add button was
      // live and they chose not to press it, which is pricing or appetite;
      // anything else means the button was disabled and they could not have
      // added the item even if they wanted to, which is a UI problem.
      track('customization_abandoned', {
        restaurantId: restaurant?.id,
        props: {
          item_id: customizing.id,
          reason: customizeBlocked.current ?? 'changed_mind',
        },
      })
    }
    customizeBlocked.current = null
    setCustomizing(null)
  }

  // The basket total, computed from the SAME linePrice() the cart and checkout
  // use. Re-deriving it here with a second formula is exactly how a screen ends
  // up disagreeing with the cart about what the customer owes.
  const cartSubtotal = cart.lines.reduce((sum, l) => {
    const p = priceLine(l, { items, sizes, combos, addons, discounts })
    return sum + p.unit * l.qty
  }, 0)
  // Scroll-spy. IntersectionObserver rather than a scroll listener: the browser
  // does the work off the main thread, and a 76-item grid of images is exactly
  // where a scroll handler starts costing frames.
  //
  // rootMargin pulls the detection line down to just under the sticky bar, so a
  // section counts as "current" when its heading reaches the bar rather than
  // when it enters the viewport at the bottom.
  // A stable string key for the category list, so the dependency array holds
  // something the linter can check rather than a call.
  const categoryKey = categories.join('|')
  useEffect(() => {
    if (menuQuery) return
    const sections = Array.from(document.querySelectorAll<HTMLElement>('section[data-cat]'))
    if (!sections.length) return
    const io = new IntersectionObserver(entries => {
      const hit = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (hit) setVisibleCat((hit.target as HTMLElement).dataset.cat ?? null)
    }, { rootMargin: '-64px 0px -70% 0px', threshold: 0 })
    sections.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [categoryKey, menuQuery])

  // Show the compact bar only once the real header has scrolled away, so the
  // two are never on screen saying the same thing.
  useEffect(() => {
    const el = headerSentinel.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setHeaderGone(!e.isIntersecting), { threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [restaurant?.id])

  // ?cat= still means something now that the chips scroll instead of filter:
  // arriving with one jumps to that section. Without this the param would write
  // itself into the URL on every chip tap and do nothing on the way back --
  // and the Back-button behaviour the comment above describes would be a lie.
  const jumpedRef = useRef(false)
  useEffect(() => {
    if (jumpedRef.current || activeCat === ALL || !categories.length || menuQuery) return
    jumpedRef.current = true
    // One frame, so the sections exist in the DOM before we look for one.
    requestAnimationFrame(() => {
      document.getElementById(`cat-${activeCat}`)?.scrollIntoView({ behavior: 'auto', block: 'start' })
    })
  }, [activeCat, categories.length, menuQuery])

  const compoundId = getCompoundId()
  const selectedCompound = compounds.find(c => c.id === compoundId)
  // This line was right all along, and was the only place in the product that
  // was. The server wrote orders.sla_minutes from distance alone and ignored
  // prep entirely; sla_minutes_for() in the database now does exactly what this
  // does. Kept as the local render so the card still shows something while the
  // quote is in flight -- but it is no longer the only correct copy.
  const totalEta = restaurant && selectedCompound
    ? { min: restaurant.prep_minutes + selectedCompound.est_travel_minutes_min, max: restaurant.prep_minutes + selectedCompound.est_travel_minutes_max }
    : null
  // The fee is no longer printed on this page -- it belongs to the compound and
  // the home header already states it -- but the quote still drives totalEta.
  useDeliveryQuote(compoundId, restaurant?.id)

  if (loadFailed) return (
    <div className="card p-6 text-center max-w-sm mx-auto mt-6">
      <p className="font-semibold">مش قادرين نفتح المطعم ده</p>
      <p className="text-sm text-mist mt-1.5">يمكن يكون اتقفل أو في مشكلة في الاتصال</p>
      <Link to="/" className="btn-sea mt-4 inline-block">العودة للمطاعم</Link>
    </div>
  )

  if (!restaurant) return <p className="text-mist">جاري التحميل…</p>
  if (restaurant.order_mode === 'custom_request') return null // redirect runs in the effect above

  return (
    // The cart bar is `fixed`, so it floats OVER the last row of the grid --
    // in the 2026-08-07 screenshot it was covering the prices of the bottom two
    // items outright. Reserve its height plus the tab bar underneath it, but
    // only while it is actually on screen, so an empty cart does not leave a
    // band of dead space at the end of the menu.
    <div className={cart.count > 0 && restaurant.is_open ? 'pb-24' : undefined}>
      {/* WHERE AM I, and how do I search, after 76 items have scrolled past.
          Deliberately NOT the whole header stuck to the top -- just the name,
          the section currently on screen, and a way back to the search box.
          The section label updates itself as you scroll, so the bar answers
          "where am I" and not merely "which restaurant is this". */}
      {headerGone && (
        <div className="fixed top-0 inset-x-0 z-30 bg-shell/95 backdrop-blur border-b border-line"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="max-w-5xl mx-auto px-4 h-12 flex items-center gap-2">
            <button className="text-mist shrink-0" aria-label="لفوق"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              <Icon name="chevronLeft" size="xs" className="rotate-90" />
            </button>
            {/* The full header carries the logo; the sticky bar that replaces it
                on scroll dropped it, so the one strip that stays on screen was
                the only place the vendor was not identifiable at a glance. */}
            {restaurant.logo_url
              ? <img src={restaurant.logo_url} alt="" className="w-6 h-6 rounded-md object-cover shrink-0 border border-line" />
              : <span className="w-6 h-6 rounded-md bg-shellup grid place-items-center shrink-0 text-[11px] font-bold text-mist">{restaurant.name.charAt(0)}</span>}
            <span className="font-bold text-sm truncate">{restaurant.name}</span>
            {visibleCat && !menuQuery && (
              <>
                <span className="text-mist text-xs shrink-0">•</span>
                <span className="text-xs text-mist truncate">{visibleCat}</span>
              </>
            )}
            <span className="flex-1" />
            {items.length > 8 && (
              <button className="text-mist shrink-0 w-9 h-9 grid place-items-center" aria-label="بحث"
                onClick={() => {
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                  setTimeout(() => document.getElementById('menu-search')?.focus(), 350)
                }}>
                <Icon name="magnifyingGlass" size="sm" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* A cover photo, controls floating on it, and the identity card lifted
          over its bottom edge -- the shape Talabat, Waffarha and Deliveroo all
          use, because it answers "where am I" with a picture before it answers
          it with words.
          Two things are deliberately NOT here. «مفتوح» was true of every
          restaurant whose page you can open -- a closed one cannot be added to,
          and its home card is already greyed with an opening time -- so it
          asserted nothing. The delivery fee belongs to the compound, not the
          vendor: the same number on every restaurant, already stated in the
          home header, and in coral it was the loudest thing on the page. */}
      <div className="-mx-4 -mt-6">
        <div className="relative h-40 bg-shellup">
          {cover && (
            <img src={sized(cover, IMG.wide)} alt="" loading="eager" decoding="async"
              className={`absolute inset-0 w-full h-full object-cover ${restaurant.is_open ? '' : 'grayscale'}`}
              // A broken cover must not leave a grey rectangle where the food
              // should be; hiding it reveals the tint, which reads as a plain
              // header rather than a failure.
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
          )}
          {/* A scrim only under the controls. A full-cover overlay would dull
              the photograph, which is the one thing on this screen doing the
              selling. */}
          <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/35 to-transparent" />
          {/* px-4 with the -mr/-ml pulls cancelled: the visible discs line up
              with the identity card's edges below them, not 4px inside. */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-4">
            <Link to="/" aria-label="رجوع" title="رجوع"
              className="grid place-items-center min-w-[44px] min-h-[44px] -mr-1">
              {/* The page is RTL, so "back" is to the RIGHT. Icon.tsx only ships
                  chevronLeft, so it is mirrored rather than adding a glyph. */}
              <span className="w-9 h-9 rounded-full bg-white/95 text-slate-700 grid place-items-center shadow-sm">
                <Icon name="chevronLeft" size="sm" className="rotate-180" />
              </span>
            </Link>
            {items.length > 8 && (
              <button aria-label="بحث في القايمة" title="بحث في القايمة"
                className="grid place-items-center min-w-[44px] min-h-[44px] -ml-1"
                onClick={() => {
                  setSearchOpen(true)
                  setTimeout(() => document.getElementById('menu-search')?.focus(), 60)
                }}>
                <span className="w-9 h-9 rounded-full bg-white/95 text-slate-700 grid place-items-center shadow-sm">
                  <Icon name="magnifyingGlass" size="sm" />
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Lifted over the photo's bottom edge, so the two read as one object
            rather than a picture with a paragraph under it. */}
        <div className="card mx-4 -mt-9 relative z-10 p-3 flex items-center gap-3">
          {/* Closed is stated on the artwork, not in a card of its own. The
              card said «مقفول دلوقتي» in words and then offered a way out --
              a whole block of chrome for a fact the greyed-out photograph
              already tells you. The mark carries the word so it survives
              wherever the eye lands. */}
          <div className="relative w-14 h-14 shrink-0">
            {restaurant.logo_url
              ? <img src={sized(restaurant.logo_url, IMG.icon)} alt=""
                  className={`w-14 h-14 rounded-xl object-cover border border-line bg-white ${restaurant.is_open ? '' : 'grayscale'}`} />
              : <div className={`w-14 h-14 rounded-xl bg-shellup grid place-items-center text-xl font-bold text-mist ${restaurant.is_open ? '' : 'grayscale'}`}>{restaurant.name.charAt(0)}</div>}
            {!restaurant.is_open && (
              // A scrim under the word, or «مقفول» sits on whatever colour the
              // logo happens to be and is unreadable on half of them.
              <span className="absolute inset-0 rounded-xl bg-black/55 grid place-items-center text-white text-[11px] font-bold">
                مقفول
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold truncate leading-tight">{restaurant.name}</h1>
            <div className="flex items-center gap-1.5 text-[13px] text-mist flex-wrap mt-1">
              {/* ONLY when somebody has actually rated them. restaurants.rating
                  is hand-typed and unconnected to order_ratings, and a number
                  with no count behind it is not a weak signal but a false one.
                  The count itself is gone: 3 of 19 vendors have any rating, and
                  saying the 3.5 rests on two opinions weakens it. */}
              {(restaurant.review_count ?? 0) > 0 && (
                <>
                  <span className="flex items-center gap-1">
                    <Icon name="star" size="xs" className="text-coral-600" />
                    <span className="text-foam">{restaurant.rating_real ?? restaurant.rating}</span>
                  </span>
                  <span aria-hidden="true" className="text-slate-300">•</span>
                </>
              )}
              {/* A range, not a single number. "16 دقيقة تقريبًا" reads as a
                  promise; the home card already says 20-30 for the same vendor,
                  so the two screens disagreed about the same restaurant. */}
              {totalEta && (
                <span className="flex items-center gap-1">
                  <Icon name="clock" size="xs" className="text-mist" />
                  <bdi dir="ltr">{totalEta.min} – {totalEta.max}</bdi> د
                </span>
              )}
              {restaurant.category && (
                <>
                  {totalEta && <span aria-hidden="true" className="text-slate-300">•</span>}
                  <span className="truncate">{restaurant.category}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div ref={headerSentinel} aria-hidden="true" />

      {restaurant.order_mode === 'pickup_request' && (
        <p className="text-sm bg-shellup/60 rounded-xl p-3 mb-4">
          <Icon name="clipboardText" size="sm" className="inline-block align-[-0.15em] me-1" />القايمة دي للعرض بس، اطلب من {restaurant.name} على طول (تطبيقهم أو التليفون)، وهما هيتصرفوا في التوصيل
        </p>
      )}

      {restaurant.order_mode === 'pickup_request' ? (
        <div className="space-y-5">
          {categories.map(cat => (
            <div key={cat}>
              <h2 className="font-bold text-sm text-mist mb-2">{cat}</h2>
              <div className="card divide-y divide-line">
                {items.filter(it => it.category === cat).map(it => (
                  <div key={it.id} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm">{it.name}</span>
                    <span className="text-sm text-mist">{it.price} ج.م</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Category pills, hidden when there is only one category: KFC has all
              seven of its items under a single "وجبات", so the bar rendered as
              "الكل | وجبات" -- two controls that filter to the same list and
              cost a row of vertical space to say nothing. */}
          {/* A closed restaurant used to be a small grey word next to the
              name, while every + button stayed live -- so a customer could
              build a full basket and only discover at checkout that nothing
              could be ordered. That loses the app, not just the restaurant.
              The menu stays browsable on purpose; people look before a place
              opens. What is blocked is ordering, and there is a way out. */}
          {/* Search before the category pills, because it answers a different
              and more common question: "do they have X?" rather than "show me
              everything under Y". */}
          {items.length > 8 && searchOpen && (
            <div className="relative mb-3">
              <input id="menu-search" className="field !bg-white !pr-10" value={menuQ} onChange={e => setMenuQ(e.target.value)}
                aria-label={`دوّر في قايمة ${restaurant.name}`}
                placeholder={`دوّر في قايمة ${restaurant.name}…`} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-mist pointer-events-none">
                <Icon name="magnifyingGlass" size="sm" />
              </span>
              {/* Clearing an empty box closes it: otherwise the only way back
                  out of search is to leave the page. */}
              <button className="absolute left-3 top-1/2 -translate-y-1/2 text-mist"
                aria-label={menuQ.trim() ? 'مسح' : 'إغلاق البحث'}
                onClick={() => { if (menuQ.trim()) setMenuQ(''); else setSearchOpen(false) }}>
                <Icon name="x" size="sm" />
              </button>
            </div>
          )}

          {menuQuery && (
            <p className="text-xs text-mist mb-3">
              {menuMatchCount === 0
                ? `مفيش نتائج لـ «${menuQ.trim()}»`
                : `${menuMatchCount} نتيجة لـ «${menuQ.trim()}»`}
            </p>
          )}

          {/* The chips SCROLL to a section, they do not filter to one -- the
              whole menu is on the page. «الكل» is the way back to the start of
              it, on every restaurant. */}
          {categories.length > 1 && !menuQuery && (
          // Pins below the compact header, not under it. That bar is `fixed`
          // and 48px tall, so a chip row stuck to top-0 slid straight beneath
          // it and the chips were unreadable while scrolling.
          <div ref={chipBarRef}
            style={{ top: 'calc(env(safe-area-inset-top) + 48px)' }}
            className="sticky z-20 flex gap-6 overflow-x-auto mb-3 -mx-4 px-4 bg-night border-b border-line scrollbar-none">
            {/* Underlined, not filled. These tabs NAVIGATE -- the whole menu is
                already on the page -- and a filled pill is the language of a
                filter. The underline is also ~12px shorter than the pill row,
                which the header can use.
                Deliberately not the shared .tab class: that one dresses the
                admin, driver and vendor screens too, and this is a customer
                storefront decision. */}
            <button data-chip={ALL} onClick={() => jumpToAll()}
              className={`shrink-0 whitespace-nowrap text-sm font-bold pt-2.5 pb-3 border-b-[3px] -mb-px transition-colors ${
                activeCat === ALL ? 'text-foam border-sea' : 'text-mist border-transparent hover:text-foam'}`}>
              الكل
            </button>
            {categories.map(cat => (
              <button key={cat} data-chip={cat} onClick={() => jumpToCategory(cat)}
                // The tap highlights the tab itself; the scroll observer then
                // takes over as you move through the menu. Waiting for the
                // observer meant tapping gave no feedback at all. While «الكل»
                // is the choice no section tab is underlined, or two read as
                // active at once.
                className={`shrink-0 whitespace-nowrap text-sm font-bold pt-2.5 pb-3 border-b-[3px] -mb-px transition-colors ${
                  activeCat !== ALL && (visibleCat ?? activeCat) === cat
                    ? 'text-foam border-sea' : 'text-mist border-transparent hover:text-foam'}`}>
                {cat}
              </button>
            ))}
          </div>
          )}

          {categories.map(cat => shown(cat).length === 0 ? null : (
            <section key={cat} id={`cat-${cat}`} data-cat={cat} className="mb-6 scroll-mt-24">
              <h2 className="font-bold text-lg mb-3">{cat}</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {shown(cat).map(it => {
                  const itemSizes = sizes.filter(s => s.menu_item_id === it.id)
                  const itemGroups = addonGroups.filter(g => g.menu_item_id === it.id)
                  // A combo upgrade is an option like any other: the card has to
                  // route to the sheet, or the customer never sees the offer.
                  const itemCombos = combos.filter(c => c.menu_item_id === it.id)
                  // Until the options land, treat every item as if it HAS
                  // options: routing to the sheet is always safe, adding
                  // straight to the cart is not.
                  const hasOptions = !optionsLoaded || itemSizes.length > 0 || itemGroups.length > 0 || itemCombos.length > 0
                  const basePrice = itemSizes.length > 0 ? Math.min(...itemSizes.map(s => s.price)) : it.price
                  const discount = effectiveDiscount(it.id, it.category, discounts)
                  const displayPrice = applyDiscount(basePrice, discount)
                  return (
                    <ProductCard
                      key={it.id}
                      item={it}
                      qty={cart.qtyFor(it.id)}
                      disabled={!restaurant.is_open}
                      hasOptions={hasOptions}
                      displayPrice={displayPrice}
                      originalPrice={discount ? basePrice : undefined}
                      // A combo REPLACES the price and is dearer than the base,
                      // so the plain price is a starting point there too -- not
                      // only when there are sizes.
                      isFromPrice={itemSizes.length > 0 || itemCombos.length > 0}
                      onAdd={() => guardAdd(() => cart.add(it, 1))}
                      onRemove={() => cart.add(it, -1)}
                      onCustomize={() => guardAdd(() => openCustomization(it))}
                      onOpenDetail={() => setDetailItem(it)}
                    />
                  )
                })}
              </div>
            </section>
          ))}
        </>
      )}

      {detailItem && (
        <ProductDetailSheet
          item={detailItem}
          items={items.filter(it => isItemAvailableNow(it.available_from, it.available_until))}
          sizes={sizes}
          combos={combos}
          addonGroups={addonGroups}
          addons={addons}
          discounts={discounts}
          disabled={!restaurant.is_open}
          optionsLoaded={optionsLoaded}
          qtyFor={id => cart.qtyFor(id)}
          onAdd={it => cart.add(it, 1)}
          onRemove={it => cart.add(it, -1)}
          onCustomize={it => { setDetailItem(null); openCustomization(it) }}
          onClose={() => setDetailItem(null)}
        />
      )}

      {pendingAdd && (
        <SwitchVendorDialog
          onCancel={() => setPendingAdd(null)}
          onConfirm={() => { const run = pendingAdd; cart.clear(); setPendingAdd(null); run() }} />
      )}

      {customizing && (
        <CustomizeSheet
          item={customizing}
          sizes={sizes.filter(s => s.menu_item_id === customizing.id)}
          combos={combos.filter(c => c.menu_item_id === customizing.id)}
          discounts={discounts}
          addonGroups={addonGroups.filter(g => g.menu_item_id === customizing.id)}
          addons={addons.filter(a => addonGroups.some(g => g.menu_item_id === customizing.id && g.id === a.group_id))}
          onClose={abandonCustomization}
          blockedRef={customizeBlocked}
          onConfirm={(sizeId, comboId, addonIds, qty) => {
            customizationFinished.current = true
            cart.addCustomLine(customizing.id, sizeId, comboId, addonIds, qty)
            setCustomizing(null)
          }}
        />
      )}

      {/* A basket you cannot see is a basket you stop trusting.
          Adding three things meant leaving the menu for the عربتي tab just to
          learn the total, then finding your way back to the right category.
          Sticky, above the bottom nav, and only while there is something in it.
          The figure comes from priceLine() -- the same function the cart and
          the checkout use -- because this screen quoting its own total is
          precisely how two screens end up disagreeing about what is owed. */}
      {/* optionsLoaded, for the same reason CartPage and CheckoutPage gate on it.
          The fetch sets items first and only then awaits sizes/combos/add-ons,
          and the basket survives in sessionStorage -- so a reload onto this
          page with a combo in the cart priced it from menu_items.price
          (دوبل بيج تايستي: 433 instead of the 575 combo) and, in the tick
          before items land at all, showed "0 ج.م • شوف العربة" over a badge of
          1. The count is always true, so it stays; only the money waits. */}
      {cart.count > 0 && restaurant.is_open && (
        <div className="fixed inset-x-0 z-30 px-4"
          // 68px used to clear the bottom tab bar; that bar no longer renders
          // on this page, so the gap was empty space.
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 28px)' }}>
          <button className="max-w-lg mx-auto w-full bg-sea text-white rounded-2xl shadow-lg px-4 py-3.5 flex items-center justify-between gap-3"
            onClick={() => nav('/cart')}>
            {/* The count is the badge now, rather than a bare «3» sitting
                beside the same number spelled out. */}
            <span className="bg-white/20 rounded-full px-3 py-1 font-bold text-sm truncate min-w-0">
              {cart.count === 1 ? 'صنف واحد' : `${cart.count} أصناف`}
            </span>
            <span className="font-bold text-sm shrink-0">
              {optionsLoaded ? `${Math.round(cartSubtotal * 100) / 100} ج.م • ` : ''}شوف العربة
            </span>
          </button>
        </div>
      )}

    </div>
  )
}

/**
 * Asked before an add replaces a basket from another restaurant. Previously
 * the basket was emptied the moment this page opened, so a customer comparing
 * two places lost the first one with no warning and no way back.
 */
function SwitchVendorDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const ref = useDismissable<HTMLDivElement>(onCancel)
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="switch-vendor-title"
      className="fixed inset-0 z-50 bg-black/60 grid place-items-center px-6" onClick={onCancel}>
      <div className="card w-full max-w-sm p-5 rounded-2xl" onClick={e => e.stopPropagation()}>
        <h2 id="switch-vendor-title" className="font-bold text-lg mb-1">تبدأ عربية جديدة؟</h2>
        <p className="text-sm text-mist mb-5">
          عندك أصناف من مطعم تاني في عربيتك. الطلب الواحد بيبقى من مطعم واحد، فلو
          كمّلت هنا هنفضّي العربية القديمة.
        </p>
        <div className="flex gap-2.5">
          <button className="btn-ghost flex-1" onClick={onCancel}>إلغاء</button>
          <button className="btn-sea flex-1" onClick={onConfirm}>فضّي وابدأ</button>
        </div>
      </div>
    </div>
  )
}
