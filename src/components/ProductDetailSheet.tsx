import { useEffect, useState } from 'react'
import IconButton from './IconButton'
import CategoryArt from './CategoryArt'
import { artFor } from '../lib/categoryArt'
import { useDismissable } from '../lib/useDismissable'
import { isItemAvailableNow } from '../lib/itemAvailability'
import { applyDiscount, effectiveDiscount } from '../lib/discounts'
import Icon from './Icon'
import type { Discount, MenuItem, MenuItemAddon, MenuItemAddonGroup, MenuItemCombo, MenuItemSize } from '../lib/types'
import { sized, IMG } from '../lib/imageUrl'

export default function ProductDetailSheet({
  item, items, sizes, combos, addonGroups, discounts, disabled, optionsLoaded, qtyFor, onAdd, onRemove, onCustomize, onClose
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
  const [imgFailed, setImgFailed] = useState(false)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Reset per item -- otherwise a broken photo on one dish would keep the
  // fallback emoji showing after switching to a related item (setActiveId)
  // whose own photo is fine.
  useEffect(() => { setImgFailed(false) }, [activeId])

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

  // ALWAYS a full-bleed bottom sheet, no sm: desktop-centered variant. The
  // grid/flex fixes still weren't enough -- confirmed by screenshot that
  // Wael's installed app renders the sm:640px "centered dialog" branch on an
  // actual phone screen, meaning the WebView is reporting (or Tailwind's
  // media query is matching against) a viewport wider than the real device.
  // Customers only ever see this on that same installed app, so there is no
  // real desktop case to preserve here -- dropping the breakpoint entirely
  // removes the whole failure mode instead of chasing why it misfires.
  return (
    <div ref={overlayRef} role="dialog" aria-labelledby="product-detail-title" aria-modal="true" className="fixed inset-0 z-50 bg-black/60" onClick={onClose}>
      <div className="fixed inset-x-0 bottom-0 w-full max-h-[90vh] overflow-y-auto bg-shell rounded-t-[28px]" onClick={e => e.stopPropagation()}>
        {/* Drag handle: a purely visual affordance signalling "this sheet
            swipes down to close" -- it does not itself carry a gesture,
            useDismissable's backdrop tap/Back-button handling already does
            that job. */}
        <div className="flex justify-center pt-2.5 pb-1.5">
          <div className="w-9 h-1 rounded-full bg-line" />
        </div>

        {/* aspect-square on a phone is a full-width square, so the name, the
            price and the add button all started below the fold -- the customer
            had to scroll past a picture of a can to find out what it costs.
            Capped against the viewport instead.

            AND, from a screenshot Wael sent on 2026-08-07: with NO photo this
            was still rendering the full 38vh -- about 280px of flat beige with
            a 60px emoji floating in the middle of it, above the name of a
            250 ج.م item. An empty box does not become more informative by
            being bigger. A vendor with no picture gets a short band instead,
            which reads as "no photo" rather than as a broken image.

            Inset with side/top padding and rounded corners, not full-bleed
            against the sheet edges -- matches the redesign Wael supplied. */}
        <div className="px-4">
        <div className={`relative grid place-items-center text-5xl overflow-hidden rounded-xl bg-shellup ${
            active.image_url && !imgFailed ? 'aspect-[4/3] max-h-[22vh]' : 'h-28'}`}
          // Same fix as ProductCard: the photo's frame is an image container,
          // so it takes the token rather than a literal that the palette change
          // could not reach.
          style={active.image_url && !imgFailed ? undefined : { background: art.tint }}>
          {active.image_url && !imgFailed
            // Fills the frame, always. Same reasoning as the grid card: with
            // `contain`, every photo was a different shape inside the same box
            // and the sheet opened on a picture floating in beige.
            //
            // onError: a broken URL (404, dropped CDN request) used to leave
            // this exact box empty -- image_url was truthy so the emoji
            // branch never ran, and nothing else filled the frame. "Sometimes
            // the sheet opens with no image at all" was this, not a random
            // glitch: the fallback only ever triggered on a MISSING url, never
            // a FAILED one.
            ? <img src={sized(active.image_url, IMG.photo)} alt={active.name} className="w-full h-full object-cover"
                onError={() => setImgFailed(true)} />
            : <CategoryArt art={art} size="xl" className="text-mist" />}
          <span className="absolute top-2 left-2">
            <IconButton icon="x" label="إغلاق" onClick={onClose} />
          </span>
          {active.requires_prescription && (
            <span className="absolute top-3 right-3 bg-white/90 rounded-full px-2.5 py-1 text-xs font-bold text-seadeep">
              <Icon name="pill" size="xs" className="inline-block align-[-0.15em] me-1" />يحتاج روشتة
            </span>
          )}
        </div>
        </div>

        {/* The image was taking 38vh and the item itself got whatever was left.
            Reversed: the picture is capped at 30vh and 4:3 rather than square,
            which hands roughly a fifth of the sheet back to the name, the price
            and the button -- the three things the customer opened it for. */}
        <div className="p-5">
          <h2 id="product-detail-title" className="font-bold text-xl leading-snug">{active.name}</h2>
          {active.description && <p className="text-sm text-mist mt-2 leading-relaxed">{active.description}</p>}
          <p className="text-xl mt-3">
            {activeDiscount && <span className="text-mist text-sm line-through ml-2">{baseActivePrice}</span>}
            <span className="text-sea font-bold">{itemSizes.length > 0 ? `من ${activeDisplayPrice}` : activeDisplayPrice} ج.م</span>
          </p>

          <div className="mt-5">
            {hasOptions ? (
              <button className="btn-sea w-full !py-3 !rounded-full" disabled={disabled} onClick={() => onCustomize(active)}>
                اختيار
              </button>
            ) : (
              // Stepper BESIDE the action, the same shape as CustomizeSheet.
              // Here the stepper used to replace the button once anything was
              // in the cart, so the two sheets behaved differently for the
              // same job -- and once it appeared there was no «إضافة» left to
              // press, only a counter.
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-1 bg-shellup rounded-full px-1.5 py-1.5 shrink-0">
                  <button className="w-9 h-9 rounded-full grid place-items-center hover:bg-white disabled:opacity-40"
                    aria-label="أقل" disabled={qty <= 0} onClick={() => onRemove(active)}>
                    <Icon name="minus" size="sm" />
                  </button>
                  <span className="font-bold text-sm min-w-[1.4rem] text-center">{qty}</span>
                  <button className="w-9 h-9 rounded-full grid place-items-center bg-sea text-white"
                    aria-label="أكتر" onClick={() => onAdd(active)}>
                    <Icon name="plus" size="sm" />
                  </button>
                </div>
                {/* At zero the button IS the add; once something is in the
                    cart it confirms and closes. */}
                <button className="btn-sea flex-1" disabled={disabled}
                  onClick={() => (qty === 0 ? onAdd(active) : onClose())}>
                  {qty === 0 ? 'إضافة' : `تمام • ${activeDisplayPrice * qty} ج.م`}
                </button>
              </div>
            )}
          </div>

          {related.length > 0 && (
            <div>
              {/* No rule here: the section already reads as separate, and the line
                  landed immediately under the stepper as if it belonged to it. */}
              <h3 className="font-semibold text-sm text-mist mb-3 pt-5">منتجات تانية ممكن تعجبك</h3>
              <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-none">
                {related.map(r => {
                  const rArt = artFor(r.category)
                  const rSizes = sizes.filter(s => s.menu_item_id === r.id)
                  const rBasePrice = rSizes.length > 0 ? Math.min(...rSizes.map(s => s.price)) : r.price
                  const rDiscount = effectiveDiscount(r.id, r.category, discounts)
                  const rPrice = applyDiscount(rBasePrice, rDiscount)
                  return (
                    <button key={r.id} className="shrink-0 w-28 text-right" onClick={() => setActiveId(r.id)}>
                      {/* border: object-contain on a white background means a
                          product photo shot on white (most of them) had no
                          visible edge against the sheet's own white
                          background -- the thumbnail "melted" into the page
                          with nothing marking where the tile actually was. */}
                      {/* object-cover, not object-contain: contain preserves
                          the whole (usually non-square) photo and letterboxes
                          the rest of the square frame, which read as the
                          image "not filling the tile" -- same fix already
                          applied to the main sheet photo and every ProductCard
                          grid tile elsewhere in the app. */}
                      <div className="rounded-xl aspect-square grid place-items-center text-2xl mb-1.5 overflow-hidden border border-line"
                        style={{ background: r.image_url ? '#fff' : rArt.tint }}>
                        {r.image_url ? <img src={sized(r.image_url, IMG.square)} alt={r.name} className="w-full h-full object-cover" /> : <CategoryArt art={rArt} size="lg" className="text-mist" />}
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
