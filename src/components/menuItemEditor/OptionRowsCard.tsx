import { useState, type ReactNode } from 'react'
import Icon from '../Icon'

export interface OptionRow {
  id: number
  name: string
  price: number
  /** Small muted note after the name, e.g. "(افتراضي)". */
  note?: string
}

/**
 * One card for both الأحجام and اعمله كومبو.
 *
 * They were written separately and drifted immediately: different empty states,
 * one showed its add-row before there was anything to add, one had a hint line
 * the other didn't, and the price inputs were built twice with two different
 * draft-state bugs waiting to happen. They are the same thing -- a named list of
 * rows, each with a replacement price -- so they are now the same component, and
 * a change to one is a change to both by construction.
 *
 * What differs is passed in: the wording, the presets, the warning, and any
 * extra control the combo card needs.
 */
export default function OptionRowsCard({
  title, hint, rows, presets, warning, addPlaceholder,
  onApplyPreset, onAdd, onRemove, onPriceChange, onNameChange, children, disabled
}: {
  title: string
  hint: string
  rows: OptionRow[]
  presets: { label: string; names: string[] }[]
  /** Rendered only when set. Caller decides what counts as wrong. */
  warning: string | null
  addPlaceholder: string
  onApplyPreset: (names: string[]) => void
  onAdd: (name: string, price: string) => void
  onRemove: (id: number) => void
  onPriceChange: (id: number, price: string) => void
  /** True while a write from this or a sibling card is already in flight --
   *  every button here disables, so a double-tap on a slow connection can't
   *  fire the same insert twice before the dedupe state has refreshed. */
  disabled?: boolean
  /**
   * A preset names these rows for you (عادي / دوبل, وسط / كبير). Those names
   * are shown to the customer on the options sheet and printed on the driver's
   * card, and until now the only way to change one was to delete the row and
   * re-add it -- which also threw away its price. The add-on group name beside
   * this one has always been editable; the size and combo names were the
   * oversight.
   */
  onNameChange: (id: number, name: string) => void
  /** Extra control shown above the rows (the combo card's button label). */
  children?: ReactNode
}) {
  const [draft, setDraft] = useState({ name: '', price: '' })
  // Local drafts so a price is written once, on blur -- not once per keystroke.
  const [priceDraft, setPriceDraft] = useState<Record<number, string>>({})

  return (
    <div className="card p-4 mb-3">
      <p className="font-semibold text-sm mb-1">{title}</p>
      <p className="text-xs text-mist mb-3">{hint}</p>

      {rows.length === 0 ? (
        <div className="flex flex-wrap gap-2">
          {presets.map(p => (
            <button key={p.label} className="text-xs py-2 px-3 rounded-lg border-2 border-line hover:border-sea disabled:opacity-40"
              disabled={disabled} onClick={() => onApplyPreset(p.names)}>
              {p.label}
            </button>
          ))}
        </div>
      ) : (
        <>
          {children}

          <div className="space-y-2 mb-3">
            {rows.map(r => (
              <div key={r.id} className="flex items-center gap-2 bg-night border border-line rounded-lg p-2.5 text-sm">
                {/* Uncontrolled with defaultValue and written on blur, the same
                    shape as the add-on group name: a controlled input here would
                    fight the parent's reload after every save. */}
                <input className="field !py-1 flex-1 min-w-0 !text-sm"
                  defaultValue={r.name} aria-label={`اسم ${r.name}`}
                  onBlur={e => { if (e.target.value.trim() && e.target.value.trim() !== r.name) onNameChange(r.id, e.target.value) }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                {r.note && <span className="text-xs text-mist shrink-0">{r.note}</span>}
                <input className="field !py-1 !w-20 !text-sm text-center" type="number" inputMode="numeric"
                  value={priceDraft[r.id] ?? String(r.price)} aria-label={`سعر ${r.name}`}
                  onChange={e => setPriceDraft(d => ({ ...d, [r.id]: e.target.value }))}
                  onBlur={e => { onPriceChange(r.id, e.target.value); setPriceDraft(d => { const n = { ...d }; delete n[r.id]; return n }) }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                <span className="text-xs text-mist shrink-0">ج.م</span>
                <button className="text-red-500 text-xs shrink-0 disabled:opacity-40" disabled={disabled} onClick={() => onRemove(r.id)}>حذف</button>
              </div>
            ))}
          </div>

          {warning && (
            <p className="text-xs text-sandink bg-sandink/10 rounded-lg p-2 mb-3"><Icon name="warning" size="xs" className="inline-block align-[-0.15em] me-1" />{warning}</p>
          )}

          <div className="flex gap-2">
            <input className="field !py-1.5 text-sm" placeholder={addPlaceholder} value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })} />
            <input className="field !py-1.5 !w-24 text-sm" type="number" placeholder="السعر" value={draft.price}
              onChange={e => setDraft({ ...draft, price: e.target.value })} />
            <button className="btn-ghost !py-1.5 !px-3 text-sm shrink-0" disabled={disabled}
              onClick={() => { onAdd(draft.name, draft.price); setDraft({ name: '', price: '' }) }}>إضافة</button>
          </div>
        </>
      )}
    </div>
  )
}
