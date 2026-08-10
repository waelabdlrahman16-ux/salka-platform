import { edgeAction, type RpcResult } from './rpc'

export type DriverSelfServiceAction = 'setAvailable' | 'claimDevice' | 'savePushToken' | 'updateLocation' | 'clearLocation' | 'myStats' | 'availableOrders'

export function driverSelfService<T = unknown>(action: DriverSelfServiceAction, input: Record<string, unknown> = {}, overrides?: Record<string, string>): Promise<RpcResult<T>> {
  return edgeAction<T>('driver-self-service', { action, ...input }, overrides)
}
