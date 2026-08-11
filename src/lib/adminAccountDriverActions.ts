import { edgeAction, type RpcResult } from './rpc'
import { observerBlocked } from './adminGuard'

export type AdminAccountDriverAction = 'convertStaffRole' | 'deleteCustomer' | 'deleteCustomerByPhone' | 'deleteStaff' | 'resetDriverDevice' | 'setCustomerBan' | 'setVendorSlots' | 'upsertDriver'

export function adminAccountDriverAction<T = unknown>(action: AdminAccountDriverAction, input: Record<string, unknown>, overrides?: Record<string, string>): Promise<RpcResult<T>> {
  const blocked = observerBlocked<T>()
  if (blocked) return Promise.resolve(blocked)
  return edgeAction<T>('admin-account-driver-actions', { action, ...input }, overrides)
}
