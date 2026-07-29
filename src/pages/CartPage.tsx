import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCart } from '../lib/cart'
import { artFor } from '../lib/categoryArt'
import { estimateDeliveryFee } from '../lib/deliveryFee'
import { isItemAvailableNow } from '../lib/itemAvailability'
import Icon from '../components/Icon'
import type { Compound, MenuItem, MenuItemAddon, MenuItemSize, Restaurant } from '../lib/types'

export default function CartPage() {
  const nav = useNavigate()
  const cart = useCart()
  const [items, setItems] = useState<MenuItem[]>([])
  const [sizes, setSizes] = useState<MenuItemSize[]>([])
  const [addons, setAddons] = useState<MenuItemAddon[]>([])
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [compound, setCompound] = useState<Compound | null>(null)
  const [removedNotice, setRemovedNotice] = useState('')

  useEffect(() => {
    if (!cart.restaurantId) return
    supabase.from('menu_items').select('*').eq('restaurant_id', cart.restaurantId).then(({ data }) => setItems(data ?? []))
    supabase.from('restaurants').select('*').eq('id', cart.restaurantId).single().then(({ data }) => setRestaurant(data))
    ;(async () => {
      const ids = (await supabase.from('menu_items').select('id').eq('restaurant_id', cart.restaurantId)).data?.map(x => x.id) ?? []
      if (!ids.length) return
      const { data: sz } = await supabase.from('menu_item_sizes').select('*').in('menu_item_id', ids).eq('available', true)
      setSizes(sz ?? [])
      const { data: gr } = await supabase.from('menu_item_addon_groups').select('id').in('menu_item_id', ids)
      const groupIds = (gr ?? []).map(g => g.id)
      if (groupIds.length) {
        const { data: ad } = await supabase.from('menu_item_addons').select('*').in('group_id', groupIds).eq('available', true)
        setAddons(ad ?? [])
      }
    })()
  }, [cart.restaurantId])

  useEffect(() => {
    const compoundId = sessionStorage.getItem('salka_compound_id')
    if (!compoundId) return
    supabase.from('compounds').select('*').eq('id', Number(compoundId)).single().then(({ data }) => setCompound(data))
  }, [])

  function priceFor(menuItemId: number, sizeId: number | null, addonIds: number[]): { unit: number; name: string; sizeName: string | null; addonNames: string[] } {
    const item = items.find(i => i.id === menuItemId)
    const size = sizeId ? sizes.find(s => s.id === sizeId) : null
    const base = size ? size.price : (item?.price ?? 0)
    const selectedAddons = addonIds.map(id => addons.find(a => a.id === id)).filter((a): a is MenuItemAddon => !!a)
    const addonsTotal = selectedAddons.reduce((s, a) => s + a.price, 0)
    return { unit: base + addonsTotal, name: item?.name ?? '', sizeName: size?.name ?? null, addonNames: selectedAddons.map(a => a.name) }
  }

  // remove lines whose item no longer exists, went out of stock, or fell
  // outside its time window (e.g. a breakfast item after 11am) -- with a
  // visible notice instead of silently shrinking the total
  useEffect(() => {
    if (!items.length) return
    const stale = cart.lines.filter(l => {
      const item = items.find(i => i.id === l.menuItemId)
      return !item || !item.available || !isItemAvailableNow(item.available_from, item.available_until)
    })
    if (stale.length > 0) {
      setRemovedNotice(stale.length === 1 ? 'شلنا صنف من عربتك لأنه بقى مش متاح دلوقتي' : `شلنا ${stale.length} أصناف من عربتك لأنها بقت مش متاحة دلوقتي`)
      for (const l of stale) cart.removeLine(l.key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  const validLines = cart.lines.filter(l => items.some(i => i.id === l.menuItemId))
  const subtotal = validLines.reduce((s, l) => s + priceFor(l.menuItemId, l.sizeId, l.addonIds).unit * l.qty, 0)
  const deliveryFee = compound ? estimateDeliveryFee(compound.distance_km) : null
  const serviceFee = Math.round(subtotal * 0.02)
  const grandTotal = subtotal + (deliveryFee ?? 0) + serviceFee

  if (!cart.restaurantId || validLines.length === 0) {
    return (
      <div className="text-center py-16">
        {removedNotice && <p className="text-sand text-sm mb-4 bg-sand/10 rounded-xl p-3 mx-4">{removedNotice}</p>}
        <p className="text-4xl mb-3">🛒</p>
        <p className="font-bold text-lg mb-1">عربتك فاضية</p>
        <p className="text-mist text-sm mb-4">لسه ما ضفتش أي حاجة من المطاعم</p>
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
      {restaurant && <p className="text-mist text-sm mb-4">من {restaurant.name}</p>}
      {removedNotice && <p className="text-sand text-sm mb-4 bg-sand/10 rounded-xl p-3">{removedNotice}</p>}

      <div className="space-y-3 mb-5">
        {validLines.map(l => {
          const item = items.find(i => i.id === l.menuItemId)!
          const { unit, sizeName, addonNames } = priceFor(l.menuItemId, l.sizeId, l.addonIds)
          const art = artFor(item.category)
          return (
            <div key={l.key} className="card p-3.5 flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl grid place-items-center text-xl shrink-0" style={{ background: art.tint }}>
                {art.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm truncate">{item.name}</h3>
                {(sizeName || addonNames.length > 0) && (
                  <p className="text-xs text-mist mt-0.5 truncate">
                    {[sizeName, ...addonNames].filter(Boolean).join(' · ')}
                  </p>
                )}
                <p className="text-sea font-bold text-sm mt-0.5">{unit} ج.م</p>
              </div>
              <div className="flex items-center gap-2 bg-shellup rounded-lg px-1 py-1 shrink-0">
                <button className="w-7 h-7 rounded-md grid place-items-center hover:bg-white" onClick={() => cart.updateLineQty(l.key, -1)}><Icon name="minus" className="w-3 h-3" /></button>
                <span className="font-bold text-sm w-4 text-center">{l.qty}</span>
                <button className="w-7 h-7 rounded-md grid place-items-center bg-sea text-white" onClick={() => cart.updateLineQty(l.key, 1)}><Icon name="plus" className="w-3 h-3" /></button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="fixed bottom-[calc(4.5rem_+_env(safe-area-inset-bottom)_+_0.75rem)] inset-x-4 z-40 max-w-5xl mx-auto">
        <button className="btn-sea w-full !rounded-xl !py-4 shadow-lg shadow-sea/20 flex items-center justify-between px-4"
          onClick={() => nav('/checkout')}>
          <span>روح للدفع</span>
          <span className="font-bold">{grandTotal} ج.م</span>
        </button>
      </div>
    </div>
  )
}
