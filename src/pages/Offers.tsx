import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { artFor } from '../lib/categoryArt'
import type { Discount, Restaurant } from '../lib/types'
import { getCompoundId } from '../lib/place'
import { publicCatalog } from '../lib/publicCatalog'

interface RestaurantOffer {
  restaurant: Restaurant
  discounts: Discount[]
}

export default function Offers() {
  const [offers, setOffers] = useState<RestaurantOffer[] | null>(null)
  // Distinguishes "no offers today" from "we could not read the offers".
  // Both used to render the same empty state, and the empty state says
  // «مفيش عروض دلوقتي» -- a confident factual claim made on a failed fetch.
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // scope: 'item' discounts only carry menu_item_id -- describe() had no name
  // to put next to it, so every one of these read "خصم 20% على صنف معيّن"
  // regardless of which item, and finding out which meant opening the
  // restaurant and reading every price on the menu.
  const [itemNames, setItemNames] = useState<Map<number, string>>(new Map())
  const [compoundId] = useState(() => getCompoundId())

  useEffect(() => {
    (async () => {
      setFailed(false)
      const { data: discounts, error: discErr } = await supabase.from('discounts').select('*').eq('active', true)
      if (discErr) { setFailed(true); setOffers([]); return }
      const now = new Date()
      const inEffect = (d: Discount) => (!d.starts_at || new Date(d.starts_at) <= now) && (!d.ends_at || new Date(d.ends_at) >= now)
      const live = (discounts ?? []).filter(inEffect)
      if (live.length === 0) { setOffers([]); return }

      const itemIds = [...new Set(live.filter(d => d.scope === 'item' && d.menu_item_id != null).map(d => d.menu_item_id!))]
      if (itemIds.length > 0) {
        const { data: items } = await supabase.from('menu_items').select('id, name').in('id', itemIds)
        setItemNames(new Map((items ?? []).map(i => [i.id, i.name])))
      }

      const restaurantIds = [...new Set(live.map(d => d.restaurant_id))]
      // NOT `.eq('is_open', true)`.
      //
      // `restaurants.is_open` stopped being the authority when opening hours
      // landed: vendor_is_open_now() reads closed_until and vendor_hours, and
      // never looks at this column. vendor_set_open(false) writes it, the
      // self-expiry only clears closed_until, and nothing ever sets it back to
      // true -- so every live vendor sits at false permanently. Measured on
      // 2026-08-07: this filter returned 0 rows while 4 vendors were open.
      // vendor_open_states() is the same computed value the home screen uses.
      const { data: restaurants, error: restErr } = await supabase.from('restaurants').select('*')
        .in('id', restaurantIds).eq('archived', false)
      if (restErr) { setFailed(true); setOffers([]); return }
      const { data: openStates, error: openErr } = await supabase.rpc('vendor_open_states')
      if (openErr) { setFailed(true); setOffers([]); return }
      const openNow = new Set(
        ((openStates ?? []) as { id: number; is_open: boolean }[]).filter(v => v.is_open).map(v => v.id))

      // Home filters vendors through restaurants_for_compound(); this page did
      // not, so a customer could browse an offer, fill a cart and enter their
      // address before being told at the final tap that the vendor does not
      // deliver to them. Apply the same coverage filter here.
      let visible = (restaurants ?? []).filter(r => openNow.has(r.id))
      const savedCompound = getCompoundId()
      if (savedCompound) {
        const coveringResult = await publicCatalog<Restaurant[]>('restaurants', {
          compoundId: Number(savedCompound)
        })
        // A dropped request here used to fall through silently and show every
        // open vendor with a live discount, coverage unchecked -- the exact
        // trap this filter exists to close, just conditioned on a network
        // hiccup instead of always. "Zero vendors cover this compound" is
        // still a real, distinct answer (coveringResult.ok with an empty
        // list), so only an actual failed lookup is treated as a load error.
        if (!coveringResult.ok) { setFailed(true); setOffers([]); return }
        const coveringIds = new Set((coveringResult.data ?? []).map(r => r.id))
        visible = visible.filter(r => coveringIds.has(r.id))
      }

      const grouped = visible.map(r => ({
        restaurant: r,
        discounts: live.filter(d => d.restaurant_id === r.id)
      })).filter(g => g.discounts.length > 0)

      setOffers(grouped)
    })()
  }, [attempt])

  function describe(d: Discount): string {
    const amount = d.discount_type === 'percent' ? `${d.value}%` : `${d.value} ج.م`
    if (d.scope === 'item') {
      const name = d.menu_item_id != null ? itemNames.get(d.menu_item_id) : null
      return name ? `خصم ${amount} على ${name}` : `خصم ${amount} على صنف معيّن`
    }
    return `خصم ${amount} على قسم ${d.category}`
  }

  // Home requires a compound before it will show a single restaurant; this
  // page had no such gate, so a customer who opened Offers before ever
  // picking a location (first visit, bottom-nav straight in) saw every
  // active discount platform-wide with nothing filtering it by distance,
  // and could tap straight into a restaurant nowhere near them.
  if (!compoundId) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-1">العروض والخصومات</h1>
        <div className="card p-6 text-center mt-4">
          <p className="font-semibold">اختار مكانك الأول</p>
          <p className="text-sm text-mist mt-1.5 mb-4">
            عشان نوريك العروض اللي بتوصل لمكانك بس
          </p>
          <Link to="/" className="btn-sea !py-2 !px-5 text-sm inline-block">اختار مكانك</Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">العروض والخصومات</h1>
      {/* Each card already states its scope via describe() ("على قسم X" /
          "على صنف معيّن"), but a customer skimming a list of restaurant cards
          with a bold "خصم 20%" headline could still read that as storewide --
          it's a discount scoped to one item or category, applied
          automatically, not a coupon. This line sets that expectation once,
          up front, rather than relying on each card's fine print alone. */}
      {offers && offers.length > 0 && !failed && (
        <p className="text-xs text-mist mb-4">الخصم بيتطبق تلقائي على الصنف أو القسم المحدد بس، مش على الطلب كله</p>
      )}

      {offers === null && <p className="text-mist mt-3">جاري التحميل…</p>}

      {/* Order matters: the failure state has to win. Both branches are reached
          with offers === [], and telling someone there are no offers when we
          merely could not read them is a false statement, not an empty state. */}
      {failed && (
        <div className="card p-4 text-center">
          <p className="font-semibold">مفيش عروض دلوقتي</p>
          <p className="text-sm text-mist mt-1 mb-3">اتأكد من الاتصال بالنت</p>
          <button className="btn-sea !py-2 !px-6 text-sm"
            onClick={() => { setOffers(null); setAttempt(a => a + 1) }}>جرب تاني</button>
        </div>
      )}

      {!failed && offers?.length === 0 && (
        <p className="text-mist text-center py-10">مفيش عروض شغالة دلوقتي — تابعنا هيكون في عروض قريب</p>
      )}

      <div className="space-y-3">
        {offers?.map(({ restaurant, discounts }) => {
          const art = artFor(restaurant.category)
          // A single item-scoped discount has one obvious destination: the
          // dish itself. Landing on the restaurant page and making the
          // customer go find it was the same dead-end the featured-products
          // shelf had. Anything else (multiple discounts, or category-scoped
          // with no one item) still goes to the restaurant page -- there is
          // no single dish to land on.
          const only = discounts.length === 1 ? discounts[0] : null
          const href = only?.scope === 'item' && only.menu_item_id != null
            ? `/restaurant/${restaurant.id}?item=${only.menu_item_id}`
            : `/restaurant/${restaurant.id}`
          return (
            <Link key={restaurant.id} to={href} className="card p-4 flex items-center gap-3 hover:border-sea/50 transition-colors">
              {restaurant.logo_url
                ? <img src={restaurant.logo_url} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0 border border-line" />
                : <div className="w-14 h-14 rounded-xl grid place-items-center text-2xl shrink-0" style={{ background: art.tint }}>{art.emoji}</div>}
              <div className="min-w-0 flex-1">
                <h2 className="font-bold truncate">{restaurant.name}</h2>
                <div className="space-y-0.5 mt-1">
                  {discounts.slice(0, 2).map(d => (
                    <p key={d.id} className="text-xs text-sandink font-semibold">{describe(d)}</p>
                  ))}
                  {discounts.length > 2 && <p className="text-xs text-mist">+{discounts.length - 2} عروض تانية</p>}
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
