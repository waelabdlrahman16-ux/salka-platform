import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { MenuItem, Restaurant } from './types'

const KEY = 'salka_cart_v1'

interface CartState {
  restaurantId: number | null
  qty: Record<number, number>
}

interface CartCtx {
  restaurantId: number | null
  qty: Record<number, number>
  setForRestaurant: (restaurant: Restaurant) => void
  add: (item: MenuItem, delta: number) => void
  remove: (itemId: number) => void
  clear: () => void
  count: number
}

const Ctx = createContext<CartCtx>({
  restaurantId: null, qty: {}, setForRestaurant: () => {}, add: () => {}, remove: () => {}, clear: () => {}, count: 0
})

export const useCart = () => useContext(Ctx)

function load(): CartState {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { restaurantId: null, qty: {} }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CartState>(load)

  useEffect(() => {
    sessionStorage.setItem(KEY, JSON.stringify(state))
  }, [state])

  function setForRestaurant(restaurant: Restaurant) {
    // switching to a different restaurant's menu clears any in-progress cart
    // from a different vendor — one order is tied to one vendor.
    setState(s => s.restaurantId === restaurant.id ? s : { restaurantId: restaurant.id, qty: {} })
  }

  function add(item: MenuItem, delta: number) {
    setState(s => {
      const q = Math.max(0, (s.qty[item.id] ?? 0) + delta)
      const next = { ...s.qty }
      if (q === 0) delete next[item.id]; else next[item.id] = q
      return { restaurantId: item.restaurant_id, qty: next }
    })
  }

  function remove(itemId: number) {
    setState(s => {
      const next = { ...s.qty }
      delete next[itemId]
      return { ...s, qty: next }
    })
  }

  function clear() {
    setState({ restaurantId: null, qty: {} })
  }

  const count = Object.values(state.qty).reduce((a, b) => a + b, 0)

  return (
    <Ctx.Provider value={{ restaurantId: state.restaurantId, qty: state.qty, setForRestaurant, add, remove, clear, count }}>
      {children}
    </Ctx.Provider>
  )
}
