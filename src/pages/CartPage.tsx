import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCart } from '../lib/cart'
import { lineIsStale, priceLine } from '../lib/linePricing'
import { artFor } from '../lib/categoryArt'
import { useDeliveryQuote } from '../lib/deliveryQuote'
import { serviceFeeFor, useServiceFeePct } from '../lib/serviceFee'
import { isItemAvailableNow } from '../lib/itemAvailability'
import { applyDiscount, effectiveDiscount } from '../lib/discounts'
import Icon from '../components/Icon'
import type { Discount, MenuItem, MenuItemAddon, MenuItemCombo, MenuItemSize, Restaurant } from '../lib/types'
import { getCompoundId, setCompoundId as setStoredCompoundId } from '../lib/place'

export default function CartPage() {
  const nav = useNavigate()
  const cart = useCart()
  const [items, setItems] = useState<MenuItem[]>([])
  const [sizes, setSizes] = useState<MenuItemSize[]>([])
  const [combos, setCombos] = useState<MenuItemCombo[]>([])
  // Sizes, combos and add-ons arrive several round trips after the items do.
  // Until they land, every combo line prices at the item's base price -- which
  // is the number on the checkout button. Nothing that depends on a total is
  // trusted before this flips.
  const [optionsLoaded, setOptionsLoaded] = useState(false)
  const [addons, setAddons] = useState<MenuItemAddon[]>([])
  const [discounts, setDiscounts] = useState<Discount[]>([])
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [compoundId, setCompoundId] = useState<number | null>(null)
  const [removedNotice, setRemovedNotice] = useState('')

  useEffect(() => {
    if (!cart.restaurantId) return
    supabase.from('menu_items').select('*').eq('restaurant_id', cart.restaurantId).then(({ data }) => setItems(data ?? []))
    supabase.from('restaurants').select('*').eq('id', cart.restaurantId).single().then(({ data }) => setRestaurant(data))
    supabase.from('discounts').select('*').eq('restaurant_id', cart.restaurantId).eq('active', true)
      .then(({ data }) => setDiscounts(data ?? []))
    ;(async () => {
      const ids = (await supabase.from('menu_items').select('id').eq('restaurant_id', cart.restaurantId)).data?.map(x => x.id) ?? []
      if (!ids.length) { setOptionsLoaded(true); return }
      const { data: sz } = await supabase.from('menu_item_sizes').select('*').in('menu_item_id', ids).eq('available', true)
      setSizes(sz ?? [])
      const { data: cb } = await supabase.from('menu_item_combos').select('*').in('menu_item_id', ids).eq('available', true)
      setCombos((cb as MenuItemCombo[]) ?? [])
      const { data: gr } = await supabase.from('menu_item_addon_groups').select('id').in('menu_item_id', ids)
      const groupIds = (gr ?? []).map(g => g.id)
      if (groupIds.length) {
        const { data: ad } = await supabase.from('menu_item_addons').select('*').in('group_id', groupIds).eq('available', true)
        setAddons(ad ?? [])
      }
      setOptionsLoaded(true)
    })()
  }, [cart.restaurantId])

  useEffect(() => {
    const saved = getCompoundId()
    setCompoundId(saved ? Number(saved) : null)
  }, [])

  // One implementation, shared with the checkout. See lib/linePricing.
  const priceFor = (l: { menuItemId: number; sizeId: number | null; comboId: number | null; addonIds: number[] }) =>
    priceLine(l, { items, sizes, combos, addons, discounts })

  // remove lines whose item no longer exists, went out of stock, or fell
  // outside its time window (e.g. a breakfast item after 11am) -- with a
  // visible notice instead of silently shrinking the total
  useEffect(() => {
    if (!items.length || !optionsLoaded) return
    // Also catches a line whose size or combo has since been deleted -- those
    // used to survive the sweep and silently reprice to the item's base price.
    const stale = cart.lines.filter(l => lineIsStale(l, { items, sizes, combos }))
    if (stale.length > 0) {
      setRemovedNotice(stale.length === 1 ? 'شلنا صنف من عربتك لأنه بقى مش متاح دلوقتي' : `شلنا ${stale.length} أصناف من عربتك لأنها بقت مش متاحة دلوقتي`)
      for (const l of stale) cart.removeLine(l.key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, optionsLoaded])

  const validLines = cart.lines.filter(l => items.some(i => i.id === l.menuItemId))
  const subtotal = validLines.reduce((s, l) => s + priceFor(l).unit * l.qty, 0)
  const { fee: deliveryFee, quote, loading: feeLoading } = useDeliveryQuote(compoundId)
  // The rate lives in settings.service_fee_percent and place_order applies it.
  // This used to be a hardcoded 0.02 that silently understated the total by
  // whatever the admin had since changed the setting to.
  const { pct: serviceFeePct, loading: serviceFeeLoading } = useServiceFeePct()
  const serviceFee = serviceFeeFor(subtotal, serviceFeePct)
  // Only a complete total when delivery AND the service fee are actually known.
  // Previously the delivery fee was silently omitted from grandTotal whenever no
  // compound was stored, so the sticky CTA understated the price by the entire
  // delivery charge; substituting 0 for an unknown service fee would repeat it.
  const grandTotal = deliveryFee !== null && serviceFee !== null
    ? subtotal + deliveryFee + serviceFee : null
  const partialTotal = serviceFee !== null ? subtotal + serviceFee : null

  if (!cart.restaurantId || validLines.length === 0) {
    return (
      <div className="text-center py-16">
        {removedNotice && <p className="text-sandink text-sm mb-4 bg-sand/10 rounded-xl p-3 mx-4">{removedNotice}</p>}
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
      {removedNotice && <p className="text-sandink text-sm mb-4 bg-sand/10 rounded-xl p-3">{removedNotice}</p>}

      <div className="space-y-3 mb-5">
        {validLines.map(l => {
          const item = items.find(i => i.id === l.menuItemId)!
          const { unit, original, sizeName, comboName, addonNames } = priceFor(l)
          const art = artFor(item.category)
          return (
            <div key={l.key} className="card p-3.5 flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl grid place-items-center text-xl shrink-0" style={{ background: art.tint }}>
                {art.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm truncate">{item.name}</h3>
                {(sizeName || comboName || addonNames.length > 0) && (
                  <p className="text-xs text-mist mt-0.5 truncate">
                    {[comboName && `🍟 ${comboName}`, sizeName, ...addonNames].filter(Boolean).join(' · ')}
                  </p>
                )}
                <p className="text-sm mt-0.5">
                  {original != null && <span className="text-mist text-xs line-through ml-1.5">{original}</span>}
                  <span className="text-sea font-bold">{unit} ج.م</span>
                </p>
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

      <div className="card p-3.5 mb-24 space-y-1.5">
        <div className="flex justify-between text-sm text-mist"><span>المنتجات</span><span>{subtotal} ج.م</span></div>
        <div className="flex justify-between text-sm text-mist">
          <span>التوصيل{quote ? ` لـ ${quote.compound_name}` : ''}</span>
          <span>
            {deliveryFee !== null ? `${deliveryFee} ج.م`
              : feeLoading ? '…'
              : 'يتحدد بعد اختيار مكانك'}
          </span>
        </div>
        <div className="flex justify-between text-sm text-mist">
          <span>رسوم الخدمة</span>
          <span>{serviceFee !== null ? `${serviceFee} ج.م` : serviceFeeLoading ? '…' : '—'}</span>
        </div>
        <div className="flex justify-between font-bold border-t border-line pt-2">
          <span>{grandTotal !== null ? 'الإجمالي' : 'الإجمالي قبل التوصيل'}</span>
          <span className="text-sea">
            {!optionsLoaded ? '…'
              : grandTotal !== null ? `${grandTotal} ج.م`
              : partialTotal !== null ? `${partialTotal} ج.م`
              : '…'}
          </span>
        </div>
      </div>

      <div className="fixed bottom-[calc(4.5rem_+_env(safe-area-inset-bottom)_+_0.75rem)] inset-x-4 z-40 max-w-5xl mx-auto">
        {/* Held until sizes/combos/add-ons land. Before that the total on this
            button is understated for any combo line, and it is the number the
            customer taps. */}
        <button className="btn-sea w-full !rounded-xl !py-4 shadow-lg shadow-sea/20 flex items-center justify-between px-4"
          disabled={!optionsLoaded} onClick={() => nav('/checkout')}>
          <span>{optionsLoaded ? 'روح للدفع' : 'لحظة…'}</span>
          {/* The number was still printed next to 'لحظة…', which is the number
              being waited for. */}
          {optionsLoaded && grandTotal !== null && <span className="font-bold">{grandTotal} ج.م</span>}
        </button>
      </div>
    </div>
  )
}
