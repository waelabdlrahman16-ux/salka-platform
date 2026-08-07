import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { MenuItem, Restaurant } from './types'
import { track } from './analytics'

// v3: CartLine gained comboId, which changes the shape of every line key. A
// cart persisted under v2 would carry keys that no longer match what lineKey
// now produces, so the same product could sit in the basket twice.
const KEY = 'salka_cart_v3'

export interface CartLine {
  key: string
  menuItemId: number
  sizeId: number | null
  /** Set when the customer upgraded to a combo. Replaces the base/size price. */
  comboId: number | null
  addonIds: number[]
  qty: number
}

interface CartState {
  restaurantId: number | null
  lines: CartLine[]
}

interface CartCtx {
  restaurantId: number | null
  lines: CartLine[]
  setForRestaurant: (restaurant: Restaurant) => void
  // simple path: items with no sizes/add-ons, same +/- stepper behavior as before
  add: (item: MenuItem, delta: number) => void
  qtyFor: (itemId: number) => number
  // customized path: items with sizes and/or add-ons go through a picker first
  addCustomLine: (menuItemId: number, sizeId: number | null, comboId: number | null, addonIds: number[], qty: number) => void
  updateLineQty: (key: string, delta: number) => void
  removeLine: (key: string) => void
  clear: () => void
  count: number
}

function lineKey(menuItemId: number, sizeId: number | null, comboId: number | null, addonIds: number[]): string {
  return `${menuItemId}:${sizeId ?? 'x'}:${comboId ?? 'x'}:${[...addonIds].sort((a, b) => a - b).join(',')}`
}

const Ctx = createContext<CartCtx>({
  restaurantId: null, lines: [], setForRestaurant: () => {}, add: () => {}, qtyFor: () => 0,
  addCustomLine: () => {}, updateLineQty: () => {}, removeLine: () => {}, clear: () => {}, count: 0
})

export const useCart = () => useContext(Ctx)

function load(): CartState {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { restaurantId: null, lines: [] }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CartState>(load)

  useEffect(() => {
    sessionStorage.setItem(KEY, JSON.stringify(state))
  }, [state])

  function setForRestaurant(restaurant: Restaurant) {
    // switching to a different restaurant's menu clears any in-progress cart
    // from a different vendor — one order is tied to one vendor.
    setState(s => s.restaurantId === restaurant.id ? s : { restaurantId: restaurant.id, lines: [] })
  }

  function add(item: MenuItem, delta: number) {
    const key = lineKey(item.id, null, null, [])
    // Funnel step 4. Only on a genuine addition -- `delta` is negative when the
    // customer taps minus, and counting a removal as an "item added" would make
    // an emptying cart look like engagement.
    if (delta > 0) track('item_added', { restaurantId: item.restaurant_id, props: { path: 'quick' } })
    setState(s => {
      const existing = s.lines.find(l => l.key === key)
      const q = Math.max(0, (existing?.qty ?? 0) + delta)
      const rest = s.lines.filter(l => l.key !== key)
      const next = q === 0 ? rest : [...rest, { key, menuItemId: item.id, sizeId: null, comboId: null, addonIds: [], qty: q }]
      return { restaurantId: item.restaurant_id, lines: next }
    })
  }

  function qtyFor(itemId: number): number {
    return state.lines.filter(l => l.menuItemId === itemId).reduce((s, l) => s + l.qty, 0)
  }

  function addCustomLine(menuItemId: number, sizeId: number | null, comboId: number | null, addonIds: number[], qty: number) {
    const key = lineKey(menuItemId, sizeId, comboId, addonIds)
    // The OTHER way an item enters the basket -- CustomizeSheet, i.e. anything
    // with a size, a combo or add-ons. Instrumenting add() alone would have
    // silently omitted every sized item, which for pizza or a McDonald's combo
    // is most of the catalogue.
    if (qty > 0) track('item_added', { props: { path: 'customize' } })
    setState(s => {
      const existing = s.lines.find(l => l.key === key)
      const rest = s.lines.filter(l => l.key !== key)
      const q = (existing?.qty ?? 0) + qty
      return { ...s, lines: [...rest, { key, menuItemId, sizeId, comboId, addonIds, qty: q }] }
    })
  }

  function updateLineQty(key: string, delta: number) {
    setState(s => {
      const next = s.lines
        .map(l => l.key === key ? { ...l, qty: Math.max(0, l.qty + delta) } : l)
        .filter(l => l.qty > 0)
      return { ...s, lines: next }
    })
  }

  function removeLine(key: string) {
    setState(s => ({ ...s, lines: s.lines.filter(l => l.key !== key) }))
  }

  function clear() {
    setState({ restaurantId: null, lines: [] })
  }

  const count = state.lines.reduce((a, l) => a + l.qty, 0)

  return (
    <Ctx.Provider value={{
      restaurantId: state.restaurantId, lines: state.lines, setForRestaurant,
      add, qtyFor, addCustomLine, updateLineQty, removeLine, clear, count
    }}>
      {children}
    </Ctx.Provider>
  )
}
