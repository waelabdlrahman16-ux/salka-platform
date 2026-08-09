import { edgeAction, type RpcResult } from './rpc'

export type PublicCatalogAction =
  | 'deliveryQuote'
  | 'openSlots'
  | 'popularItems'
  | 'restaurant'
  | 'restaurants'
  | 'searchMenu'

export function publicCatalog<T>(
  action: PublicCatalogAction,
  input: Record<string, unknown>,
): Promise<RpcResult<T>> {
  return edgeAction<T>('public-catalog', { action, ...input })
}
