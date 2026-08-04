import { applyDiscount, effectiveDiscount } from './discounts'
import type { Discount, MenuItem, MenuItemAddon, MenuItemCombo, MenuItemSize } from './types'

/**
 * What one cart line costs, and what to call it.
 *
 * This existed twice -- once in CartPage, once in CheckoutPage -- as two copies
 * of the same twelve lines. That is the shape that has bitten this codebase
 * repeatedly: a rule with more than one home, where fixing one copy leaves the
 * other quietly disagreeing. The cart and the checkout showing different totals
 * for the same basket is the exact failure it invites.
 *
 * It is still not the authority. `place_order` recomputes every number here
 * from the same tables and ignores whatever the client sends. This function
 * exists so the customer is shown the same figure they will be charged; if the
 * two ever diverge, the server wins and this is the bug.
 */
export interface LinePrice {
  unit: number
  /** Pre-discount unit price, or null when nothing was discounted. */
  original: number | null
  item: MenuItem | undefined
  name: string
  sizeName: string | null
  comboName: string | null
  addonNames: string[]
}

export function priceLine(
  line: { menuItemId: number; sizeId: number | null; comboId: number | null; addonIds: number[] },
  data: { items: MenuItem[]; sizes: MenuItemSize[]; combos: MenuItemCombo[]; addons: MenuItemAddon[]; discounts: Discount[] }
): LinePrice {
  const item = data.items.find(i => i.id === line.menuItemId)
  const combo = line.comboId ? data.combos.find(c => c.id === line.comboId) ?? null : null
  const size = line.sizeId ? data.sizes.find(s => s.id === line.sizeId) ?? null : null

  // Precedence, matching place_order exactly: a combo replaces everything below
  // it, because it is a different product at its own price -- not a surcharge,
  // and not a modifier on the size.
  const base = combo ? combo.price : size ? size.price : (item?.price ?? 0)

  const discount = item ? effectiveDiscount(item.id, item.category, data.discounts) : null
  const discountedBase = applyDiscount(base, discount)
  const selected = line.addonIds
    .map(id => data.addons.find(a => a.id === id))
    .filter((a): a is MenuItemAddon => !!a)
  const addonsTotal = selected.reduce((s, a) => s + a.price, 0)

  return {
    unit: discountedBase + addonsTotal,
    original: discount ? base + addonsTotal : null,
    item,
    name: item?.name ?? '',
    sizeName: combo ? null : (size?.name ?? null),
    comboName: combo?.name ?? null,
    addonNames: selected.map(a => a.name),
  }
}
