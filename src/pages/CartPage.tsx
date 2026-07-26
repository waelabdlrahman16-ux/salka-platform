import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCart } from '../lib/cart'
import { artFor } from '../lib/categoryArt'
import { estimateDeliveryFee } from '../lib/deliveryFee'
import type { Compound, MenuItem, Restaurant } from '../lib/types'

export default function CartPage() {
  const nav = useNavigate()
  const cart = useCart()
  const [items, setItems] = useState<MenuItem[]>([])
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [compound, setCompound] = useState<Compound | null>(null)

  useEffect(() => {
    if (!cart.restaurantId) return
    supabase.from('menu_items').select('*').eq('restaurant_id', cart.restaurantId).then(({ data }) => setItems(data ?? []))
    supabase.from('restaurants').select('*').eq('id', cart.restaurantId).single().then(({ data }) => setRestaurant(data))
  }, [cart.restaurantId])

  useEffect(() => {
    const compoundId = sessionStorage.getItem('talah_compound_id')
    if (!compoundId) return
    supabase.from('compounds').select('*').eq('id', Number(compoundId)).single().then(({ data }) => setCompound(data))
  }, [])

  const lines = items.filter(it => cart.qty[it.id])
  const subtotal = lines.reduce((s, it) => s + it.price * cart.qty[it.id], 0)
  const deliveryFee = compound ? estimateDeliveryFee(compound.distance_km) : null

  if (!cart.restaurantId || lines.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-4xl mb-3">🛒</p>
        <p className="font-bold text-lg mb-1">عربتك فاضية</p>
        <p className="text-mist text-sm mb-5">لسه ما ضفتش أي حاجة من المطاعم</p>
        <button className="btn-sea" onClick={() => nav('/')}>تصفح المطاعم</button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">عربتك</h1>
        <button className="text-sm text-seadeep font-semibold" onClick={() => cart.clear()}>مسح الكل</button>
      </div>
      {restaurant && <p className="text-mist text-sm mb-5">من {restaurant.name}</p>}

      <div className="space-y-3 mb-6">
        {lines.map(it => {
          const art = artFor(it.category)
          return (
            <div key={it.id} className="card p-3 flex items-center gap-3">
              <div className="w-16 h-16 rounded-xl grid place-items-center text-2xl shrink-0" style={{ background: art.tint }}>
                {art.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm truncate">{it.name}</h3>
                <p className="text-sea font-bold text-sm mt-0.5">{it.price} ج.م</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button className="btn-ghost !px-3 !py-1.5 text-red-600" onClick={() => cart.remove(it.id)} aria-label="حذف">🗑</button>
                <div className="flex items-center gap-2 bg-shellup rounded-full px-1 py-1">
                  <button className="w-7 h-7 rounded-full grid place-items-center font-bold hover:bg-white" onClick={() => cart.add(it, -1)}>−</button>
                  <span className="font-bold text-sm w-4 text-center">{cart.qty[it.id]}</span>
                  <button className="w-7 h-7 rounded-full grid place-items-center font-bold bg-sea text-white" onClick={() => cart.add(it, 1)}>+</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="fixed bottom-20 inset-x-4 z-40 max-w-5xl mx-auto">
        <button className="btn-sea w-full !py-3.5 shadow-lg shadow-sea/20 flex items-center justify-between px-5"
          onClick={() => nav('/checkout')}>
          <span>روح للدفع</span>
          <span className="text-left">
            {deliveryFee !== null ? subtotal + deliveryFee : subtotal} ج.م
            <span className="block text-[11px] opacity-80 font-normal">
              {deliveryFee !== null ? `شامل ${deliveryFee} ج.م توصيل (حسب المسافة)` : 'التوصيل بيتحسب حسب مكانك'}
            </span>
          </span>
        </button>
      </div>
    </div>
  )
}
