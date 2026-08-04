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
  const hasPhoto = !!item.image_url

  // A photo earns a full square. A category tile does not: 74 of 189 items have
  // no photograph, and five vendors have none at all, so on those menus an
  // aspect-square tile meant two items filled a phone screen and the rest of
  // the square was flat colour. Half the height fits twice as many items, and
  // the emoji is scaled up so the tile still reads as deliberate rather than
  // like a picture that failed to load.
  const tileShape = hasPhoto ? 'aspect-square text-4xl' : 'h-24 text-5xl'

  return (
    <div className="card p-3 flex flex-col">
      <button className="text-right" onClick={onOpenDetail}>
        <div className={`relative rounded-xl grid place-items-center mb-3 overflow-hidden ${tileShape}`}
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
          {hasOptions && qty > 0 && (
            <span className="absolute bottom-2 left-2 bg-sea text-white rounded-full min-w-[1.25rem] h-5 px-1 grid place-items-center text-[10px] font-bold">
              {qty}
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
