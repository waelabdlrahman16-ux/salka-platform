import { edgeAction, type RpcResult } from './rpc'

export type DriverAssignmentAction = 'claimOrder' | 'acceptAssignment' | 'arrivedAtRestaurant' | 'markPickedUp' | 'markOutForDelivery' | 'confirmCashReceived' | 'arrivedAtCustomer' | 'calledCustomer' | 'reportNoAnswer' | 'reportProblem' | 'rejectAssignment' | 'markDelivered'

export function driverAssignmentAction<T = unknown>(action: DriverAssignmentAction, input: Record<string, unknown> = {}, overrides?: Record<string, string>): Promise<RpcResult<T>> {
  return edgeAction<T>('driver-assignment-actions', { action, ...input }, overrides)
}
