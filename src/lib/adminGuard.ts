import { getCachedRole } from './auth'
import type { RpcResult } from './rpc'

// Short-circuits an observer's write attempt before it reaches the network,
// so the failure reads as "view-only mode" rather than a raw admin_only
// exception. Not the security boundary -- every admin_* write function
// rejects on is_admin() regardless of this, since 'observer' is never
// 'admin'. This only makes the UX honest.
export function observerBlocked<T>(): RpcResult<T> | null {
  if (getCachedRole() !== 'observer') return null
  return { ok: false, code: 'observer_read_only', error: 'وضع المشاهدة فقط — التعديل مش متاح', offline: false }
}
