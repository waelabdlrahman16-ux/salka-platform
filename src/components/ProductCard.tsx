import { artFor } from '../lib/categoryArt'
import Icon from './Icon'
import type { MenuItem } from '../lib/types'

export default function ProductCard({
  item, qty, disabled, onAdd, onRemove
}: {
  item: MenuItem
  qty: number
  disabled?: boolean
  onAdd: () => void
  onRemove: () => void
}) {
  const art = artFor(item.category)

  return (
    <div className="card p-3 flex flex-col">
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
      </div>

      <h3 className="font-semibold text-sm leading-snug line-clamp-2 min-h-[2.5em]">{item.name}</h3>
      {item.description && <p className="text-xs text-mist mt-0.5 line-clamp-1">{item.description}</p>}
      <p className="text-sea font-bold mt-1.5 mb-3">{item.price} ج.م</p>

      {qty === 0 ? (
        <button
          className="w-full h-10 rounded-lg bg-sea text-white font-bold text-sm grid place-items-center hover:bg-seadeep transition-colors disabled:opacity-40 disabled:pointer-events-none"
          disabled={disabled}
          onClick={onAdd}><span className="flex items-center gap-1.5"><Icon name="plus" className="w-3 h-3" /> إضافة</span></button>
      ) : (
        <div className="w-full h-10 rounded-lg bg-shellup flex items-center justify-between px-1.5">
          <button className="w-7 h-7 rounded-md grid place-items-center text-foam hover:bg-white transition-colors"
            onClick={onRemove} aria-label="تقليل"><Icon name="minus" className="w-3 h-3" /></button>
          <span className="font-bold text-sm">{qty}</span>
          <button className="w-7 h-7 rounded-md grid place-items-center text-white bg-sea hover:bg-seadeep transition-colors"
            onClick={onAdd} aria-label="زيادة"><Icon name="plus" className="w-3 h-3" /></button>
        </div>
      )}
    </div>
  )
}
