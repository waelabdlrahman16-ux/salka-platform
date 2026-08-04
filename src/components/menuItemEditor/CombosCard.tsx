import { useState } from 'react'
import type { MenuItemCombo } from '../../lib/types'

/**
 * The "make it a combo" upgrade.
 *
 * Kept separate from الأحجام on purpose. A size is a mandatory question about
 * the same product; a combo is an optional upgrade to a different product, and
 * once accepted it asks its own mandatory size question. Same table shape, very
 * different meaning to the customer, so they get different cards.
 */
export default function CombosCard({
  combos, comboLabel, setComboLabel, basePrice, onAdd, onRemove, onPriceChange, onApplyPreset
}: {
  combos: MenuItemCombo[]
  comboLabel: string
  setComboLabel: (v: string) => void
  basePrice: string
  onAdd: (name: string, price: string) => void
  onRemove: (id: number) => void
  onPriceChange: (id: number, price: string) => void
  onApplyPreset: (names: string[]) => void
}) {
  const [draft, setDraft] = useState({ name: '', price: '' })
  const [priceDraft, setPriceDraft] = useState<Record<number, string>>({})

  // The combo has to cost more than the sandwich alone, or the customer is
  // being offered fries and a drink for free. Nothing else in the system
  // would notice: place_order charges whatever this table says.
  const base = Number(basePrice) || 0
  const tooCheap = combos.filter(c => Number(c.price) <= base)

  return (
    <div className="card p-4 mb-3">
      <p className="font-semibold text-sm mb-2">اعمله كومبو (اختياري)</p>
      <p className="text-xs text-mist mb-3">
        زي ماكدونالدز: الساندوتش لوحده بسعره، ولو العميل اختار كومبو لازم يختار الحجم،
        و<b>السعر بيبقى بدل سعر الساندوتش مش زيادة عليه</b> — يعني اكتب هنا سعر الكومبو كامل.
      </p>

      {combos.length === 0 ? (
        <div>
          <button className="text-xs py-2 px-3 rounded-lg border-2 border-line hover:border-sea"
            onClick={() => onApplyPreset(['عادي', 'وسط', 'كبير'])}>
            ابدأ بـ عادي / وسط / كبير
          </button>
          <p className="text-[11px] text-mist mt-1.5">هيتضافوا بسعر الساندوتش، وتكتب سعر كل كومبو من هنا.</p>
        </div>
      ) : (
        <>
          <div className="mb-3">
            <label className="label !text-xs">كلام الزرار اللي العميل هيشوفه</label>
            <input className="field !py-1.5 text-sm" value={comboLabel} placeholder="اعمله كومبو"
              onChange={e => setComboLabel(e.target.value)} />
            <p className="text-[11px] text-mist mt-1">بيتحفظ مع الصنف لما تدوس حفظ.</p>
          </div>

          <div className="space-y-2 mb-3">
            {combos.map(c => (
              <div key={c.id} className="flex items-center gap-2 bg-night border border-line rounded-lg p-2.5 text-sm">
                <span className="flex-1 min-w-0 truncate">{c.name}</span>
                <input className="field !py-1 !w-20 !text-sm text-center" type="number" inputMode="numeric"
                  value={priceDraft[c.id] ?? String(c.price)} aria-label={`سعر ${c.name}`}
                  onChange={e => setPriceDraft(d => ({ ...d, [c.id]: e.target.value }))}
                  onBlur={e => { onPriceChange(c.id, e.target.value); setPriceDraft(d => { const n = { ...d }; delete n[c.id]; return n }) }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                <span className="text-xs text-mist shrink-0">ج.م</span>
                <button className="text-red-500 text-xs shrink-0" onClick={() => onRemove(c.id)}>حذف</button>
              </div>
            ))}
          </div>

          {tooCheap.length > 0 && (
            <p className="text-xs text-sandink bg-sandink/10 rounded-lg p-2 mb-3">
              ⚠️ {tooCheap.map(c => c.name).join('، ')} سعرها مش أعلى من سعر الصنف ({base} ج.م) —
              يعني العميل هياخد الكومبو ببلاش. عدّل السعر.
            </p>
          )}

          <div className="flex gap-2">
            <input className="field !py-1.5 text-sm" placeholder="اسم الكومبو" value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })} />
            <input className="field !py-1.5 !w-24 text-sm" type="number" placeholder="السعر" value={draft.price}
              onChange={e => setDraft({ ...draft, price: e.target.value })} />
            <button className="btn-ghost !py-1.5 !px-3 text-sm shrink-0"
              onClick={() => { onAdd(draft.name, draft.price); setDraft({ name: '', price: '' }) }}>إضافة</button>
          </div>
        </>
      )}
    </div>
  )
}
