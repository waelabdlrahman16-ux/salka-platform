// Single source of truth for translating internal status/enum values into
// Arabic for display. The values themselves (orders.status,
// delivery_assignments.status, drivers.status) stay in English in the
// database and code -- only what's actually shown to a person gets
// translated here. Falls back to the raw value if something new/unmapped
// ever shows up, rather than showing nothing.

// Mixed casing is inherited from the database and deliberately preserved --
// these are the literal values stored in orders.status.
export const ORDER_STATUSES = [
  // Ordered as the customer meets them. The four in the middle used to be one
  // undifferentiated 'pending', which is why a pharmacy order with no price and
  // no vendor showed "قيد التجهيز" next to an ETA: the lifecycle had no way to
  // say "waiting for a price", so it borrowed the label next door.
  'awaiting_payment', 'awaiting_quote', 'Scheduled', 'pending',
  'Driver_Searching', 'No_Driver_Found', 'Accepted', 'Picked_Up',
  'Out_for_Delivery', 'Delivered', 'Cancelled', 'Failed_Delivery',
] as const

/** In the dispatch window: placed, not yet with a driver. Mirrors the server's
 *  is_predispatch_status(). */
export const PREDISPATCH_ORDER_STATUSES: OrderStatus[] =
  ['pending', 'Scheduled', 'Driver_Searching', 'No_Driver_Found']
export type OrderStatus = typeof ORDER_STATUSES[number]

/**
 * Finished with: no further operational action is possible.
 *
 * Note that Failed_Delivery is deliberately NOT here. It is an end state for a
 * delivery *attempt*, but the order is still live and must be re-dispatchable --
 * treating it as terminal left failed deliveries invisible to every admin
 * surface that could have sent another driver.
 */
export const CLOSED_ORDER_STATUSES: OrderStatus[] = ['Delivered', 'Cancelled']

/** Not yet paid for, so must not enter the driver dispatch queue. */
export const UNPAID_ORDER_STATUSES: OrderStatus[] = ['awaiting_payment']

const ORDER_STATUS_AR: Record<string, string> = {
  pending: 'قيد الانتظار',
  awaiting_payment: 'بانتظار الدفع',
  awaiting_quote: 'بانتظار التسعير',
  Scheduled: 'محجوز لفترة لاحقة',
  Driver_Searching: 'بندوّر على مندوب',
  No_Driver_Found: 'محدش استلم الطلب',
  Accepted: 'تم تعيين مندوب',
  Picked_Up: 'تم الاستلام من المطعم',
  Out_for_Delivery: 'في الطريق إليك',
  Delivered: 'تم التوصيل',
  Cancelled: 'ملغي',
  Failed_Delivery: 'فشل التوصيل',
}

const ASSIGNMENT_STATUS_AR: Record<string, string> = {
  Offered: 'معروض على مندوب',
  Accepted: 'مقبول',
  Picked_Up: 'تم الاستلام',
  Out_for_Delivery: 'في التوصيل',
  Delivered: 'تم التسليم',
  Rejected: 'مرفوض',
  Cancelled: 'ملغي',
  Failed: 'فشل التوصيل',
}

const DRIVER_STATUS_AR: Record<string, string> = {
  Available: 'متاح',
  On_Delivery: 'في توصيل',
  Suspended: 'موقوف',
  Offline: 'غير متصل',
}

export const orderStatusLabel = (status: string) => ORDER_STATUS_AR[status] ?? status
export const assignmentStatusLabel = (status: string) => ASSIGNMENT_STATUS_AR[status] ?? status
export const driverStatusLabel = (status: string) => DRIVER_STATUS_AR[status] ?? status

/** Cancelled is the one status that changes what every screen should show, and
 *  it was being re-tested inline in Track and Admin. One home. */
export const isCancelled = (status: string) => status === 'Cancelled'

/**
 * cancel_reason is stored as a raw code — `customer_cancelled`,
 * `supervisor_unassigned` — and was rendered straight onto the admin card, in
 * English, inside an Arabic RTL interface. Falls back to the raw value so a new
 * code shows something rather than nothing.
 */
const CANCEL_REASON_AR: Record<string, string> = {
  customer_cancelled: 'العميل لغى الطلب',
  customer_waiting_too_long: 'العميل مقدرش يستنى أكتر',
  customer_price_too_high: 'السعر أعلى من المناسب للعميل',
  customer_payment_problem: 'العميل واجه مشكلة في الدفع',
  customer_ordered_by_mistake: 'الطلب اتعمل بالغلط',
  customer_changed_mind: 'العميل غيّر رأيه',
  customer_other: 'العميل لغى لسبب تاني',
  vendor_rejected: 'المطعم رفض',
  no_driver_found: 'مالقيناش مندوب',
  driver_failed: 'توصيل فاشل',
  admin_cancelled: 'الإدارة لغت الطلب',
  supervisor_cancelled: 'المشرف لغى الطلب',
  out_of_stock: 'الصنف مش متوفر',
}
export const cancelReasonLabel = (reason: string | null) =>
  !reason ? 'اتلغى' : (CANCEL_REASON_AR[reason] ?? reason)
