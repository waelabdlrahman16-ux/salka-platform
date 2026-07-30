import type { Discount } from './types'

// Mirrors place_order's discount resolution: item-level discount takes
// priority over category-level, and only currently-active, in-effect
// (within any start/end window) discounts count. Returns null if no
// discount currently applies.
export function effectiveDiscount(
  menuItemId: number, category: string, discounts: Discount[]
): Discount | null {
  const now = new Date()
  const inEffect = (d: Discount) =>
    d.active &&
    (!d.starts_at || new Date(d.starts_at) <= now) &&
    (!d.ends_at || new Date(d.ends_at) >= now)

  const itemDiscount = discounts.find(d => d.scope === 'item' && d.menu_item_id === menuItemId && inEffect(d))
  if (itemDiscount) return itemDiscount

  const catDiscount = discounts.find(d => d.scope === 'category' && d.category === category && inEffect(d))
  return catDiscount ?? null
}

export function applyDiscount(price: number, discount: Discount | null): number {
  if (!discount) return price
  const discounted = discount.discount_type === 'percent'
    ? price * (1 - discount.value / 100)
    : Math.max(0, price - discount.value)
  return Math.round(discounted * 100) / 100
}
