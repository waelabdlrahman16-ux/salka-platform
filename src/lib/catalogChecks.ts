import { edgeAction, type RpcResult } from './rpc'

export type CatalogCheckAction = 'applyLibraryAddon' | 'checkDiscountConflict' | 'restaurantReliability' | 'restaurantsReliabilityAll'

export function catalogCheck<T = unknown>(action: CatalogCheckAction, input: Record<string, unknown> = {}, overrides?: Record<string, string>): Promise<RpcResult<T>> {
  return edgeAction<T>('catalog-checks', { action, ...input }, overrides)
}
