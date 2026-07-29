import { useEffect, useMemo, useState } from 'react'
import type { MenuItem, MenuItemAddon, MenuItemAddonGroup, MenuItemSize } from '../lib/types'

export default function CustomizeSheet({
  item, sizes, addonGroups, addons, onClose, onConfirm
}: {
  item: MenuItem
  sizes: MenuItemSize[]
  addonGroups: MenuItemAddonGroup[]
  addons: MenuItemAddon[]
  onClose: () => void
  onConfirm: (sizeId: number | null, addonIds: number[], qty: number) => void
}) {
  const defaultSize = sizes.find(s => s.is_default) ?? sizes[0] ?? null
  const [sizeId, setSizeId] = useState<number | null>(defaultSize?.id ?? null)
  const [addonIds, setAddonIds] = useState<number[]>([])
  const [qty, setQty] = useState(1)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const basePrice = sizes.length > 0 ? (sizes.find(s => s.id === sizeId)?.price ?? 0) : item.price
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
  const valid = (sizes.length === 0 || sizeId != null) && groupsValid

  return (
    <div className="fixed inset-0 z-50 bg-black/60 grid place-items-end sm:place-items-center p-0 sm:p-4" onClick={onClose}>
      <div className="card w-full sm:max-w-md p-5 rounded-b-none sm:rounded-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="font-bold text-lg mb-1">{item.name}</h2>
        {item.description && <p className="text-sm text-mist mb-4">{item.description}</p>}

        {sizes.length > 0 && (
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
              {g.name} {g.min_select > 0 && <span className="text-sand">*</span>}
              {g.max_select === 1
                ? <span className="text-mist font-normal"> (اختار واحد)</span>
                : g.max_select != null && <span className="text-mist font-normal"> (حد أقصى {g.max_select})</span>}
            </p>
            <div className="space-y-2">
              {addons.filter(a => a.group_id === g.id && a.available).map(a => (
                <label key={a.id} className="flex items-center gap-3 rounded-xl border-2 border-line px-3.5 py-2.5 cursor-pointer">
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
          <button className="btn-sea flex-1" disabled={!valid} onClick={() => onConfirm(sizeId, addonIds, qty)}>
            إضافة · {total} ج.م
          </button>
        </div>
      </div>
    </div>
  )
}
