export interface Restaurant {
  id: number; name: string; description: string; category: string
  // `delivery_time` was dropped: a hand-typed string («١٠-١٥ دقيقة») that
  // disagreed with the SLA the server actually computes and stores. Use the
  // quote's sla_minutes / sla_max_minutes, never a second copy.
  rating: number
  /** Computed by vendor_is_open_now() when the row came from an RPC; the raw
   *  column otherwise. Never write to it -- the toggle is vendor_set_open(). */
  is_open: boolean
  /** Temporary close set by the vendor; expires on its own. */
  closed_until?: string | null
  /** Explicit position in the customer list, set by the admin. NULL = unranked.
   *  Lower shows first. A closed vendor still sinks below every open one. */
  display_order?: number | null
  /** Lifted above unranked vendors without a specific position. ORDERING ONLY --
   *  nothing is shown to the customer. A «مميز» chip was rendered both ways and
   *  deliberately not shipped: a badge that only says "we chose this" reads as a
   *  paid advert and makes the rest of the list read as "not chosen". */
  featured?: boolean
  /** When it opens next, from vendor_next_open_at(). Null when already open. */
  next_open_at?: string | null
  /** Hidden markup folded into every menu price via admin_set_restaurant_service_fee
   *  (base_price * (1 + service_fee_pct), rounded). 0 = no fee. Never shown to the
   *  customer as a separate line item -- that's the whole point of baking it into
   *  the price instead of a checkout fee row. */
  service_fee_pct?: number
  vendor_type: string; prep_minutes: number
  /** Whether this vendor delivers in fixed time windows instead of as soon as
   *  the order is ready. The scheduling UI reads THIS, never vendor_type: the
   *  supermarket was the only slotted vendor, so `vendor_type === 'supermarket'`
   *  was hardcoded in three places and the toggle admin_set_vendor_slots writes
   *  had no effect on the customer. Absent from rows fetched by an RPC that does
   *  not select it, so treat undefined as false. */
  uses_delivery_slots?: boolean
  order_mode: 'catalog' | 'custom_request' | 'pickup_request'
  archived: boolean; logo_url: string | null; max_delivery_km: number | null
  // Supplied by restaurants_for_compound() and restaurant_public(). `rating` is
  // a HAND-TYPED column with no link to order_ratings -- 8 of 9 vendors have
  // never been rated and every one of them carries a number -- so nothing may
  // render a score without checking this count first.
  review_count?: number
  /** The real average of submitted ratings. Null when nobody has rated. */
  rating_real?: number | null
  /** Cover photo chosen in the admin. Overrides hero_image_url. */
  cover_image_url?: string | null
  /** What the home card actually renders: cover_image_url, else the
   *  best-ranked photographed menu item. Computed by restaurants_for_compound(). */
  hero_image_url?: string | null
}
export interface MenuItem {
  id: number; restaurant_id: number; name: string; description: string
  category: string; price: number; available: boolean; requires_prescription: boolean
  image_url: string | null
  available_from: string | null; available_until: string | null
  /** Wording for the "make it a combo" toggle. Null falls back to a default. */
  combo_label: string | null
  // True = a browsing heading ("بقالة", "أدوية بروشتة"), never orderable and
  // never searchable. The pharmacy/market catalogue mixes headings and real
  // products in one table; before this column the client guessed with
  // `name !== category`, which still let "أدوية بروشتة" onto real orders.
  is_shelf_label?: boolean
}
export interface MenuItemSize {
  id: number; menu_item_id: number; name: string; price: number
  is_default: boolean; display_order: number; available: boolean
}
/**
 * A combo upgrade: sandwich + fries + drink at ONE replacement price, not a
 * surcharge on the sandwich. The rows are the sizes (عادي / وسط / كبير), which
 * is why they carry a full price and why choosing one is required as soon as
 * the customer turns the combo on.
 */
