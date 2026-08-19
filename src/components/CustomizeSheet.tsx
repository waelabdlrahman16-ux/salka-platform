import { useEffect, useMemo, useState, type MutableRefObject } from 'react'
import { useDismissable } from '../lib/useDismissable'
import Icon from './Icon'
import IconButton from './IconButton'
import { applyDiscount, effectiveDiscount } from '../lib/discounts'
import type { Discount, MenuItem, MenuItemAddon, MenuItemAddonGroup, MenuItemCombo, MenuItemSize } from '../lib/types'
import { sized, IMG } from '../lib/imageUrl'

export default function CustomizeSheet({
  item, sizes, combos, addonGroups, addons, discounts, onClose, onConfirm, blockedRef
}: {
  item: MenuItem
  discounts: Discount[]
  sizes: MenuItemSize[]
  combos: MenuItemCombo[]
  addonGroups: MenuItemAddonGroup[]
  addons: MenuItemAddon[]
  onClose: () => void
  onConfirm: (sizeId: number | null, comboId: number | null, addonIds: number[], qty: number) => void
  /**
   * Kept pointed at whatever is currently stopping the add button, or null when
   * nothing is. RestaurantDetail reads it when the sheet is dismissed, so the
   * abandonment event can say WHY somebody left rather than only that they did.
   *
   * A ref rather than a callback prop on purpose: `onClose` is wired straight
   * to the overlay's onClick and to useDismissable, so it receives a MouseEvent
   * and cannot carry a reason without either changing every call site or
   * risking an event object being logged as one.
   */
  blockedRef?: MutableRefObject<string | null>
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
        // single-select "combo swap" group (e.g. choose your sandwich) --
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
  const sizeMissing = chosenCombo == null && sizes.length > 0 && sizeId == null
  const valid = !sizeMissing && groupsValid

  // Names match the server-side error codes place_order would raise for the
  // same state, so a blocked customisation and a blocked checkout describe
  // themselves the same way in the funnel.
  const blocking = sizeMissing ? 'size_required'
    : !groupsValid ? 'addon_group_min_not_met'
    : null
  useEffect(() => {
    if (blockedRef) blockedRef.current = blocking
  }, [blocking, blockedRef])

  // ALWAYS a full-bleed bottom sheet, no sm: desktop-centered variant --
  // see the note in ProductDetailSheet.
  return (
    <div ref={overlayRef} role="dialog" aria-labelledby="customize-sheet-title" aria-modal="true" className="fixed inset-0 z-50 bg-black/60" onClick={onClose}>
      <div className="card fixed inset-x-0 bottom-0 w-full p-5 !rounded-t-3xl rounded-b-none max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* The dish, before the radio buttons. This sheet opened straight onto
            «ساندوتش لوحده ولا كومبو؟» -- a form about a thing the customer
            could no longer see, even though the card they tapped was showing
            its photograph. Every delivery app in the market opens the sheet
            with the food. */}
        {/* overflow-hidden + the same top radius, or the photo squares off the
            corners the sheet just rounded. */}
        {item.image_url && (
          <div className="-mx-5 -mt-5 mb-4 relative overflow-hidden rounded-t-3xl">
            <img src={sized(item.image_url, IMG.wide)} alt="" loading="eager" decoding="async"
              className="w-full h-60 object-cover"
              onError={e => { (e.currentTarget.closest('div') as HTMLElement).style.display = 'none' }} />
            {/* Closing was backdrop-tap or «إلغاء» at the very bottom of a
                scrolling sheet -- so on a long list of add-ons there was no way
                out without scrolling back down. */}
            {/* Left, and the app's own close control rather than a one-off
                white disc -- this is the same button as every other close. */}
            <span className="absolute top-2 left-2">
              <IconButton icon="x" label="إغلاق" onClick={onClose} />
            </span>
          </div>
        )}
        <h2 id="customize-sheet-title" className="font-bold text-lg mb-1">{item.name}</h2>
        {item.description && <p className="text-sm text-mist mb-4">{item.description}</p>}

        {/* The sandwich and the combo are two questions, not one list. They
            were stacked under a single «ساندوتش لوحده ولا كومبو؟» heading, so
            four rows of different KINDS read as four flavours of the same
            thing. They still share one radio group -- picking a combo unpicks
            a size -- but the eye gets told where one choice ends. */}
        {(sizes.length > 0 || availableCombos.length > 0) && (
          <div className="mb-4">
            <p className="font-semibold text-sm mb-2 flex items-center gap-2">
              {sizes.length > 0 ? 'الحجم' : 'الساندوتش'}
              <span className="text-mist font-normal text-xs">اختار واحد</span>
              {/* A badge, not «(مطلوب)» in parentheses. The parenthetical read
                  as an aside about the heading; the thing it describes is the
                  section, and a badge says that at a glance. */}
              <span className="ms-auto bg-coral-100 text-coral-700 text-[11px] font-bold rounded-md px-2 py-0.5">مطلوب</span>
            </p>
            <div className="space-y-2">
              {sizes.length > 0 ? sizes.map(s => (
                <label key={`s${s.id}`} className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-2.5 cursor-pointer ${!comboOn && sizeId === s.id ? 'border-sea bg-sea/5' : 'border-line'}`}>
                  <input type="radio" name="what" checked={!comboOn && sizeId === s.id}
                    onChange={() => { setComboId(null); setSizeId(s.id) }} className="accent-sea w-4 h-4 shrink-0" />
                  <span className="flex-1 text-sm font-medium">{s.name}</span>
                  <span className="text-sm text-mist">{applyDiscount(s.price, discount)} ج.م</span>
                </label>
              )) : availableCombos.length > 0 && (
                // Without sizes there is still one row for the item by itself,
                // or "sandwich alone" is not an option the customer can pick.
                <label className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-2.5 cursor-pointer ${!comboOn ? 'border-sea bg-sea/5' : 'border-line'}`}>
                  <input type="radio" name="what" checked={!comboOn}
                    onChange={() => setComboId(null)} className="accent-sea w-4 h-4 shrink-0" />
                  <span className="flex-1 text-sm font-medium">ساندوتش لوحده</span>
                  <span className="text-sm text-mist">{applyDiscount(item.price, discount)} ج.م</span>
                </label>
              )}
            </div>
          </div>
        )}

        {availableCombos.length > 0 && (
          <div className="mb-4">
            <p className="font-semibold text-sm mb-1">أو خليها كومبو</p>
            <p className="text-xs text-mist mb-2">الكومبو شامل البطاطس والمشروب</p>
            <div className="space-y-2">
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
          </div>
        )}

        {addonGroups.map(g => (
          <div key={g.id} className="mb-4">
            {/* The rule sits next to the name it qualifies; «مطلوب» goes to the
                far end, where a status belongs. They were the other way round,
                so the badge interrupted the sentence. */}
            <p className="font-semibold text-sm mb-2 flex items-center gap-2">
              {g.name}
              {g.max_select === 1
                ? <span className="text-mist font-normal text-xs">اختار واحد</span>
                : g.max_select != null && <span className="text-mist font-normal text-xs">حد أقصى {g.max_select}</span>}
              {g.min_select > 0 && (
                <span className="ms-auto bg-coral-100 text-coral-700 text-[11px] font-bold rounded-md px-2 py-0.5">مطلوب</span>
              )}
            </p>
            <div className="space-y-2">
              {addons.filter(a => a.group_id === g.id && a.available).map(a => (
                // The control comes FIRST in source order, so in RTL it sits on
                // the right -- the leading edge. It used to be last, which put it
                // at the far left while the label it belongs to was right
                // aligned, making the eye cross the whole row to find the thing
                // it has to tap.
                <label key={a.id} className="flex items-center gap-3 rounded-xl border-2 border-line px-3.5 py-2.5 cursor-pointer">
                  {g.max_select === 1
                    ? <input type="radio" name={`group-${g.id}`} checked={addonIds.includes(a.id)} onChange={() => toggleAddon(a, g)} className="accent-sea w-4 h-4 shrink-0" />
                    : <input type="checkbox" checked={addonIds.includes(a.id)} onChange={() => toggleAddon(a, g)} className="accent-sea w-4 h-4 shrink-0" />}
                  {a.image_url && <img src={sized(a.image_url, IMG.icon)} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />}
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

        {/* Quantity sits in the action row where «إلغاء» was. Cancel had a
            button as prominent as Add for something the X on the photo and a
            backdrop tap already do -- and quantity, which people actually
            change, was a separate row above it. */}
        <div className="flex items-center gap-2.5 mt-2">
          <div className="flex items-center gap-1 bg-shellup rounded-full px-1.5 py-1.5 shrink-0">
            <button className="w-9 h-9 rounded-full grid place-items-center hover:bg-white disabled:opacity-40"
              aria-label="أقل" disabled={qty <= 1} onClick={() => setQty(q => Math.max(1, q - 1))}>
              <Icon name="minus" size="sm" />
            </button>
            <span className="font-bold text-sm min-w-[1.4rem] text-center">{qty}</span>
            <button className="w-9 h-9 rounded-full grid place-items-center bg-sea text-white"
              aria-label="أكتر" onClick={() => setQty(q => q + 1)}>
              <Icon name="plus" size="sm" />
            </button>
          </div>
          <button className="btn-sea flex-1" disabled={!valid}
            onClick={() => onConfirm(chosenCombo ? null : sizeId, chosenCombo?.id ?? null, addonIds, qty)}>
            إضافة • {total} ج.م
          </button>
        </div>
      </div>
    </div>
  )
}
