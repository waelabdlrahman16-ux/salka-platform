// Which part of the bill a promo code is allowed to discount.
//
// 'all' is not the same as 'vendor': it drains the service fee first, then the
// delivery fee, and only reaches the vendor's basket if the discount is larger
// than both. 'platform' is the same waterfall capped at just those two fees --
// it can never reach the vendor's basket, however large the discount. private.
// apply_order_promo enforces both orderings server-side; these labels only
// have to describe them honestly to the customer and the admin.
export type PromoScope = 'delivery' | 'service' | 'vendor' | 'platform' | 'all'

export const PROMO_SCOPES: PromoScope[] = ['delivery', 'service', 'vendor', 'platform', 'all']

// Shown to the customer at checkout ("تم تطبيق الخصم على ...").
export const PROMO_SCOPE_LABEL: Record<PromoScope, string> = {
  delivery: 'رسوم التوصيل',
  service: 'رسوم الخدمة',
  vendor: 'قيمة الأصناف',
  platform: 'رسوم التوصيل والخدمة',
  all: 'الفاتورة',
}

// Longer, admin-facing wording: the operator needs to know who funds the code.
export const PROMO_SCOPE_ADMIN_LABEL: Record<PromoScope, string> = {
  delivery: 'رسوم التوصيل',
  service: 'رسوم الخدمة',
  vendor: 'قيمة الأصناف (على حساب المطعم)',
  platform: 'رسوم الخدمة والتوصيل فقط (الخدمة ثم التوصيل، ومايوصلش للأصناف أبدًا)',
  all: 'الفاتورة كلها (الخدمة ثم التوصيل ثم الأصناف)',
}
