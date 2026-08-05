// Salka does not only deliver from restaurants.
//
// The word "المطعم" was hardcoded into every screen that mentions where an
// order comes from, because restaurants were the only vendor when those screens
// were written. Pharmacies and supermarkets came later and inherited the copy.
// So a driver dispatched to صيدلية is told "📍 وصلت المطعم" and "استلمت الطلب
// من المطعم", and a customer waiting on medicine reads "المطعم أكّد الطلب".
//
// It reads as a bug to a customer and it reads as carelessness to a driver
// standing outside a pharmacy. One helper, used everywhere a vendor is named.

export type VendorType = 'restaurant' | 'pharmacy' | 'supermarket' | string | null | undefined

/** With the definite article: "وصلت **الصيدلية**". */
export function vendorNoun(type: VendorType): string {
  switch (type) {
    case 'pharmacy': return 'الصيدلية'
    case 'supermarket': return 'الماركت'
    default: return 'المطعم'
  }
}

/** Without the article, for "من **صيدلية**" style phrasing. */
export function vendorNounBare(type: VendorType): string {
  switch (type) {
    case 'pharmacy': return 'صيدلية'
    case 'supermarket': return 'ماركت'
    default: return 'مطعم'
  }
}

/**
 * What the vendor is *doing* to the order while the customer waits.
 *
 * "بيتحضر" is right for a kitchen and wrong for a supermarket, where nothing is
 * cooked -- the order is being picked off shelves. Small, but it is the line a
 * customer stares at for twenty minutes.
 */
export function vendorPreparingVerb(type: VendorType): string {
  switch (type) {
    case 'pharmacy': return 'بيجهزوا الطلب'
    case 'supermarket': return 'بيجمعوا الطلب'
    default: return 'بيحضّروا الطلب'
  }
}
