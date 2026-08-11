import { edgeAction,type RpcResult } from './rpc'
import { observerBlocked } from './adminGuard'
export type DispatchAction='assign'|'forceDelivered'|'markFailed'|'reassign'|'resolveNoAnswer'|'staffPickup'|'unassign'
export const dispatchOperation=<T=unknown>(action:DispatchAction,input:Record<string,unknown>,overrides?:Record<string,string>):Promise<RpcResult<T>>=>{
  const blocked=observerBlocked<T>()
  if(blocked)return Promise.resolve(blocked)
  return edgeAction<T>('dispatch-operations',{action,...input},overrides)
}
