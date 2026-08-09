import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { artFor } from '../lib/categoryArt'
import type { Discount, Restaurant } from '../lib/types'
import { getCompoundId, setCompoundId as setStoredCompoundId } from '../lib/place'
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

  useEffect(() => {
    (async () => {
      setFailed(false)
      const { data: discounts, error: discErr } = await supabase.from('discounts').select('*').eq('active', true)
      if (discErr) { setFailed(true); setOffers([]); return }
      const now = new Date()
      const inEffect = (d: Discount) => (!d.starts_at || new Date(d.starts_at) <= now) && (!d.ends_at || new Date(d.ends_at) >= now)
      const live = (discounts ?? []).filter(inEffect)
      if (live.length === 0) { setOffers([]); return }

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
        // Branch on the error, not on an empty result. "Zero vendors cover this
        // compound" is a real and now-common answer (Home no longer hides far
        // compounds), and treating it as a failed lookup would show offers the
        // customer cannot order -- exactly the trap this filter exists to close.
        if (coveringResult.ok) {
          const coveringIds = new Set((coveringResult.data ?? []).map(r => r.id))
          visible = visible.filter(r => coveringIds.has(r.id))
        }
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
    return d.scope === 'item' ? `خصم ${amount} على صنف معيّن` : `خصم ${amount} على قسم ${d.category}`
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">🏷️ العروض والخصومات</h1>

      {offers === null && <p className="text-mist">جاري التحميل…</p>}

      {/* Order matters: the failure state has to win. Both branches are reached
          with offers === [], and telling someone there are no offers when we
          merely could not read them is a false statement, not an empty state. */}
      {failed && (
        <div className="card p-4 text-center">
          <p className="font-semibold">مش قادرين نجيب العروض دلوقتي</p>
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
          return (
            <Link key={restaurant.id} to={`/restaurant/${restaurant.id}`} className="card p-4 flex items-center gap-3 hover:border-sea/50 transition-colors">
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
