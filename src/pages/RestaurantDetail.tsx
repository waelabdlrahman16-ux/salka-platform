import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCart } from '../lib/cart'
import ProductCard from '../components/ProductCard'
import ProductDetailSheet from '../components/ProductDetailSheet'
import CustomizeSheet from '../components/CustomizeSheet'
import Icon from '../components/Icon'
import { isItemAvailableNow } from '../lib/itemAvailability'
import { useDeliveryQuote } from '../lib/deliveryQuote'
import { applyDiscount, effectiveDiscount } from '../lib/discounts'
import type { Compound, Discount, MenuItem, MenuItemAddon, MenuItemAddonGroup, MenuItemSize, Restaurant } from '../lib/types'

const ALL = '__all__'

export default function RestaurantDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const cart = useCart()
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [items, setItems] = useState<MenuItem[]>([])
  const [sizes, setSizes] = useState<MenuItemSize[]>([])
  const [addonGroups, setAddonGroups] = useState<MenuItemAddonGroup[]>([])
  const [addons, setAddons] = useState<MenuItemAddon[]>([])
  const [discounts, setDiscounts] = useState<Discount[]>([])
  const [customizing, setCustomizing] = useState<MenuItem | null>(null)
  const [detailItem, setDetailItem] = useState<MenuItem | null>(null)
  const [compounds, setCompounds] = useState<Compound[]>([])
  const [activeCat, setActiveCat] = useState<string>(ALL)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    // The error was discarded, so a bad id, an RLS denial or being offline all
    // produced restaurant === null and an eternal "جاري التحميل…" with no
    // message and no way back (the back link sits below the early return).
    setLoadFailed(false)
    supabase.from('restaurants').select('*').eq('id', id).single().then(({ data, error }) => {
      if (error || !data) { setLoadFailed(true); return }
      setRestaurant(data)
    })
    supabase.from('menu_items').select('*').eq('restaurant_id', id).eq('available', true).then(async ({ data }) => {
      const list = data ?? []
      setItems(list)
      if (list.length) {
        const ids = list.map(it => it.id)
        const [{ data: sz }, { data: gr }] = await Promise.all([
          supabase.from('menu_item_sizes').select('*').in('menu_item_id', ids).eq('available', true).order('display_order').order('id'),
          supabase.from('menu_item_addon_groups').select('*').in('menu_item_id', ids).order('display_order').order('id')
        ])
        setSizes(sz ?? [])
        setAddonGroups(gr ?? [])
        const groupIds = (gr ?? []).map(g => g.id)
        if (groupIds.length) {
          const { data: ad } = await supabase.from('menu_item_addons').select('*').in('group_id', groupIds).order('display_order').order('id')
          setAddons(ad ?? [])
        }
      }
    })
    supabase.from('compounds').select('*').eq('active', true).order('direction').order('distance_km')
      .then(({ data }) => setCompounds(data ?? []))
    supabase.from('discounts').select('*').eq('restaurant_id', id).eq('active', true)
      .then(({ data }) => setDiscounts(data ?? []))
  }, [id])

  useEffect(() => {
    if (restaurant && restaurant.order_mode === 'catalog') cart.setForRestaurant(restaurant)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant?.id])

  // Pharmacy/supermarket go through the Custom Order flow. This used to call
  // nav() directly in the render body, which is a router state update during
  // render -- React warns, and the redirect can double-fire under StrictMode.
  useEffect(() => {
    if (restaurant?.order_mode === 'custom_request') nav('/custom-order', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant?.order_mode])

  const categories = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    for (const it of items) if (!seen.has(it.category)) { seen.add(it.category); list.push(it.category) }
    return list
  }, [items])

  const shown = (cat: string) => items.filter(it => it.category === cat && isItemAvailableNow(it.available_from, it.available_until))
  const compoundId = sessionStorage.getItem('salka_compound_id')
  const selectedCompound = compounds.find(c => String(c.id) === compoundId)
  const totalEta = restaurant && selectedCompound ? restaurant.prep_minutes + selectedCompound.est_travel_minutes : null
  const { fee: deliveryFee } = useDeliveryQuote(compoundId ? Number(compoundId) : null)

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
        <div className="flex items-center gap-3 mt-2 text-sm text-mist flex-wrap">
          <span className="flex items-center gap-1"><Icon name="star" className="w-3.5 h-3.5 text-sand" /> {restaurant.rating}</span>
          <span className="flex items-center gap-1"><Icon name="clock" className="w-3.5 h-3.5" /> {totalEta ? `يوصلك خلال ${totalEta} دقيقة تقريبًا` : `التحضير حوالي ${restaurant.prep_minutes} دقيقة`}</span>
          {/* Stated here as well as on Home: this is the screen where a basket
              actually gets built, and the fee is the number most likely to
              change someone's mind. Server quote, never a local estimate. */}
          {deliveryFee !== null && (
            <span className="flex items-center gap-1">
              <Icon name="locationDot" className="w-3.5 h-3.5" /> التوصيل <span className="text-foam font-semibold">{deliveryFee} ج.م</span>
            </span>
          )}
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
            <button className={`tab shrink-0 ${activeCat === ALL ? 'tab-active' : 'bg-shellup/60'}`} onClick={() => setActiveCat(ALL)}>الكل</button>
            {categories.map(cat => (
              <button key={cat}
                className={`tab shrink-0 ${activeCat === cat ? 'tab-active' : 'bg-shellup/60'}`}
                onClick={() => setActiveCat(cat)}>{cat}</button>
            ))}
          </div>

          {(activeCat === ALL ? categories : [activeCat]).map(cat => shown(cat).length === 0 ? null : (
            <section key={cat} className="mb-6">
              <h2 className="font-bold text-lg mb-3">{cat}</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {shown(cat).map(it => {
                  const itemSizes = sizes.filter(s => s.menu_item_id === it.id)
                  const itemGroups = addonGroups.filter(g => g.menu_item_id === it.id)
                  const hasOptions = itemSizes.length > 0 || itemGroups.length > 0
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
                      isFromPrice={itemSizes.length > 0}
                      onAdd={() => cart.add(it, 1)}
                      onRemove={() => cart.add(it, -1)}
                      onCustomize={() => setCustomizing(it)}
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
          addonGroups={addonGroups}
          addons={addons}
          discounts={discounts}
          disabled={!restaurant.is_open}
          qtyFor={id => cart.qtyFor(id)}
          onAdd={it => cart.add(it, 1)}
          onRemove={it => cart.add(it, -1)}
          onCustomize={it => { setDetailItem(null); setCustomizing(it) }}
          onClose={() => setDetailItem(null)}
        />
      )}

      {customizing && (
        <CustomizeSheet
          item={customizing}
          sizes={sizes.filter(s => s.menu_item_id === customizing.id)}
          addonGroups={addonGroups.filter(g => g.menu_item_id === customizing.id)}
          addons={addons.filter(a => addonGroups.some(g => g.menu_item_id === customizing.id && g.id === a.group_id))}
          onClose={() => setCustomizing(null)}
          onConfirm={(sizeId, addonIds, qty) => {
            cart.addCustomLine(customizing.id, sizeId, addonIds, qty)
            setCustomizing(null)
          }}
        />
      )}

    </div>
  )
}
