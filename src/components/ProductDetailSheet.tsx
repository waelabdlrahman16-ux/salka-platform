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
      <div className="fixed inset-x-0 bottom-0 w-full max-h-[90vh] overflow-y-auto bg-shell rounded-t-3xl" onClick={e => e.stopPropagation()}>
        {/* Drag handle: a purely visual affordance signalling "this sheet
            swipes down to close" -- it does not itself carry a gesture,
            useDismissable's backdrop tap/Back-button handling already does
            that job. */}

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
        <div className={`relative grid place-items-center text-5xl overflow-hidden bg-imgbg rounded-t-3xl ${
            active.image_url && !imgFailed ? 'aspect-[4/3] max-h-[26vh]' : 'h-28'}`}
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
          {/* Handle and close ON the photo: the sheet opens with the dish
              filling the top edge, and the two controls float over it. */}
          <span className="absolute inset-x-0 top-2 flex justify-center pointer-events-none">
            <span className="w-9 h-1 rounded-full bg-white/70" />
          </span>
        </div>

        {/* The image was taking 38vh and the item itself got whatever was left.
            Reversed: the picture is capped at 30vh and 4:3 rather than square,
            which hands roughly a fifth of the sheet back to the name, the price
            and the button -- the three things the customer opened it for. */}
        <div className="p-5">
          {/* Name and price on one line: they are the two facts the customer
              opened this for, and stacking them pushed the button further down
              for no gain. The description tucks under the name. */}
          <h2 id="product-detail-title" className="font-bold text-xl leading-snug">{active.name}</h2>
          {active.description && <p className="text-sm text-mist mt-1 leading-relaxed">{active.description}</p>}

          {/* The action bar, Talabat's shape: the price holds the start of the
              row and the control at the end SWAPS -- «إضافة للعربة» while the
              cart is empty of this item, a stepper once it is not. One row that
              answers "how much" and "how many" without stacking them.

              The discount is a struck price plus what you save, not a quieter
              number. «وفّر ١٥ ج.م» is the reason to act; a smaller figure on its
              own is just a price. */}
          <div className="mt-5 flex items-center gap-3">
            <div className="min-w-0">
              {activeDiscount && (
                <div className="flex items-center gap-2">
                  <span className="text-mist text-xs line-through">{baseActivePrice} ج.م</span>
                  <span className="bg-coral-100 text-coral-700 text-[11px] font-bold rounded-md px-2 py-0.5">
                    وفّر {Math.round((baseActivePrice - activeDisplayPrice) * 100) / 100} ج.م
                  </span>
                </div>
              )}
              <p className="text-xl font-bold">
                {itemSizes.length > 0 ? `من ${activeDisplayPrice}` : activeDisplayPrice} ج.م
              </p>
            </div>

            <div className="flex-1" />

            {hasOptions ? (
              <button className="btn-sea !px-7" disabled={disabled} onClick={() => onCustomize(active)}>
                اختيار
              </button>
            ) : qty === 0 ? (
              <button className="btn-sea !px-7" disabled={disabled} onClick={() => onAdd(active)}>
                إضافة للعربة
              </button>
            ) : (
              <div className="flex items-center gap-1 bg-shellup rounded-full px-1.5 py-1.5 shrink-0">
                <button className="w-9 h-9 rounded-full grid place-items-center hover:bg-white"
                  aria-label="أقل" onClick={() => onRemove(active)}>
                  <Icon name="minus" size="sm" />
                </button>
                <span className="font-bold text-sm min-w-[1.4rem] text-center">{qty}</span>
                <button className="w-9 h-9 rounded-full grid place-items-center bg-sea text-white"
                  aria-label="أكتر" onClick={() => onAdd(active)}>
                  <Icon name="plus" size="sm" />
                </button>
              </div>
            )}
          </div>

          {related.length > 0 && (
            <div className="relative -mx-5 mt-6 px-5 py-7 bg-shellup overflow-hidden">
              <span aria-hidden="true" className="absolute inset-x-0 top-0 h-3 pointer-events-none"
                style={{ background: 'radial-gradient(circle at 12px 0, #FFFFFF 11px, transparent 12px) 0 0 / 24px 24px repeat-x' }} />
              <h3 className="font-semibold text-sm text-mist mb-3">منتجات تانية ممكن تعجبك</h3>
              <div className="flex gap-3 overflow-x-auto pb-1 -mx-5 px-5 scrollbar-none">
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
