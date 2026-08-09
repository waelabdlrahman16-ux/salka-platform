import { edgeAction, type RpcResult } from './rpc'

export type CustomerOrderAccessAction = 'complaint' | 'push' | 'rating' | 'track'

export function customerOrderAccess<T>(
  action: CustomerOrderAccessAction,
  input: Record<string, unknown>,
  overrides?: Record<string, string>,
): Promise<RpcResult<T>> {
  return edgeAction<T>('customer-order-access', { action, ...input }, overrides)
}
