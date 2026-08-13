import { edgeAction, type RpcResult } from './rpc'

export type AdminFinancialAction = 'adjustOrder' | 'confirmCodDeposit' | 'confirmInstapay' | 'creditWallet' | 'markRefunded' | 'settleCash' | 'settleEarnings' | 'markAuditTest' | 'archiveOrder' | 'deleteTestOrder'

export function adminFinancialAction<T = unknown>(action: AdminFinancialAction, input: Record<string, unknown>): Promise<RpcResult<T>> {
  return edgeAction<T>('admin-financial-actions', { action, ...input })
}
