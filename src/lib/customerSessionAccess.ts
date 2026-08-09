import { edgeAction, type RpcResult } from './rpc'

export type CustomerSessionAction =
  | 'lastAddress'
  | 'lastRequest'
  | 'logout'
  | 'orders'
  | 'wallet'
  | 'whoami'

export function customerSessionAccess<T>(
  action: CustomerSessionAction,
  input: Record<string, unknown>,
): Promise<RpcResult<T>> {
  return edgeAction<T>('customer-session-access', { action, ...input })
}
