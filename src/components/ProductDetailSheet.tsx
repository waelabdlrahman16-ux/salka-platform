import { useEffect, useState } from 'react'
import { artFor } from '../lib/categoryArt'
import { useDismissable } from '../lib/useDismissable'
import { isItemAvailableNow } from '../lib/itemAvailability'
import { applyDiscount, effectiveDiscount } from '../lib/discounts'
import Icon from './Icon'
import type { Discount, MenuItem, MenuItemAddon, MenuItemAddonGroup, MenuItemCombo, MenuItemSize } from '../lib/types'

export default function ProductDetailSheet({
  item, items, sizes, combos, addonGroups, addons, discounts, disabled, optionsLoaded, qtyFor, onAdd, onRemove, onCustomize, onClose
}: {
  item: MenuItem
  items: MenuItem[]
  sizes: MenuItemSize[]
  combos: MenuItemCombo[]
  addonGroups: MenuItemAddonGroup[]
  addons: MenuItemAddon[]
  discounts: Discount[]
  disabled?: boolean
  /** False while sizes/combos/add-ons are still in flight. */
  optionsLoaded?: boolean
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
  // Same rule as the menu card: unknown options are treated as options.
  const hasOptions = optionsLoaded === false || itemSizes.length > 0 || itemGroups.length > 0 || itemCombos.length > 0
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
        {/* aspect-square on a phone is a full-width square, so the name, the
            price and the add button all started below the fold -- the customer
            had to scroll past a picture of a can to find out what it costs.
            Capped against the viewport instead.

            AND, from a screenshot Wael sent on 2026-08-07: with NO photo this
            was still rendering the full 38vh -- about 280px of flat beige with
            a 60px emoji floating in the middle of it, above the name of a
            250 ج.م item. An empty box does not become more informative by
            being bigger. A vendor with no picture gets a short band instead,
            which reads as "no photo" rather than as a broken image. */}
        <div className={`relative grid place-items-center text-5xl ${
            active.image_url ? 'aspect-[4/3] max-h-[30vh]' : 'h-28'}`}
          style={{ background: active.image_url ? '#F4EEE3' : art.tint }}>
          {active.image_url
            // Fills the frame, always. Same reasoning as the grid card: with
            // `contain`, every photo was a different shape inside the same box
            // and the sheet opened on a picture floating in beige.
            ? <img src={active.image_url} alt={active.name} className="w-full h-full object-cover" />
            : art.emoji}
          <button className="absolute top-3 left-3 bg-white/80 rounded-full w-7 h-7 grid place-items-center text-mist text-sm" onClick={onClose}>✗</button>
          {active.requires_prescription && (
            <span className="absolute top-3 right-3 bg-white/90 rounded-full px-2.5 py-1 text-xs font-bold text-seadeep">
              💊 يحتاج روشتة
            </span>
          )}
        </div>

        {/* The image was taking 38vh and the item itself got whatever was left.
            Reversed: the picture is capped at 30vh and 4:3 rather than square,
            which hands roughly a fifth of the sheet back to the name, the price
            and the button — the three things the customer opened it for. */}
        <div className="p-5">
          <h2 className="font-bold text-xl leading-snug">{active.name}</h2>
          {active.description && <p className="text-sm text-mist mt-2 leading-relaxed">{active.description}</p>}
          <p className="text-xl mt-3">
            {activeDiscount && <span className="text-mist text-sm line-through ml-2">{baseActivePrice}</span>}
            <span className="text-sea font-bold">{itemSizes.length > 0 ? `من ${activeDisplayPrice}` : activeDisplayPrice} ج.م</span>
          </p>

          <div className="mt-5">
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
                      <div className="rounded-xl aspect-square grid place-items-center text-2xl mb-1.5 overflow-hidden"
                        style={{ background: r.image_url ? '#fff' : rArt.tint }}>
                        {r.image_url ? <img src={r.image_url} alt={r.name} className="w-full h-full object-contain" /> : rArt.emoji}
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
