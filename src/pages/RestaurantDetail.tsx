import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCart } from '../lib/cart'
import ProductCard from '../components/ProductCard'
import Icon from '../components/Icon'
import type { Compound, MenuItem, Restaurant } from '../lib/types'

export default function RestaurantDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const cart = useCart()
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [items, setItems] = useState<MenuItem[]>([])
  const [compounds, setCompounds] = useState<Compound[]>([])
  const [activeCat, setActiveCat] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('restaurants').select('*').eq('id', id).single().then(({ data }) => setRestaurant(data))
    supabase.from('menu_items').select('*').eq('restaurant_id', id).eq('available', true).then(({ data }) => setItems(data ?? []))
    supabase.from('compounds').select('*').eq('active', true).order('direction').order('distance_km')
      .then(({ data }) => setCompounds(data ?? []))
  }, [id])

  useEffect(() => {
    if (restaurant && restaurant.order_mode === 'catalog') cart.setForRestaurant(restaurant)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant?.id])

  const categories = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    for (const it of items) if (!seen.has(it.category)) { seen.add(it.category); list.push(it.category) }
    return list
  }, [items])

  useEffect(() => {
    if (!activeCat && categories.length) setActiveCat(categories[0])
  }, [categories, activeCat])

  const shown = items.filter(it => it.category === activeCat)
  const compoundId = sessionStorage.getItem('salka_compound_id')
  const selectedCompound = compounds.find(c => String(c.id) === compoundId)
  const totalEta = restaurant && selectedCompound ? restaurant.prep_minutes + selectedCompound.est_travel_minutes : null

  if (!restaurant) return <p className="text-mist">جاري التحميل…</p>

  if (restaurant.order_mode === 'custom_request') {
    // pharmacy/supermarket now go through the Custom Order flow instead
    nav('/custom-order', { replace: true })
    return null
  }

  return (
    <div>
      <Link to="/" className="text-sm text-mist hover:text-foam">← العودة للمطاعم</Link>

      <div className="mt-3 mb-4">
        <div className="flex items-center gap-3">
          {restaurant.logo_url
            ? <img src={restaurant.logo_url} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0 border border-line" />
            : <div className="w-12 h-12 rounded-xl bg-shellup grid place-items-center shrink-0 text-xl font-bold text-mist">{restaurant.name.charAt(0)}</div>}
          <h1 className="text-2xl font-bold">{restaurant.name}</h1>
          <span className={restaurant.is_open ? 'badge-open' : 'badge-closed'}>{restaurant.is_open ? 'مفتوح' : 'مغلق'}</span>
        </div>
        <p className="text-mist mt-1.5">{restaurant.description}</p>
        <div className="flex items-center gap-3 mt-2 text-sm text-mist">
          <span className="text-sand flex items-center gap-1"><Icon name="star" className="w-3.5 h-3.5" /> {restaurant.rating}</span>
          <span className="flex items-center gap-1"><Icon name="clock" className="w-3.5 h-3.5" /> {totalEta ? `يوصلك خلال ${totalEta} دقيقة تقريبًا` : `التحضير حوالي ${restaurant.prep_minutes} دقيقة`}</span>
        </div>
        {restaurant.order_mode === 'pickup_request' && (
          <p className="text-sm bg-shellup/60 rounded-xl p-3 mt-3">
            📋 القايمة دي للعرض بس — اطلب من {restaurant.name} على طول (تطبيقهم أو التليفون)، وهما هيتصرفوا في التوصيل
          </p>
        )}
      </div>

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
          {/* category pills */}
          <div className="flex gap-2 overflow-x-auto pb-1 mb-4 -mx-4 px-4 scrollbar-none">
            {categories.map(cat => (
              <button key={cat}
                className={`tab shrink-0 ${activeCat === cat ? 'tab-active' : 'bg-shellup/60'}`}
                onClick={() => setActiveCat(cat)}>{cat}</button>
            ))}
          </div>

          {activeCat && (
            <section>
              <h2 className="font-bold text-lg mb-3">{activeCat}</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {shown.map(it => (
                  <ProductCard
                    key={it.id}
                    item={it}
                    qty={cart.qty[it.id] ?? 0}
                    disabled={!restaurant.is_open}
                    onAdd={() => cart.add(it, 1)}
                    onRemove={() => cart.add(it, -1)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

    </div>
  )
}
