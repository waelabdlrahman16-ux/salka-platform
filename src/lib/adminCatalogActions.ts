import { edgeAction, type RpcResult } from './rpc'
import { observerBlocked } from './adminGuard'

export type AdminCatalogAction = 'addMenuCategory' | 'renameMenuCategory' | 'deleteMenuCategory' | 'reorderMenuCategories' | 'deleteMenuItem' | 'setVendorHours' | 'setRestaurantRank'

export function adminCatalogAction<T = unknown>(action: AdminCatalogAction, input: Record<string, unknown>, overrides?: Record<string, string>): Promise<RpcResult<T>> {
  const blocked = observerBlocked<T>()
  if (blocked) return Promise.resolve(blocked)
  return edgeAction<T>('admin-catalog-actions', { action, ...input }, overrides)
}
