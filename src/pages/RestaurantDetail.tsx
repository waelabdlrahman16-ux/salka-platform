import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, DELIVERY_FEE } from '../lib/supabase'
import { useCart } from '../lib/cart'
import ProductCard from '../components/ProductCard'
import { artFor } from '../lib/categoryArt'
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
  const compoundId = sessionStorage.getItem('talah_compound_id')
  const selectedCompound = compounds.find(c => String(c.id) === compoundId)
  const totalEta = restaurant && selectedCompound ? restaurant.prep_minutes + selectedCompound.est_travel_minutes : null

  const count = cart.count
  const subtotal = items.reduce((s, it) => s + (cart.qty[it.id] ?? 0) * it.price, 0)

  if (!restaurant) return <p className="text-mist">جاري التحميل…</p>

  if (restaurant.order_mode === 'custom_request') {
    // pharmacy/supermarket now go through the Custom Order flow instead
    nav('/custom-order', { replace: true })
    return null
  }

  return (
    <div>
      <Link to="/" className="text-sm text-mist hover:text-foam">← العودة للمطاعم</Link>

      <div className="mt-3 mb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{restaurant.name}</h1>
          <span className={restaurant.is_open ? 'badge-open' : 'badge-closed'}>{restaurant.is_open ? 'مفتوح' : 'مغلق'}</span>
        </div>
        <p className="text-mist mt-1.5">{restaurant.description}</p>
        <div className="flex items-center gap-3 mt-2 text-sm text-mist">
          <span className="text-sand">★ {restaurant.rating}</span>
          <span>⏱ {totalEta ? `يوصلك خلال ${totalEta} دقيقة تقريبًا` : `التحضير حوالي ${restaurant.prep_minutes} دقيقة`}</span>
        </div>
        {restaurant.order_mode === 'pickup_request' && (
          <p className="text-sm bg-shellup/60 rounded-xl p-3 mt-3">
            📋 القايمة دي للعرض بس — اطلب من {restaurant.name} على طول (تطبيقهم أو التليفون)، وبعدين اطلب مندوب توصيل من هنا
          </p>
        )}
      </div>

      {/* category pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-5 -mx-4 px-4 scrollbar-none">
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
              restaurant.order_mode === 'pickup_request' ? (
                <BrowseOnlyCard key={it.id} item={it} />
              ) : (
                <ProductCard
                  key={it.id}
                  item={it}
                  qty={cart.qty[it.id] ?? 0}
                  disabled={!restaurant.is_open}
                  onAdd={() => cart.add(it, 1)}
                  onRemove={() => cart.add(it, -1)}
                />
              )
            ))}
          </div>
        </section>
      )}

      {restaurant.order_mode === 'catalog' && count > 0 && (
        <div className="fixed bottom-20 inset-x-4 z-40 max-w-5xl mx-auto">
          <button className="btn-sea w-full !py-3.5 shadow-lg shadow-sea/20 flex items-center justify-between px-5"
            onClick={() => nav('/cart')}>
            <span>عربتك ({count})</span>
            <span>{subtotal} ج.م</span>
          </button>
        </div>
      )}

      {restaurant.order_mode === 'pickup_request' && (
        <div className="fixed bottom-20 inset-x-4 z-40 max-w-5xl mx-auto">
          <button className="btn-sea w-full !py-3.5 shadow-lg shadow-sea/20"
            onClick={() => nav(`/request-driver/${restaurant.id}`)}>
            🛵 اطلب مندوب توصيل
          </button>
        </div>
      )}
    </div>
  )
}

function BrowseOnlyCard({ item }: { item: MenuItem }) {
  const art = artFor(item.category)
  return (
    <div className="card p-3 flex flex-col">
      <div className="rounded-xl aspect-square grid place-items-center text-4xl mb-3" style={{ background: art.tint }}>
        {art.emoji}
      </div>
      <h3 className="font-semibold text-sm leading-snug line-clamp-2 min-h-[2.5em]">{item.name}</h3>
      <p className="text-sea font-bold mt-1.5">{item.price} ج.م</p>
    </div>
  )
}