export interface MenuItemCombo {
  id: number; menu_item_id: number; name: string; price: number
  display_order: number; available: boolean
}
/** A reusable add-on definition, per vendor. Attaching it to an item copies it. */
export interface VendorAddonLibraryItem {
  id: number; restaurant_id: number; name: string; price: number
  image_url: string | null; created_at: string
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
  kitchen_id: number | null; pickup_location_name: string | null; pickup_location_address: string | null
  /**
   * Written by a database trigger from the vendor's own is_test flag, so every
   * order on the test restaurant carries it and no order-creating path can
   * forget to set it. A test order never touches driver cash, earnings or the
   * lifetime delivery counter.
   */
  is_test?: boolean
  customer_name: string; customer_phone: string
  zone: string; unit_number: string; address_notes: string; customer_note: string | null
  status: string; kitchen_status: string
  subtotal: number; delivery_fee: number; total: number
  // Present on every row in the database and used all over Admin, but never
  // declared -- so every read of them was a type error waiting to be written.
  service_fee: number | null; wallet_used: number | null
  sla_minutes: number | null
  cancel_reason: string | null; cancelled_at: string | null
  payment_method: string; created_at: string
  ready_at: string | null; dispatch_at: string | null
  slot_id: number | null; scheduled_date: string | null
  order_type: 'catalog' | 'custom_request' | 'pickup_request'
  request_items: RequestItem[] | null
  request_notes: string | null
  prescription_path?: string | null
  pricing_status: 'n/a' | 'pending_quote' | 'confirmed'
  payment_mode: 'prepaid' | 'driver_pays' | null
  collect_amount: number | null
  instapay_claimed_at: string | null
  refund_status: 'pending' | 'refunded' | null
  delay_count: number
  cod_deposit_amount: number | null
  // vendor_type is optional because not every query embedding the vendor asks
  // for it. Any screen that NAMES the vendor in copy ("وصلت الصيدلية") has to
  // select it -- see lib/vendorWords.ts for why hardcoding "المطعم" was wrong.
  restaurants?: { name: string; vendor_type?: string | null }
  compounds?: { name: string; latitude: number | null; longitude: number | null }
}
export interface OrderItem {
  id: number; order_id: number; menu_item_id: number
  name: string; qty: number; unit_price: number; total: number
  requires_prescription: boolean
  size_name: string | null; combo_name: string | null; addon_names: string[] | null
  original_unit_price: number | null
}
export interface Driver {
  id: number; name: string; phone: string; status: string
  available: boolean; active: boolean
  vehicle_type: 'motorcycle' | 'van'; vehicle_plate: string
  rating: number; total_deliveries: number; commission_value: number
  cash_held: number; payout_schedule: 'daily' | 'weekly'
  instapay_number: string | null
  // One phone per driver account -- see supabase driver_claim_device(). Null
  // means unbound, so the next phone to open the account claims it.
  device_id?: string | null
  device_label?: string | null
  device_bound_at?: string | null
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
  arrived_at_customer_at: string | null
  delivery_problem_reason: string | null
  orders?: Order
  drivers?: Driver
}
// One row of admin_live_deliveries(). The RPC exists because the dispatch board
// needs three things PostgREST cannot give it in one shot: the order's line
// items (which live in order_items for a catalogue order but on the order row
// itself for a pharmacy or market basket), the destination coordinates (on the
// compound, two joins away), and the age of the driver's last fix computed
// against the SERVER's clock rather than the operator's laptop clock.
export interface LiveDeliveryItem {
  name: string; qty: number; total: number
  size_name: string | null; combo_name: string | null; addon_names: string[] | null
}
export interface LiveDelivery {
  assignment_id: number; assignment_status: string; attempt_number: number
  picked_up_at: string | null; out_for_delivery_at: string | null
  arrived_at_customer_at: string | null
  order_id: number; order_status: string; kitchen_status: string
  customer_name: string; customer_phone: string
  zone: string; unit_number: string; address_notes: string | null
  total: number; payment_method: string | null; cod_deposit_amount: number | null
  order_type: Order['order_type']
  request_items: RequestItem[] | null; request_notes: string | null
  created_at: string
  vendor_name: string | null
  driver_id: number | null; driver_name: string | null; driver_phone: string | null
  driver_lat: number | null; driver_lng: number | null
  driver_seen_at: string | null
  // Null when the driver has never reported, which is not the same as zero.
  driver_seen_seconds_ago: number | null
  dest_lat: number | null; dest_lng: number | null
  items: LiveDeliveryItem[]
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
  est_travel_minutes: number
  /** Real customer-facing range, not a single promised number -- a fixed
   *  minute count reads as precise but breaks the moment traffic, prep, or a
   *  slow checkpoint entry pushes past it. est_travel_minutes above is kept
   *  as the midpoint for the handful of places (compound picker dropdowns)
   *  that just need a compact single figure, not a promise. */
  est_travel_minutes_min: number; est_travel_minutes_max: number
  active: boolean
  latitude: number | null; longitude: number | null
  // Delivery is priced per compound, not per kilometre. distance_km survives
  // only because the SLA is still derived from it.
  delivery_fee: number
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
