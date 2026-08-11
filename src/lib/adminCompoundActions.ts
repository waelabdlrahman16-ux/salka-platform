import { edgeAction, type RpcResult } from './rpc'
import { observerBlocked } from './adminGuard'

export type AdminCompoundAction = 'upsertCompound' | 'setCompoundFee' | 'flagDriverDispute'

export function adminCompoundAction<T = unknown>(action: AdminCompoundAction, input: Record<string, unknown>, overrides?: Record<string, string>): Promise<RpcResult<T>> {
  const blocked = observerBlocked<T>()
  if (blocked) return Promise.resolve(blocked)
  return edgeAction<T>('admin-compound-actions', { action, ...input }, overrides)
}
