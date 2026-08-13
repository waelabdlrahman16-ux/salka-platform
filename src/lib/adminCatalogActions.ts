import { edgeAction, type RpcResult } from './rpc'

export type AdminCatalogAction = 'addMenuCategory' | 'renameMenuCategory' | 'deleteMenuCategory' | 'reorderMenuCategories' | 'deleteMenuItem' | 'setVendorHours' | 'setRestaurantRank' | 'setRestaurantServiceFee'

export function adminCatalogAction<T = unknown>(action: AdminCatalogAction, input: Record<string, unknown>, overrides?: Record<string, string>): Promise<RpcResult<T>> {
  return edgeAction<T>('admin-catalog-actions', { action, ...input }, overrides)
}
