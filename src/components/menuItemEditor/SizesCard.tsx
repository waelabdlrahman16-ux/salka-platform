import type { MenuItemSize } from '../../lib/types'

export default function SizesCard({
  sizes, newSize, setNewSize, onAdd, onRemove
}: {
  sizes: MenuItemSize[]
  newSize: { name: string; price: string }
  setNewSize: (v: { name: string; price: string }) => void
  onAdd: () => void
  onRemove: (id: number) => void
}) {
  return (
    <div className="card p-4 mb-3">
      <p className="font-semibold text-sm mb-2">الأحجام (اختياري)</p>
      <p className="text-xs text-mist mb-3">لو ضفت حجم، العميل هيضطر يختار واحد قبل ما يضيف الصنف — والسعر هنا بيبقى بدل السعر الأساسي، مش زيادة عليه.</p>

      <div className="space-y-2 mb-3">
        {sizes.map(s => (
          <div key={s.id} className="flex items-center justify-between bg-night border border-line rounded-lg p-2.5 text-sm">
            <span>{s.name} {s.is_default && <span className="text-xs text-mist">(افتراضي)</span>}</span>
            <div className="flex items-center gap-2">
              <span>{s.price} ج.م</span>
              <button className="text-red-500 text-xs" onClick={() => onRemove(s.id)}>حذف</button>
            </div>
          </div>
        ))}
        {sizes.length === 0 && <p className="text-xs text-mist">لسه مفيش أحجام مضافة</p>}
      </div>

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
