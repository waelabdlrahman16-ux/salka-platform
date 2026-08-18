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
  return round2(discounted)
}

/**
 * Round to 2dp the way Postgres `round(numeric, 2)` does -- half away from zero
 * -- rather than the way binary floating point happens to.
 *
 * `Math.round(x * 100) / 100` disagrees with the server by a piaster whenever
 * the exact result lands on a half that float cannot represent. Base 115 at
 * 13.5% off is exactly 99.475: the server stores 99.48, while
 * 115 * 0.865 evaluates to 99.47499999999999 and rounds DOWN to 99.47. The
 * customer is then quoted a price one piaster below what place_order charges.
 *
 * Going through the decimal string sidesteps the representation error: JS
 * prints the shortest decimal that round-trips, which for 99.47499999999999 is
 * "99.475", and Number(...) of the exponent-shifted string rounds it the same
 * way Postgres does.
 *
 * Only bites on non-integer discount percentages, and `discounts` is empty
 * today -- but the admin accepts a decimal, so it is one 12.5% offer away.
 */
export function round2(n: number): number {
  return Number(`${Math.round(Number(`${n}e2`))}e-2`)
}
