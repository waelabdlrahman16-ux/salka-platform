import { edgeAction,type RpcResult } from './rpc'
export type DispatchAction='assign'|'forceDelivered'|'markFailed'|'reassign'|'resolveNoAnswer'|'staffPickup'|'unassign'
export const dispatchOperation=<T=unknown>(action:DispatchAction,input:Record<string,unknown>,overrides?:Record<string,string>):Promise<RpcResult<T>>=>edgeAction<T>('dispatch-operations',{action,...input},overrides)
