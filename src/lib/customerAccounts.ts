import { edgeAction, type RpcResult } from './rpc'

export type CustomerAccountAction =
  'addAddress' | 'deleteAddress' | 'myAddresses' | 'myOrders' | 'myProfile'
  | 'setDefaultAddress' | 'updateAddress' | 'updateName'

export function customerAccount<T = unknown>(action: CustomerAccountAction, input: Record<string, unknown> = {}, overrides?: Record<string, string>): Promise<RpcResult<T>> {
  return edgeAction<T>('customer-accounts', { action, ...input }, overrides)
}
