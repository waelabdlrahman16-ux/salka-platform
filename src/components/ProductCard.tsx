import { artFor } from '../lib/categoryArt'
import Icon from './Icon'
import type { MenuItem } from '../lib/types'

export default function ProductCard({
  item, qty, disabled, onAdd, onRemove, hasOptions, onCustomize, onOpenDetail,
  displayPrice, originalPrice, isFromPrice
}: {
  item: MenuItem
  qty: number
  disabled?: boolean
  onAdd: () => void
  onRemove: () => void
  hasOptions?: boolean
  onCustomize?: () => void
  onOpenDetail: () => void
  displayPrice: number
  originalPrice?: number
  isFromPrice?: boolean
}) {
  const art = artFor(item.category)

  // The tile stays a full square whether or not there is a photo. A shorter
  // tile for photoless items was tried and reverted on 2026-08-04 at Wael's
  // call: a uniform grid is worth more than the extra items per screen, and
  // photography is coming, at which point every tile is a square anyway.
  return (
    <div className="card p-3 flex flex-col">
      <button className="text-right" onClick={onOpenDetail}>
        <div className="relative rounded-xl aspect-square grid place-items-center text-4xl mb-3 overflow-hidden"
          style={{ background: art.tint }}>
          {item.image_url
            ? <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
            : art.emoji}
          {item.requires_prescription && (
            <span className="absolute top-2 right-2 bg-white/90 rounded-full px-2 py-0.5 text-[10px] font-bold text-seadeep">
              💊 روشتة
            </span>
          )}
          {originalPrice != null && (
            <span className="absolute top-2 left-2 bg-sand text-white rounded-full px-2 py-0.5 text-[10px] font-bold">
              خصم
            </span>
          )}
          {/* An item with options never shows the +/- stepper -- the button
              below stays "اختيار" forever, because each tap configures a new
              variant. So this badge is the ONLY signal that the item is already
              in the cart, and it has to be readable.
              It was a 20px circle holding a 10px digit: at that size the number
              is clipped by its own container and reads as a stray dark dot on
              the photo. Nobody could tell it was a quantity, which is the one
              thing it exists to say. Now a labelled pill that says it. */}
          {hasOptions && qty > 0 && (
            <span className="absolute bottom-2 left-2 bg-sea text-white rounded-full px-2.5 py-1 text-[11px] font-bold leading-none shadow-sm">
              {qty} في العربة
            </span>
          )}
        </div>

        <h3 className="font-semibold text-sm leading-snug line-clamp-2 min-h-[2.5em]">{item.name}</h3>
        <p className="mt-1.5 mb-3">
          {originalPrice != null && <span className="text-mist text-xs line-through ml-1.5">{originalPrice}</span>}
          <span className="text-sea font-bold">{isFromPrice ? `من ${displayPrice}` : displayPrice} ج.م</span>
        </p>
      </button>

      {hasOptions ? (
        <button
          className="w-full h-10 rounded-lg bg-sea text-white font-bold text-sm grid place-items-center hover:bg-seadeep transition-colors disabled:opacity-40 disabled:pointer-events-none"
          disabled={disabled}
          onClick={onCustomize}><span className="flex items-center gap-1.5"><Icon name="plus" className="w-3 h-3" /> اختيار</span></button>
      ) : qty === 0 ? (
        <button
          className="w-full h-10 rounded-lg bg-sea text-white font-bold text-sm grid place-items-center hover:bg-seadeep transition-colors disabled:opacity-40 disabled:pointer-events-none"
          disabled={disabled}
          onClick={onAdd}><span className="flex items-center gap-1.5"><Icon name="plus" className="w-3 h-3" /> إضافة</span></button>
      ) : (
        <div className="w-full h-11 rounded-lg bg-shellup flex items-center justify-between px-1">
          <button className="w-9 h-9 rounded-md grid place-items-center text-foam hover:bg-white transition-colors"
            onClick={onRemove} aria-label="تقليل"><Icon name="minus" className="w-3.5 h-3.5" /></button>
          <span className="font-bold text-sm">{qty}</span>
          <button className="w-9 h-9 rounded-md grid place-items-center text-white bg-sea hover:bg-seadeep transition-colors"
            onClick={onAdd} aria-label="زيادة"><Icon name="plus" className="w-3.5 h-3.5" /></button>
        </div>
      )}
    </div>
  )
}
