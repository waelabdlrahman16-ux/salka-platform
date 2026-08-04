import { useEffect, useMemo, useState } from 'react'
import { useDismissable } from '../lib/useDismissable'
import type { MenuItem, MenuItemAddon, MenuItemAddonGroup, MenuItemCombo, MenuItemSize } from '../lib/types'

export default function CustomizeSheet({
  item, sizes, combos, addonGroups, addons, onClose, onConfirm
}: {
  item: MenuItem
  sizes: MenuItemSize[]
  combos: MenuItemCombo[]
  addonGroups: MenuItemAddonGroup[]
  addons: MenuItemAddon[]
  onClose: () => void
  onConfirm: (sizeId: number | null, comboId: number | null, addonIds: number[], qty: number) => void
}) {
  const overlayRef = useDismissable(onClose)
  const defaultSize = sizes.find(s => s.is_default) ?? sizes[0] ?? null
  const [sizeId, setSizeId] = useState<number | null>(defaultSize?.id ?? null)
  const [addonIds, setAddonIds] = useState<number[]>([])
  const [qty, setQty] = useState(1)

  // Two steps, deliberately. Turning the combo on is a decision about WHAT you
  // are buying; the size is a decision about how much of it. Collapsing them
  // into one list of four radios reads as four unrelated products.
  const availableCombos = combos.filter(c => c.available)
  const [comboOn, setComboOn] = useState(false)
  const [comboId, setComboId] = useState<number | null>(null)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // A combo price REPLACES the base price -- it is a different product, not a
  // surcharge -- and it stands in for the size, because the combo rows are the
  // sizes. place_order applies exactly this rule server-side; this is the
  // display of it, not the authority for it.
  const chosenCombo = comboOn ? availableCombos.find(c => c.id === comboId) ?? null : null
  const basePrice = chosenCombo ? chosenCombo.price
    : sizes.length > 0 ? (sizes.find(s => s.id === sizeId)?.price ?? 0)
    : item.price
  const addonsTotal = addonIds.reduce((s, id) => s + (addons.find(a => a.id === id)?.price ?? 0), 0)
  const unitPrice = basePrice + addonsTotal
  const total = unitPrice * qty

  const groupCounts = useMemo(() => {
    const m: Record<number, number> = {}
    for (const a of addons) if (addonIds.includes(a.id)) m[a.group_id] = (m[a.group_id] ?? 0) + 1
    return m
  }, [addonIds, addons])

  function toggleAddon(a: MenuItemAddon, group: MenuItemAddonGroup) {
    setAddonIds(prev => {
      const has = prev.includes(a.id)
      const groupAddonIds = addons.filter(x => x.group_id === group.id).map(x => x.id)
      const outsideGroup = prev.filter(id => !groupAddonIds.includes(id))

      if (group.max_select === 1) {
        // single-select "combo swap" group (e.g. choose your sandwich) —
        // picking one replaces whatever else was selected in this group
        return has ? outsideGroup : [...outsideGroup, a.id]
      }
      if (has) return prev.filter(id => id !== a.id)
      const count = groupCounts[group.id] ?? 0
      if (group.max_select != null && count >= group.max_select) return prev // at cap, ignore
      return [...prev, a.id]
    })
  }

  const groupsValid = addonGroups.every(g => {
    const c = groupCounts[g.id] ?? 0
    return c >= g.min_select && (g.max_select == null || c <= g.max_select)
  })
  // Turning the combo on without picking a size is an unfinished decision, so
  // the button stays disabled rather than quietly charging the plain price.
  const comboValid = !comboOn || chosenCombo != null
  const valid = (chosenCombo != null || sizes.length === 0 || sizeId != null) && groupsValid && comboValid

  return (
    <div ref={overlayRef} role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/60 grid place-items-end sm:place-items-center p-0 sm:p-4" onClick={onClose}>
      <div className="card w-full sm:max-w-md p-5 rounded-b-none sm:rounded-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="font-bold text-lg mb-1">{item.name}</h2>
        {item.description && <p className="text-sm text-mist mb-4">{item.description}</p>}

        {availableCombos.length > 0 && (
          <div className="mb-4">
            <label className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-3 cursor-pointer ${comboOn ? 'border-sea bg-sea/5' : 'border-line'}`}>
              <span className="text-xl leading-none">🍟</span>
              <span className="flex-1">
                <span className="block text-sm font-bold">{item.combo_label || 'اعمله كومبو'}</span>
                <span className="block text-xs text-mist mt-0.5">
                  يبقى من {Math.min(...availableCombos.map(c => c.price))} ج.م بدل {item.price} ج.م
                </span>
              </span>
              <input type="checkbox" checked={comboOn} className="accent-sea w-5 h-5"
                onChange={e => {
                  const on = e.target.checked
                  setComboOn(on)
                  // Preselect nothing on the way in -- the customer has to say
                  // which size, that is the whole point of the second step. But
                  // clear it on the way out, so a combo size cannot linger on a
                  // line that is no longer a combo.
                  if (!on) setComboId(null)
                }} />
            </label>

            {comboOn && (
              <div className="mt-2 space-y-2 pr-2 border-r-2 border-sea/30">
                <p className="font-semibold text-sm">اختار حجم الكومبو <span className="text-sandink">*</span></p>
                {availableCombos.map(c => (
                  <label key={c.id} className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-2.5 cursor-pointer ${comboId === c.id ? 'border-sea bg-sea/5' : 'border-line'}`}>
                    <span className="flex-1 text-sm font-medium">{c.name}</span>
                    <span className="text-sm text-mist">{c.price} ج.م</span>
                    <input type="radio" name="combo-size" checked={comboId === c.id}
                      onChange={() => setComboId(c.id)} className="accent-sea w-4 h-4" />
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* The item's own sizes are meaningless once a combo is chosen: the
            combo row already carries a full price for a specific size. */}
        {sizes.length > 0 && !chosenCombo && (
          <div className="mb-4">
            <p className="font-semibold text-sm mb-2">الحجم *</p>
            <div className="space-y-2">
              {sizes.map(s => (
                <label key={s.id} className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-2.5 cursor-pointer ${sizeId === s.id ? 'border-sea bg-sea/5' : 'border-line'}`}>
                  <span className="flex-1 text-sm font-medium">{s.name}</span>
                  <span className="text-sm text-mist">{s.price} ج.م</span>
                  <input type="radio" checked={sizeId === s.id} onChange={() => setSizeId(s.id)} className="accent-sea w-4 h-4" />
                </label>
              ))}
            </div>
          </div>
        )}

        {addonGroups.map(g => (
          <div key={g.id} className="mb-4">
            <p className="font-semibold text-sm mb-2">
              {g.name} {g.min_select > 0 && <span className="text-sandink">*</span>}
              {g.max_select === 1
                ? <span className="text-mist font-normal"> (اختار واحد)</span>
                : g.max_select != null && <span className="text-mist font-normal"> (حد أقصى {g.max_select})</span>}
            </p>
            <div className="space-y-2">
              {addons.filter(a => a.group_id === g.id && a.available).map(a => (
                <label key={a.id} className="flex items-center gap-3 rounded-xl border-2 border-line px-3.5 py-2.5 cursor-pointer">
                  {a.image_url && <img src={a.image_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />}
                  <span className="flex-1 text-sm font-medium">{a.name}</span>
                  <span className="text-sm text-mist">{a.price > 0 ? `+${a.price} ج.م` : 'مجانًا'}</span>
                  {g.max_select === 1
                    ? <input type="radio" name={`group-${g.id}`} checked={addonIds.includes(a.id)} onChange={() => toggleAddon(a, g)} className="accent-sea w-4 h-4" />
                    : <input type="checkbox" checked={addonIds.includes(a.id)} onChange={() => toggleAddon(a, g)} className="accent-sea w-4 h-4" />}
                </label>
              ))}
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between mb-4 mt-2">
          <span className="font-semibold text-sm">الكمية</span>
          <div className="flex items-center gap-3 bg-shellup rounded-lg px-2 py-1.5">
            <button className="w-7 h-7 rounded-md grid place-items-center hover:bg-white" onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
            <span className="font-bold text-sm w-4 text-center">{qty}</span>
            <button className="w-7 h-7 rounded-md grid place-items-center bg-sea text-white" onClick={() => setQty(q => q + 1)}>+</button>
          </div>
        </div>

        <div className="flex gap-2.5">
          <button className="btn-ghost flex-1" onClick={onClose}>إلغاء</button>
          <button className="btn-sea flex-1" disabled={!valid}
            onClick={() => onConfirm(chosenCombo ? null : sizeId, chosenCombo?.id ?? null, addonIds, qty)}>
            {comboOn && !chosenCombo ? 'اختار حجم الكومبو' : `إضافة · ${total} ج.م`}
          </button>
        </div>
      </div>
    </div>
  )
}
