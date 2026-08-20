import { supabase } from './supabase'
import { PROMO_SCOPE_LABEL, type PromoScope } from './promoScope'

/**
 * What the checkout is allowed to offer a customer, and how to explain a code
 * that does not currently qualify.
 *
 * WHY THE SERVER DECIDES WHICH CODES ARE OFFERED. There are two live codes and
 * they are not the same kind of thing: SOKHNA30 is marketing, SORRY200 is an
 * apology handed to one wronged customer at a time. A screen that showed
 * "whatever is active" would hand 200 EGP to everybody. `featured_promos` only
 * returns codes an admin has ticked, so nothing reaches this file by accident.
 *
 * The DISCOUNT is quoted server-side too, by the same function checkout uses to
 * charge. The number on the card and the number taken off the bill come from
 * one place, so they cannot drift apart.
 */

export interface PromoQuote {
  valid: boolean
  discount?: number
  reason?: string
  minimum?: number
  applies_to?: PromoScope
}

export interface PromoOffer extends PromoQuote {
  code: string
}

/** The basket, as the server needs to see it to price a code against it. */
export interface PromoBasket {
  restaurantId: number | null
  compoundId: number | null
  subtotal: number
  deliveryFee: number | null
  serviceFee: number | null
}

/**
 * Codes this customer may be shown, already priced against this basket.
 * Returns [] on any failure -- a promo is an extra, and a checkout that cannot
 * reach the offers endpoint must still be able to take the order.
 */
export async function fetchPromoOffers(basket: PromoBasket): Promise<PromoOffer[]> {
  if (!basket.restaurantId) return []
  const { data, error } = await supabase.rpc('featured_promos', {
    p_restaurant_id: basket.restaurantId,
    p_compound_id: basket.compoundId,
    p_subtotal: basket.subtotal,
    p_delivery_fee: basket.deliveryFee ?? 0,
    p_service_fee: basket.serviceFee ?? 0,
  })
  if (error || !Array.isArray(data)) return []
  return data as PromoOffer[]
}

/**
 * Why a code did not apply, in words a customer can act on.
 *
 * `promo_minimum_not_met` names the number they have to reach, because "add
 * 50 EGP and you save 30" is worth more to both sides than "not eligible".
 */
export function promoReasonText(quote: PromoQuote | null | undefined): string {
  if (!quote || quote.valid) return ''
  const scope = PROMO_SCOPE_LABEL[quote.applies_to ?? 'all']
  switch (quote.reason) {
    case 'promo_expired': return 'الكود منتهي أو لسه ما بدأش'
    case 'promo_minimum_not_met': return `الحد الأدنى ${quote.minimum ?? ''} ج.م`
    case 'promo_not_available': return 'الكود مش متاح للمطعم أو المكان ده'
    case 'promo_nothing_to_discount': return `الكود ده بيخصم من ${scope}، ومفيش حاجة يخصم منها في الطلب ده`
    case 'promo_already_used': return 'استخدمت الكود ده قبل كده'
    case 'promo_limit_reached': return 'الكود خلص'
    default: return 'الكود غير صحيح أو غير متاح'
  }
}

/** «وفّرت ٣١ ج.م على رسوم التوصيل والخدمة» -- what the code actually did. */
export function promoAppliedText(quote: PromoQuote): string {
  const scope = PROMO_SCOPE_LABEL[quote.applies_to ?? 'all']
  return `وفّرت ${quote.discount ?? 0} ج.م على ${scope}`
}
