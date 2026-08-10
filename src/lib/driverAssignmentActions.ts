import { edgeAction, type RpcResult } from './rpc'

export type DriverAssignmentAction = 'claimOrder' | 'acceptAssignment' | 'arrivedAtRestaurant' | 'markPickedUp' | 'markOutForDelivery' | 'confirmCashReceived' | 'arrivedAtCustomer' | 'calledCustomer' | 'reportNoAnswer' | 'reportProblem' | 'rejectAssignment' | 'markDelivered'

// Drivers act on cellular data in tunnels, basements and lifts, so a tap here
// dropping for a signal blip was previously a dead end -- the button just
// failed and the driver had to notice and tap again. Safe to auto-retry: every
// action in this set is a guarded status transition (wrong_stage,
// already_taken, not_your_assignment, ...), so if the first attempt actually
// reached the server and only its response was lost, the retry gets a
// harmless rejection back instead of duplicating an effect.
export function driverAssignmentAction<T = unknown>(action: DriverAssignmentAction, input: Record<string, unknown> = {}, overrides?: Record<string, string>): Promise<RpcResult<T>> {
  return edgeAction<T>('driver-assignment-actions', { action, ...input }, overrides, 2)
}
