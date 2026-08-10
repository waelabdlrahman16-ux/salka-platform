import { edgeAction, type RpcResult } from './rpc'

export type AdminCompoundAction = 'upsertCompound' | 'setCompoundFee' | 'flagDriverDispute'

export function adminCompoundAction<T = unknown>(action: AdminCompoundAction, input: Record<string, unknown>, overrides?: Record<string, string>): Promise<RpcResult<T>> {
  return edgeAction<T>('admin-compound-actions', { action, ...input }, overrides)
}
