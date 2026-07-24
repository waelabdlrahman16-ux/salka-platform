export interface Restaurant {
  id: number; name: string; description: string; category: string
  rating: number; delivery_time: string; is_open: boolean
}
export interface MenuItem {
  id: number; restaurant_id: number; name: string; description: string
  category: string; price: number; available: boolean
}
export interface Order {
  id: number; restaurant_id: number
  customer_name: string; customer_phone: string
  zone: string; unit_number: string; address_notes: string
  status: string; kitchen_status: string
  subtotal: number; delivery_fee: number; total: number
  payment_method: string; created_at: string
  restaurants?: { name: string }
}
export interface OrderItem {
  id: number; order_id: number; menu_item_id: number
  name: string; qty: number; unit_price: number; total: number
}
export interface Chalet {
  id: number; name: string; description: string; property_type: string
  price_per_night: number; bedrooms: number; guests: number; available: boolean
}
export interface Booking {
  id: number; chalet_id: number; customer_name: string; customer_phone: string
  check_in: string; check_out: string; guests: number; total: number
  status: string; created_at: string
  chalets?: { name: string }
}
export interface Driver {
  id: number; name: string; phone: string; status: string
  available: boolean; active: boolean
  vehicle_type: string; vehicle_plate: string
  rating: number; total_deliveries: number; commission_value: number
}
export interface Assignment {
  id: number; order_id: number; driver_id: number; attempt_number: number
  status: string; offered_at: string; responded_at: string | null
  picked_up_at: string | null; delivered_at: string | null
  rejection_reason: string
  orders?: Order
  drivers?: Driver
}
export interface Earning {
  id: number; driver_id: number; order_id: number; assignment_id: number
  delivery_fee: number; driver_earning: number; admin_amount: number
  created_at: string
  drivers?: { name: string }
}
export interface Zone { id: number; name: string }
