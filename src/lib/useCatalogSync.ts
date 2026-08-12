import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

type CatalogSyncOptions = {
  restaurantId?: number | null
  refresh: () => void | Promise<void>
  fallbackIntervalMs?: number
}

/**
 * Keep catalog screens honest after another staff member changes a menu or a
 * restaurant. Realtime makes the common path immediate; the interval is a
 * deliberate fallback for browsers/networks where Realtime is unavailable.
 */
export function useCatalogSync({ restaurantId, refresh, fallbackIntervalMs = 30_000 }: CatalogSyncOptions) {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const channelName = useRef(`catalog-sync-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const queueRefresh = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        void refreshRef.current()
      }, 250)
    }
    const itemFilter = restaurantId ? `restaurant_id=eq.${restaurantId}` : undefined
    const restaurantFilter = restaurantId ? `id=eq.${restaurantId}` : undefined
    const channel = supabase
      .channel(channelName.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items', filter: itemFilter }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurants', filter: restaurantFilter }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'discounts', filter: itemFilter }, queueRefresh)
      .subscribe()
    const fallback = setInterval(queueRefresh, fallbackIntervalMs)

    return () => {
      if (timer) clearTimeout(timer)
      clearInterval(fallback)
      void supabase.removeChannel(channel)
    }
  }, [restaurantId, fallbackIntervalMs])
}
