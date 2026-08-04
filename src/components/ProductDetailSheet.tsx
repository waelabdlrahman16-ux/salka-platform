import { useEffect, useState } from 'react'
import { artFor } from '../lib/categoryArt'
import { useDismissable } from '../lib/useDismissable'
import { isItemAvailableNow } from '../lib/itemAvailability'
import { applyDiscount, effectiveDiscount } from '../lib/discounts'
import Icon from './Icon'
import type { Discount, MenuItem, MenuItemAddon, MenuItemAddonGroup, MenuItemCombo, MenuItemSize } from '../lib/types'

export default function ProductDetailSheet({
  item, items, sizes, combos, addonGroups, addons, discounts, disabled, qtyFor, onAdd, onRemove, onCustomize, onClose
}: {
  item: MenuItem
  items: MenuItem[]
  sizes: MenuItemSize[]
  combos: MenuItemCombo[]
  addonGroups: MenuItemAddonGroup[]
  addons: MenuItemAddon[]
  discounts: Discount[]
  disabled?: boolean
  qtyFor: (id: number) => number
  onAdd: (item: MenuItem) => void
  onRemove: (item: MenuItem) => void
  onCustomize: (item: MenuItem) => void
  onClose: () => void
}) {
  const overlayRef = useDismissable(onClose)
  const [activeId, setActiveId] = useState(item.id)
  const active = items.find(i => i.id === activeId) ?? item

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const art = artFor(active.category)
  const itemSizes = sizes.filter(s => s.menu_item_id === active.id)
  const itemGroups = addonGroups.filter(g => g.menu_item_id === active.id)
  // Combos count as options. Without this an item whose ONLY option is the
  // combo upgrade would render a plain +/- stepper here and the customer would
  // never be shown the offer at all.
  const itemCombos = combos.filter(c => c.menu_item_id === active.id)
  const hasOptions = itemSizes.length > 0 || itemGroups.length > 0 || itemCombos.length > 0
  const qty = qtyFor(active.id)
  const baseActivePrice = itemSizes.length > 0 ? Math.min(...itemSizes.map(s => s.price)) : active.price
  const activeDiscount = effectiveDiscount(active.id, active.category, discounts)
  const activeDisplayPrice = applyDiscount(baseActivePrice, activeDiscount)

  const available = items.filter(i => i.id !== active.id && isItemAvailableNow(i.available_from, i.available_until))
  const sameCategory = available.filter(i => i.category === active.category)
  const related = (sameCategory.length >= 3 ? sameCategory : available).slice(0, 8)

  return (
    <div ref={overlayRef} role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/60 grid place-items-end sm:place-items-center p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto bg-shell rounded-t-2xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="relative aspect-square grid place-items-center text-6xl" style={{ background: art.tint }}>
          {active.image_url
            ? <img src={active.image_url} alt={active.name} className="w-full h-full object-cover" />
            : art.emoji}
          <button className="absolute top-3 left-3 bg-white/80 rounded-full w-7 h-7 grid place-items-center text-mist text-sm" onClick={onClose}>✗</button>
          {active.requires_prescription && (
            <span className="absolute top-3 right-3 bg-white/90 rounded-full px-2.5 py-1 text-xs font-bold text-seadeep">
              💊 يحتاج روشتة
            </span>
          )}
        </div>

        <div className="p-4">
          <h2 className="font-bold text-lg">{active.name}</h2>
          {active.description && <p className="text-sm text-mist mt-1 leading-relaxed">{active.description}</p>}
          <p className="text-lg mt-2">
            {activeDiscount && <span className="text-mist text-sm line-through ml-2">{baseActivePrice}</span>}
            <span className="text-sea font-bold">{itemSizes.length > 0 ? `من ${activeDisplayPrice}` : activeDisplayPrice} ج.م</span>
          </p>

          <div className="mt-4">
            {hasOptions ? (
              <button className="btn-sea w-full !py-3" disabled={disabled} onClick={() => onCustomize(active)}>
                اختيار
              </button>
            ) : qty === 0 ? (
              <button className="btn-sea w-full !py-3" disabled={disabled} onClick={() => onAdd(active)}>
                <span className="flex items-center justify-center gap-1.5"><Icon name="plus" className="w-3 h-3" /> إضافة للسلة</span>
              </button>
            ) : (
              <div className="w-full h-11 rounded-xl bg-shellup flex items-center justify-between px-1.5">
                <button className="w-9 h-9 rounded-lg grid place-items-center hover:bg-white" onClick={() => onRemove(active)}>
                  <Icon name="minus" className="w-3.5 h-3.5" />
                </button>
                <span className="font-bold">{qty}</span>
                <button className="w-9 h-9 rounded-lg grid place-items-center bg-sea text-white" onClick={() => onAdd(active)}>
                  <Icon name="plus" className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {related.length > 0 && (
            <div>
              <h3 className="font-semibold text-sm text-mist mb-3 pt-4 border-t border-line">منتجات تانية ممكن تعجبك</h3>
              <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-none">
                {related.map(r => {
                  const rArt = artFor(r.category)
                  const rSizes = sizes.filter(s => s.menu_item_id === r.id)
                  const rBasePrice = rSizes.length > 0 ? Math.min(...rSizes.map(s => s.price)) : r.price
                  const rDiscount = effectiveDiscount(r.id, r.category, discounts)
                  const rPrice = applyDiscount(rBasePrice, rDiscount)
                  return (
                    <button key={r.id} className="shrink-0 w-28 text-right" onClick={() => setActiveId(r.id)}>
                      <div className="rounded-xl aspect-square grid place-items-center text-2xl mb-1.5 overflow-hidden" style={{ background: rArt.tint }}>
                        {r.image_url ? <img src={r.image_url} alt={r.name} className="w-full h-full object-cover" /> : rArt.emoji}
                      </div>
                      <p className="text-xs font-semibold line-clamp-2 leading-snug">{r.name}</p>
                      <p className="text-xs mt-0.5">
                        {rDiscount && <span className="text-mist line-through ml-1">{rBasePrice}</span>}
                        <span className="text-sea font-bold">{rSizes.length > 0 ? `من ${rPrice}` : rPrice} ج.م</span>
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
