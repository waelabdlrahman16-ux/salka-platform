import { edgeAction, type RpcResult } from './rpc'
import { observerBlocked } from './adminGuard'
export type AdminFinancialAction = 'adjustOrder' | 'confirmCodDeposit' | 'confirmInstapay' | 'creditWallet' | 'markRefunded' | 'settleCash' | 'settleEarnings'
export function adminFinancialAction<T = unknown>(action: AdminFinancialAction, input: Record<string, unknown>): Promise<RpcResult<T>> {
  const blocked = observerBlocked<T>()
  if (blocked) return Promise.resolve(blocked)
  return edgeAction<T>('admin-financial-actions', { action, ...input })
}
