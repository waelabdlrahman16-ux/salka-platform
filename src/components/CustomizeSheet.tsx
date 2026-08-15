import { useEffect, useMemo, useState } from 'react'
import { useDismissable } from '../lib/useDismissable'
import { applyDiscount, effectiveDiscount } from '../lib/discounts'
import type { Discount, MenuItem, MenuItemAddon, MenuItemAddonGroup, MenuItemCombo, MenuItemSize } from '../lib/types'

export default function CustomizeSheet({
  item, sizes, combos, addonGroups, addons, discounts, onClose, onConfirm
}: {
  item: MenuItem
  discounts: Discount[]
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

  // ONE decision: sandwich or combo, never both.
  //
  // This was briefly a توجل toggle plus a second size list, on the theory that
  // "make it a combo" and "which size" are two questions. They are not, for this
  // menu: the combo's size IS the fries-and-cola size, so a combo row is simply
  // another thing the customer can buy instead of the sandwich. Two controls
  // made it look like they stacked -- pay for the sandwich AND the combo.
  //
  // So: one required radio list. The plain rows first (the item's own sizes, or
  // the sandwich by itself if it has none), then the combos.
  const availableCombos = combos.filter(c => c.available)
  const [comboId, setComboId] = useState<number | null>(null)
  const comboOn = comboId != null

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // A combo price REPLACES the base price -- it is a different product, not a
  // surcharge -- and it stands in for the size, because the combo rows are the
  // sizes. place_order applies exactly this rule server-side; this is the
  // display of it, not the authority for it.
  const chosenCombo = comboOn ? availableCombos.find(c => c.id === comboId) ?? null : null
  const rawBase = chosenCombo ? chosenCombo.price
    : sizes.length > 0 ? (sizes.find(s => s.id === sizeId)?.price ?? 0)
    : item.price
  // The sheet used to price without discounts while the product card and the
  // cart both applied them, so one tap produced three different numbers: 80 on
  // the card, 130 on this button, 104 in the basket. Same discount rule as
  // lib/linePricing and place_order.
  const discount = effectiveDiscount(item.id, item.category, discounts)
  const basePrice = applyDiscount(rawBase, discount)
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
  const valid = (chosenCombo != null || sizes.length === 0 || sizeId != null) && groupsValid

  // Direct inset positioning on the sheet itself -- see the note in
  // ProductDetailSheet.
  return (
    <div ref={overlayRef} role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/60" onClick={onClose}>
      <div className="card fixed inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 w-full sm:w-full sm:max-w-md p-5 rounded-b-none sm:rounded-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="font-bold text-lg mb-1">{item.name}</h2>
        {item.description && <p className="text-sm text-mist mb-4">{item.description}</p>}

        {(sizes.length > 0 || availableCombos.length > 0) && (
          <div className="mb-4">
            <p className="font-semibold text-sm mb-2">
              {/* «(مطلوب)» rather than a bare `*`. The asterisk is a Western form
                  convention, it announces as nothing useful, and in an RTL line it
                  lands where a reader does not look for it. */}
              {availableCombos.length > 0 ? 'ساندوتش لوحده ولا كومبو؟' : 'الحجم'}{' '}
              <span className="text-sandink font-normal text-xs">(مطلوب)</span>
            </p>
            <div className="space-y-2">
              {/* Plain rows. With sizes, each size is its own row; without, one
                  row for the item by itself -- which still has to be visible and
                  selectable, or "sandwich alone" is not an option the customer
                  can actually pick. */}
              {sizes.length > 0 ? sizes.map(s => (
                <label key={`s${s.id}`} className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-2.5 cursor-pointer ${!comboOn && sizeId === s.id ? 'border-sea bg-sea/5' : 'border-line'}`}>
                  <input type="radio" name="what" checked={!comboOn && sizeId === s.id}
                    onChange={() => { setComboId(null); setSizeId(s.id) }} className="accent-sea w-4 h-4 shrink-0" />
                  <span className="flex-1 text-sm font-medium">{s.name}</span>
                  <span className="text-sm text-mist">{applyDiscount(s.price, discount)} ج.م</span>
                </label>
              )) : availableCombos.length > 0 && (
                <label className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-2.5 cursor-pointer ${!comboOn ? 'border-sea bg-sea/5' : 'border-line'}`}>
                  <input type="radio" name="what" checked={!comboOn}
                    onChange={() => setComboId(null)} className="accent-sea w-4 h-4 shrink-0" />
                  <span className="flex-1 text-sm font-medium">ساندوتش لوحده</span>
                  <span className="text-sm text-mist">{applyDiscount(item.price, discount)} ج.م</span>
                </label>
              )}

              {availableCombos.map(c => (
                <label key={`c${c.id}`} className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-2.5 cursor-pointer ${comboId === c.id ? 'border-sea bg-sea/5' : 'border-line'}`}>
                  <input type="radio" name="what" checked={comboId === c.id}
                    onChange={() => setComboId(c.id)} className="accent-sea w-4 h-4 shrink-0" />
                  <span className="text-lg leading-none">🍟</span>
                  <span className="flex-1 text-sm font-medium">كومبو {c.name}</span>
                  <span className="text-sm text-mist">{applyDiscount(c.price, discount)} ج.م</span>
                </label>
              ))}
            </div>
            {availableCombos.length > 0 && (
              <p className="text-xs text-mist mt-2">الكومبو شامل البطاطس والمشروب</p>
            )}
          </div>
        )}

        {addonGroups.map(g => (
          <div key={g.id} className="mb-4">
            <p className="font-semibold text-sm mb-2">
              {g.name} {g.min_select > 0 && <span className="text-sandink font-normal text-xs">(مطلوب)</span>}
              {g.max_select === 1
                ? <span className="text-mist font-normal"> (اختار واحد)</span>
                : g.max_select != null && <span className="text-mist font-normal"> (حد أقصى {g.max_select})</span>}
            </p>
            <div className="space-y-2">
              {addons.filter(a => a.group_id === g.id && a.available).map(a => (
                // The control comes FIRST in source order, so in RTL it sits on
                // the right — the leading edge. It used to be last, which put it
                // at the far left while the label it belongs to was right
                // aligned, making the eye cross the whole row to find the thing
                // it has to tap.
                <label key={a.id} className="flex items-center gap-3 rounded-xl border-2 border-line px-3.5 py-2.5 cursor-pointer">
                  {g.max_select === 1
                    ? <input type="radio" name={`group-${g.id}`} checked={addonIds.includes(a.id)} onChange={() => toggleAddon(a, g)} className="accent-sea w-4 h-4 shrink-0" />
                    : <input type="checkbox" checked={addonIds.includes(a.id)} onChange={() => toggleAddon(a, g)} className="accent-sea w-4 h-4 shrink-0" />}
                  {a.image_url && <img src={a.image_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />}
                  <span className="flex-1 text-sm font-medium">{a.name}</span>
                  {/* `+20 ج.م` rendered as «20+ ج.م»: the leading + is bidi-neutral,
                      so at the start of an RTL run it reflows to the other end.
                      <bdi dir="ltr"> isolates the signed number. */}
                  <span className="text-sm text-mist">
                    {a.price > 0 ? <><bdi dir="ltr">+{a.price}</bdi> ج.م</> : 'مجانًا'}
                  </span>
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
            إضافة · {total} ج.م
          </button>
        </div>
      </div>
    </div>
  )
}
