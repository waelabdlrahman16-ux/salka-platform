import { artFor } from '../lib/categoryArt'
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
      <div className="relative rounded-xl aspect-square grid place-items-center text-4xl mb-3"
        style={{ background: art.tint }}>
        {art.emoji}
        {item.requires_prescription && (
          <span className="absolute top-2 right-2 bg-white/90 rounded-full px-2 py-0.5 text-[10px] font-bold text-seadeep">
            💊 روشتة
          </span>
        )}

        {qty === 0 ? (
          <button
            className="absolute -bottom-2 -left-2 w-9 h-9 rounded-full bg-sea text-white text-xl font-bold grid place-items-center shadow-md shadow-sea/30 disabled:opacity-40"
            disabled={disabled}
            onClick={onAdd}
            aria-label="إضافة">+</button>
        ) : (
          <div className="absolute -bottom-2 inset-x-2 bg-white rounded-full shadow-md shadow-black/10 flex items-center justify-between px-1 py-1">
            <button className="w-7 h-7 rounded-full grid place-items-center text-seadeep font-bold hover:bg-shellup"
              onClick={onRemove} aria-label="تقليل">−</button>
            <span className="font-bold text-sm w-5 text-center">{qty}</span>
            <button className="w-7 h-7 rounded-full grid place-items-center text-white bg-sea font-bold hover:bg-seadeep"
              onClick={onAdd} aria-label="زيادة">+</button>
          </div>
        )}
      </div>

      <h3 className="font-semibold text-sm leading-snug line-clamp-2 min-h-[2.5em]">{item.name}</h3>
      {item.description && <p className="text-xs text-mist mt-0.5 line-clamp-1">{item.description}</p>}
      <p className="text-sea font-bold mt-1.5">{item.price} ج.م</p>
    </div>
  )
}
