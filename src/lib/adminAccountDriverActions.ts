import { edgeAction, type RpcResult } from './rpc'

export type AdminAccountDriverAction = 'convertStaffRole' | 'deleteCustomer' | 'deleteCustomerByPhone' | 'deleteStaff' | 'resetDriverDevice' | 'setCustomerBan' | 'upsertDriver'

export function adminAccountDriverAction<T = unknown>(action: AdminAccountDriverAction, input: Record<string, unknown>, overrides?: Record<string, string>): Promise<RpcResult<T>> {
  return edgeAction<T>('admin-account-driver-actions', { action, ...input }, overrides)
}
