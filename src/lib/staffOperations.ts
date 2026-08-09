import { edgeAction, type RpcResult } from './rpc'

export type StaffOperationAction =
  'acceptSwap' | 'escalateSwap' | 'openSwaps' | 'requestEarlySettlement' | 'requestSwap' | 'vendorOpenStates'

export function staffOperation<T = unknown>(action: StaffOperationAction, input: Record<string, unknown> = {}, overrides?: Record<string, string>): Promise<RpcResult<T>> {
  return edgeAction<T>('staff-operations', { action, ...input }, overrides)
}
