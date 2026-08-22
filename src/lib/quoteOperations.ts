import { edgeAction, type RpcResult } from './rpc'
import type { QuoteState } from './types'

export interface QuoteView {
  id: number
  version: number
  state: QuoteState
  expires_at: string
  subtotal: number
  delivery_fee: number
  service_fee: number
  promo_discount: number
  wallet_used: number
  total: number
  payment_method: string
  deposit_required: boolean
  deposit_amount: number
}

export interface QuotePreview {
  subtotal: number
  delivery_fee: number
  service_fee: number
  promo_discount: number
  wallet_used: number
  total: number
  payment_method: string
  deposit_required: boolean
  deposit_amount: number
}

export function previewQuote(orderId: number, subtotal: number): Promise<RpcResult<QuotePreview>> {
  return edgeAction<QuotePreview>('quote-operations', { action: 'preview', orderId, subtotal })
}

export function viewCurrentQuote(orderId: number, orderToken: string): Promise<RpcResult<QuoteView | null>> {
  return edgeAction<QuoteView | null>('quote-operations', {
    action: 'view', orderId, orderToken,
  })
}

/** Exact immutable offer, available only to the authenticated staff member
 * handling this order. This is intentionally not a direct table read. */
export function viewStaffQuote(orderId: number): Promise<RpcResult<QuoteView>> {
  return edgeAction<QuoteView>('quote-operations', { action: 'staffView', orderId })
}

export function issueQuote(orderId: number, subtotal: number): Promise<RpcResult<{ quote_id: number; version: number; state: 'offered' }>> {
  return edgeAction<{ quote_id: number; version: number; state: 'offered' }>('quote-operations', {
    action: 'issue', orderId, subtotal, idempotencyKey: crypto.randomUUID(),
  })
}

export function decideQuote(
  action: 'accept' | 'reject', orderId: number, quoteId: number, orderToken: string,
): Promise<RpcResult<{ state: string }>> {
  return edgeAction<{ state: string }>('quote-operations', {
    action, orderId, quoteId, orderToken, idempotencyKey: crypto.randomUUID(),
  })
}

/** Opens a fresh customer approval window without recalculating the quote. */
export function renewExpiredQuote(
  orderId: number, quoteId: number, orderToken: string,
): Promise<RpcResult<{ quote_id: number; version: number; state: 'offered'; expires_at: string }>> {
  return edgeAction('quote-operations', {
    action: 'renew', orderId, quoteId, orderToken, idempotencyKey: crypto.randomUUID(),
  })
}
