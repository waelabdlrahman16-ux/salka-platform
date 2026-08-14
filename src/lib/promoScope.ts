// Which part of the bill a promo code is allowed to discount.
//
// 'all' is not the same as 'vendor': it drains the service fee first, then the
// delivery fee, and only reaches the vendor's basket if the discount is larger
// than both. private.apply_order_promo enforces that order server-side; these
// labels only have to describe it honestly to the customer and the admin.
export type PromoScope = 'delivery' | 'service' | 'vendor' | 'all'

export const PROMO_SCOPES: PromoScope[] = ['delivery', 'service', 'vendor', 'all']

// Shown to the customer at checkout ("تم تطبيق الخصم على ...").
export const PROMO_SCOPE_LABEL: Record<PromoScope, string> = {
  delivery: 'رسوم التوصيل',
  service: 'رسوم الخدمة',
  vendor: 'قيمة الأصناف',
  all: 'الفاتورة',
}

// Longer, admin-facing wording: the operator needs to know who funds the code.
export const PROMO_SCOPE_ADMIN_LABEL: Record<PromoScope, string> = {
  delivery: 'رسوم التوصيل',
  service: 'رسوم الخدمة',
  vendor: 'قيمة الأصناف (على حساب المطعم)',
  all: 'الفاتورة كلها (الخدمة ثم التوصيل ثم الأصناف)',
}
