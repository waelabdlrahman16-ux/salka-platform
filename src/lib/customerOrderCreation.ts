import { edgeAction, type RpcResult } from './rpc'

export type CustomerOrderAction = 'catalog' | 'custom' | 'pickup'

export function customerOrderCreation<T>(
  action: CustomerOrderAction,
  input: Record<string, unknown>,
): Promise<RpcResult<T>> {
  return edgeAction<T>('customer-order-creation', { action, ...input })
}
