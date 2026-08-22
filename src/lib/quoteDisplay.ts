import type { QuoteState } from './types'

export function quoteSummary(quoteState: QuoteState | null | undefined, pricingStatus: string | null | undefined, total: number) {
  if (quoteState === 'offered') return { text: 'السعر جاهز — راجعه', pending: true }
  if (quoteState === 'rejected') return { text: 'تم رفض السعر', pending: true }
  if (quoteState === 'expired') return { text: 'انتهت صلاحية السعر', pending: true }
  if (pricingStatus === 'pending_quote' || quoteState === 'pending') return { text: 'قيد التسعير', pending: true }
  return { text: `${total} ج.م`, pending: false }
}
