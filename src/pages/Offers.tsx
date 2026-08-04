import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { artFor } from '../lib/categoryArt'
import type { Discount, Restaurant } from '../lib/types'

interface RestaurantOffer {
  restaurant: Restaurant
  discounts: Discount[]
}

export default function Offers() {
  const [offers, setOffers] = useState<RestaurantOffer[] | null>(null)

  useEffect(() => {
    (async () => {
      const { data: discounts } = await supabase.from('discounts').select('*').eq('active', true)
      const now = new Date()
      const inEffect = (d: Discount) => (!d.starts_at || new Date(d.starts_at) <= now) && (!d.ends_at || new Date(d.ends_at) >= now)
      const live = (discounts ?? []).filter(inEffect)
      if (live.length === 0) { setOffers([]); return }

      const restaurantIds = [...new Set(live.map(d => d.restaurant_id))]
      const { data: restaurants } = await supabase.from('restaurants').select('*')
        .in('id', restaurantIds).eq('is_open', true).eq('archived', false)

      // Home filters vendors through restaurants_for_compound(); this page did
      // not, so a customer could browse an offer, fill a cart and enter their
      // address before being told at the final tap that the vendor does not
      // deliver to them. Apply the same coverage filter here.
      let visible = restaurants ?? []
      const savedCompound = sessionStorage.getItem('salka_compound_id')
      if (savedCompound) {
        const { data: covering, error: coverErr } = await supabase.rpc('restaurants_for_compound', {
          p_compound_id: Number(savedCompound)
        })
        // Branch on the error, not on an empty result. "Zero vendors cover this
        // compound" is a real and now-common answer (Home no longer hides far
        // compounds), and treating it as a failed lookup would show offers the
        // customer cannot order -- exactly the trap this filter exists to close.
        if (!coverErr) {
          const coveringIds = new Set(((covering as Restaurant[]) ?? []).map(r => r.id))
          visible = visible.filter(r => coveringIds.has(r.id))
        }
      }

      const grouped = visible.map(r => ({
        restaurant: r,
        discounts: live.filter(d => d.restaurant_id === r.id)
      })).filter(g => g.discounts.length > 0)

      setOffers(grouped)
    })()
  }, [])

  function describe(d: Discount): string {
    const amount = d.discount_type === 'percent' ? `${d.value}%` : `${d.value} ج.م`
    return d.scope === 'item' ? `خصم ${amount} على صنف معيّن` : `خصم ${amount} على قسم ${d.category}`
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">🏷️ العروض والخصومات</h1>

      {offers === null && <p className="text-mist">جاري التحميل…</p>}

      {offers?.length === 0 && (
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
                    <p key={d.id} className="text-xs text-sand font-semibold">{describe(d)}</p>
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
