// Single source of truth for translating internal status/enum values into
// Arabic for display. The values themselves (orders.status,
// delivery_assignments.status, drivers.status) stay in English in the
// database and code -- only what's actually shown to a person gets
// translated here. Falls back to the raw value if something new/unmapped
// ever shows up, rather than showing nothing.

// Mixed casing is inherited from the database and deliberately preserved --
// these are the literal values stored in orders.status.
export const ORDER_STATUSES = [
  'pending', 'awaiting_payment', 'Accepted', 'Picked_Up',
  'Out_for_Delivery', 'Delivered', 'Cancelled', 'Failed_Delivery',
] as const
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
