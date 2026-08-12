import { edgeAction, type RpcResult } from './rpc'

export type AdminReportAction = 'customerDetail' | 'customers' | 'dailyReport' | 'funnel' | 'listAccounts' | 'liveDeliveries' | 'pendingRefunds' | 'pushHealth' | 'stalledOrders' | 'validatePush' | 'vendorsWithoutItems'

export function adminReport<T = unknown>(action: AdminReportAction, input: Record<string, unknown> = {}, overrides?: Record<string, string>): Promise<RpcResult<T>> {
  return edgeAction<T>('admin-reports', { action, ...input }, overrides)
}
