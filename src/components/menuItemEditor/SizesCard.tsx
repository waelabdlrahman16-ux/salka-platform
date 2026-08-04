import { useState } from 'react'
import type { MenuItemSize } from '../../lib/types'

/** The shapes that come up over and over. One tap each. */
const PRESETS: { label: string; names: string[] }[] = [
  { label: 'عادي / دوبل', names: ['عادي', 'دوبل'] },
  { label: 'وسط / كبير', names: ['وسط', 'كبير'] },
  { label: 'صغير / وسط / كبير', names: ['صغير', 'وسط', 'كبير'] },
]

export default function SizesCard({
  sizes, newSize, setNewSize, onAdd, onRemove, onApplyPreset, onPriceChange
}: {
  sizes: MenuItemSize[]
  newSize: { name: string; price: string }
  setNewSize: (v: { name: string; price: string }) => void
  onAdd: () => void
  onRemove: (id: number) => void
  onApplyPreset: (names: string[]) => void
  onPriceChange: (id: number, price: string) => void
}) {
  // Local drafts so a price is written once, on blur -- not once per keystroke.
  const [draft, setDraft] = useState<Record<number, string>>({})

  // A preset seeds every size at the item's base price, which is right for the
  // smallest one and wrong for the rest. Rather than guess a multiple and be
  // silently wrong, say so until it's fixed: a دوبل priced the same as a عادي
  // is a real loss on every order, and nothing else in the app would catch it.
  const dupPrices = sizes.length > 1 && new Set(sizes.map(s => Number(s.price))).size < sizes.length

  return (
    <div className="card p-4 mb-3">
      <p className="font-semibold text-sm mb-2">الأحجام (اختياري)</p>
      <p className="text-xs text-mist mb-3">
        للحاجات اللي ليها مقاس واحد بس مختلف السعر — زي ساندوتش <b>عادي</b> و<b>دوبل</b>.
        السعر هنا <b>بدل</b> السعر الأساسي، مش زيادة عليه، والعميل لازم يختار واحد قبل ما يضيف الصنف.
      </p>

      {sizes.length === 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold mb-1.5">ابدأ بضغطة واحدة</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(p => (
              <button key={p.label} className="text-xs py-1.5 px-3 rounded-lg border-2 border-line hover:border-sea"
                onClick={() => onApplyPreset(p.names)}>
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-mist mt-1.5">هيتضافوا بسعر الصنف الأساسي، وتعدّل السعر من هنا على طول.</p>
        </div>
      )}

      <div className="space-y-2 mb-3">
        {sizes.map(s => (
          <div key={s.id} className="flex items-center gap-2 bg-night border border-line rounded-lg p-2.5 text-sm">
            <span className="flex-1 min-w-0 truncate">
              {s.name} {s.is_default && <span className="text-xs text-mist">(افتراضي)</span>}
            </span>
            <input
              className="field !py-1 !w-20 !text-sm text-center" type="number" inputMode="numeric"
              value={draft[s.id] ?? String(s.price)}
              onChange={e => setDraft(d => ({ ...d, [s.id]: e.target.value }))}
              onBlur={e => { onPriceChange(s.id, e.target.value); setDraft(d => { const c = { ...d }; delete c[s.id]; return c }) }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              aria-label={`سعر ${s.name}`} />
            <span className="text-xs text-mist shrink-0">ج.م</span>
            <button className="text-red-500 text-xs shrink-0" onClick={() => onRemove(s.id)}>حذف</button>
          </div>
        ))}
        {sizes.length === 0 && <p className="text-xs text-mist">لسه مفيش أحجام مضافة</p>}
      </div>

      {dupPrices && (
        <p className="text-xs text-sandink bg-sandink/10 rounded-lg p-2 mb-3">
          ⚠️ فيه حجمين بنفس السعر — لو ده مش مقصود، عدّل السعر قبل ما تسيب الشاشة.
        </p>
      )}

      <div className="flex gap-2">
        <input className="field !py-1.5 text-sm" placeholder="اسم الحجم (وسط، كبير)" value={newSize.name}
          onChange={e => setNewSize({ ...newSize, name: e.target.value })} />
        <input className="field !py-1.5 !w-24 text-sm" type="number" placeholder="السعر" value={newSize.price}
          onChange={e => setNewSize({ ...newSize, price: e.target.value })} />
        <button className="btn-ghost !py-1.5 !px-3 text-sm shrink-0" onClick={onAdd}>إضافة</button>
      </div>
    </div>
  )
}
