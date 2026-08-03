export interface Restaurant {
  id: number; name: string; description: string; category: string
  rating: number; delivery_time: string; is_open: boolean
  vendor_type: string; prep_minutes: number
  order_mode: 'catalog' | 'custom_request' | 'pickup_request'
  archived: boolean; logo_url: string | null; max_delivery_km: number | null
}
export interface MenuItem {
  id: number; restaurant_id: number; name: string; description: string
  category: string; price: number; available: boolean; requires_prescription: boolean
  image_url: string | null
  available_from: string | null; available_until: string | null
}
export interface MenuItemSize {
  id: number; menu_item_id: number; name: string; price: number
  is_default: boolean; display_order: number; available: boolean
}
export interface MenuItemAddonGroup {
  id: number; menu_item_id: number; name: string
  min_select: number; max_select: number | null; display_order: number
}
export interface MenuItemAddon {
  id: number; group_id: number; name: string; price: number
  display_order: number; available: boolean; image_url: string | null
}
export interface Discount {
  id: number; restaurant_id: number; scope: 'item' | 'category'
  menu_item_id: number | null; category: string | null
  discount_type: 'percent' | 'fixed'; value: number; active: boolean
  starts_at: string | null; ends_at: string | null
}
export interface RequestItem { name: string; qty: number }
export interface Order {
  id: number; restaurant_id: number
  customer_name: string; customer_phone: string
  zone: string; unit_number: string; address_notes: string; customer_note: string | null
  status: string; kitchen_status: string
  subtotal: number; delivery_fee: number; total: number
  payment_method: string; created_at: string
  ready_at: string | null; dispatch_at: string | null
  slot_id: number | null; scheduled_date: string | null
  order_type: 'catalog' | 'custom_request' | 'pickup_request'
  request_items: RequestItem[] | null
  request_notes: string | null
  pricing_status: 'n/a' | 'pending_quote' | 'confirmed'
  payment_mode: 'prepaid' | 'driver_pays' | null
  collect_amount: number | null
  instapay_claimed_at: string | null
  refund_status: 'pending' | 'refunded' | null
  delay_count: number
  cod_deposit_amount: number | null
  restaurants?: { name: string }
  compounds?: { name: string; latitude: number | null; longitude: number | null }
}
export interface OrderItem {
  id: number; order_id: number; menu_item_id: number
  name: string; qty: number; unit_price: number; total: number
  requires_prescription: boolean
  size_name: string | null; addon_names: string[] | null
  original_unit_price: number | null
}
export interface Driver {
  id: number; name: string; phone: string; status: string
  available: boolean; active: boolean
  vehicle_type: 'motorcycle' | 'van'; vehicle_plate: string
  rating: number; total_deliveries: number; commission_value: number
  cash_held: number; payout_schedule: 'daily' | 'weekly'
}
export interface Assignment {
  id: number; order_id: number; driver_id: number; attempt_number: number
  status: string; offered_at: string; responded_at: string | null
  picked_up_at: string | null; delivered_at: string | null
  rejection_reason: string
  out_for_delivery_at: string | null; arrived_at_restaurant_at: string | null
  called_customer_at: string | null; no_answer_reported_at: string | null
  no_answer_admin_action: string | null
  cash_confirmed_at: string | null
  orders?: Order
  drivers?: Driver
}
export interface Earning {
  id: number; driver_id: number; order_id: number; assignment_id: number
  delivery_fee: number; driver_earning: number; admin_amount: number
  created_at: string; paid: boolean
  disputed: boolean; dispute_note: string | null
  drivers?: { name: string }
}
export interface Zone { id: number; name: string }

export interface Slot {
  id: number; start_time: string; end_time: string
  capacity: number; remaining: number; scheduled_date: string
}
export interface Setting { key: string; value: string; label: string }

export interface Shift {
  id: number; driver_id: number; shift_date: string
  start_time: string; end_time: string; status: string
}
export interface SwapRequest {
  request_id: number; reason: string; created_at: string
  shift_id: number; shift_date: string; start_time: string; end_time: string
  requested_by_name: string
}

export interface DeliverySlotRow {
  id: number; restaurant_id: number
  start_time: string; end_time: string; capacity: number; active: boolean
}

export interface Compound {
  id: number; region_id: number; name: string
  distance_km: number; direction: 'north' | 'south'
  est_travel_minutes: number; active: boolean
  latitude: number | null; longitude: number | null
}
export interface Region { id: number; name: string }

export interface Complaint {
  id: number; order_id: number; description: string
  status: 'open' | 'reviewed' | 'resolved'; created_at: string
  category: 'missing_item' | 'wrong_item' | 'driver_conduct' | 'quality' | 'other'
  driver_id: number | null
  orders?: { customer_name: string; customer_phone: string; restaurants?: { name: string } }
  drivers?: { name: string }
}
export interface SettlementRequest {
  id: number; driver_id: number; status: string; created_at: string
  drivers?: { name: string }
}
export interface VendorCoverage { id: number; restaurant_id: number; compound_id: number }
export interface OrderRating {
  id: number; order_id: number; driver_rating: number | null; restaurant_rating: number | null
  created_at: string
  orders?: { customer_name: string; customer_phone: string; restaurants?: { name: string } }
}
export interface Reliability { avg_accept_minutes: number | null; slow_accepts: number; total_orders: number }
