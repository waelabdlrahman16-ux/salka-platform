import { supabase } from './supabase'

// Roughly forty call sites across the app called supabase.rpc(...) and either
// destructured only `data` or discarded `error` entirely -- then set a success
// flag regardless. A failed rating, tip, complaint or InstaPay claim reported
// "sent" to the customer; a failed admin write repainted with server state and
// looked like it had worked. Those that did handle errors each re-implemented
// their own chain of `message.includes(...)`, so any unmapped code leaked raw
// English snake_case into an Arabic RTL interface.
//
// rpc() returns a discriminated result, so ignoring the failure path is a type
// error rather than a silent bug, and error copy comes from one shared map.

export type RpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; error: string; offline: boolean }

const GENERIC_AR = 'حصل خطأ، جرب تاني'
const OFFLINE_AR = 'مفيش اتصال بالنت — اتأكد من الشبكة وجرب تاني'

// Server-side codes are raised as bare identifiers by the SQL functions
// (`raise exception 'slot_full'`), so we match on substring.
export const ERROR_AR: Record<string, string> = {
  // ordering
  restaurant_closed: 'المطعم قفل قبل ما تأكد الطلب، جرب تاني بعدين',
  vendor_not_covering_compound: 'المطعم ده مش بيوصل لمنطقتك للأسف',
  item_not_available_now: 'في صنف في عربتك مش متاح دلوقتي (وقت محدود)، شيله وجرب تاني',
  item_unavailable: 'في صنف في عربتك خلص، شيله وجرب تاني',
  menu_item_not_found: 'في صنف في عربتك مابقاش موجود، شيله وجرب تاني',
  size_required: 'اختار حجم الصنف قبل ما تكمل',
  invalid_size: 'اختار حجم الصنف قبل ما تكمل',
  addon_group_min_not_met: 'في اختيار مطلوب لصنف في عربتك لسه ما اتحددش',
  addon_group_max_exceeded: 'اخترت إضافات أكتر من المسموح لصنف في عربتك',
  empty_order: 'عربتك فاضية',
  invalid_item: 'في صنف في عربتك فيه مشكلة، شيله وجرب تاني',
  missing_customer_details: 'كمّل بياناتك الأول',
  invalid_payment_method: 'طريقة الدفع دي مش متاحة',
  login_required: 'لازم تسجل دخولك الأول',
  compound_id_required: 'اختار مكانك الأول',
  compound_missing_distance: 'المكان ده لسه مش مظبوط عندنا، كلّمنا لو سمحت',
  compound_missing_fee: 'المكان ده لسه مش متسعّر عندنا، كلّمنا لو سمحت',
  slot_full: 'الفترة دي اتملت، اختار فترة تانية',
  slot_unavailable: 'الفترة دي مابقتش متاحة، اختار فترة تانية',

  // order lifecycle
  order_not_found: 'الطلب ده مش موجود',
  not_authorized: 'مش مسموح بالعملية دي',
  too_late_to_cancel: 'الطلب بدأ تجهيزه بالفعل، محدش يقدر يلغيه غير الإدارة',
  order_not_delivered: 'الطلب لسه ما اتسلّمش',
  order_closed: 'الطلب ده خلص أو اتلغى قبل كده',
  order_not_priced: 'الطلب لسه محتاج تسعير قبل ما يتعيّن لمندوب',

  // dispatch / driver
  already_taken: 'الطلب اتاخد من مندوب تاني',
  wrong_vehicle_type: 'الطلب ده محتاج فان',
  not_ready_yet: 'الطلب لسه بيتحضر، استنى شوية',
  dispatch_rule_blocked: 'وصلت للحد الأقصى (٣ طلبات) أو الطلب ده في اتجاه مختلف عن طلباتك الحالية',
  order_not_ready: 'الطلب لسه بيتحضر — استنى لحد ما المطعم يخليه جاهز',
  must_arrive_first: 'لازم تسجل إنك وصلت المطعم الأول',
  must_confirm_cash_first: 'أكد إنك استلمت الكاش الأول',
  must_call_customer_first: 'لازم تتصل بالعميل الأول',
  too_early: 'لسه بدري، استنى 5 دقايق من وقت خروجك للتوصيل',
  not_your_assignment: 'الطلب ده مش متعيّن ليك',
  already_assigned: 'الطلب ده معروض على مندوب بالفعل — اسحبه الأول لو عايز تغيّره',
  driver_already_declined: 'المندوب ده رفض الطلب ده قبل كده',
  too_many_attempts: 'الطلب ده اتعرض 5 مرات — راجع السبب قبل ما تعرضه تاني',
  no_active_assignment: 'الطلب ده مش مع مندوب دلوقتي',
  driver_not_found: 'المندوب ده مش موجود',
  driver_suspended: 'المندوب ده موقوف',
  not_your_order: 'الطلب ده مش بتاع مطعمك',
  wrong_stage: 'الخطوة دي مش دورها دلوقتي',
  not_a_driver: 'حسابك مش مربوط بمندوب',
  unavailable: 'حد تاني سبقك',

  // tips / feedback
  invalid_amount: 'المبلغ مش مظبوط',
  invalid_fee: 'الرسوم لازم تكون رقم موجب',
  fee_too_large: 'الرقم ده كبير أوي — أقصى رسوم توصيل 2000 ج.م',
  compound_not_found: 'المكان ده مش موجود',
  admin_only: 'العملية دي للإدارة بس',
  no_driver_on_this_order: 'مفيش مندوب متسجل على الطلب ده',

  // account
  not_logged_in: 'لازم تسجل دخولك الأول',
  invalid_phone: 'رقم الموبايل مش مظبوط',
  phone_already_registered: 'الرقم ده مسجل على حساب تاني',
  rate_limited: 'حاولت كتير — البحث بالرقم مسموح 3 مرات كل 10 دقايق. سجّل دخولك بجوجل أو الإيميل وهتشوف طلباتك من غير أي حد.',
}

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

// postgrest-js does NOT reject on a failed fetch -- it resolves with
// { error: { message: "TypeError: Failed to fetch", code: '' }, status: 0 }.
// And navigator.onLine is useless here: in a Capacitor WKWebView it is
// effectively always true, and on Android it stays true whenever a radio is
// attached even if no data is passing (lift, basement, tunnel). So transport
// failure has to be recognised from the message itself.
const TRANSPORT_HINTS = [
  'failed to fetch', 'networkerror', 'network request failed',
  'load failed', 'fetch', 'timeout', 'aborted', 'err_internet',
]

export function isTransportFailure(message?: string | null, status?: number): boolean {
  if (status === 0) return true
  if (isOffline()) return true
  if (!message) return false
  const m = message.toLowerCase()
  return TRANSPORT_HINTS.some(h => m.includes(h))
}

export function extractCode(message?: string | null): string {
  if (!message) return 'unknown'
  // Longest match wins. Several codes contain a shorter one as a substring
  // (`item_unavailable` / `slot_unavailable` both contain `unavailable`), so a
  // first-match scan is silently dependent on key insertion order -- sorting
  // ERROR_AR alphabetically would have started reporting "حد تاني سبقك" for an
  // out-of-stock item.
  let best = ''
  for (const code of Object.keys(ERROR_AR)) {
    if (message.includes(code) && code.length > best.length) best = code
  }
  return best || 'unknown'
}

/** Arabic copy for a server error. `overrides` lets a screen reword one code. */
export function describeError(message?: string | null, overrides?: Record<string, string>): string {
  if (isOffline()) return OFFLINE_AR
  const code = extractCode(message)
  return overrides?.[code] ?? ERROR_AR[code] ?? GENERIC_AR
}

export async function rpc<T = unknown>(
  name: string,
  args?: Record<string, unknown>,
  overrides?: Record<string, string>
): Promise<RpcResult<T>> {
  try {
    const { data, error, status } = await supabase.rpc(name, args)
    if (error) {
      const transport = isTransportFailure(error.message, status)
      return {
        ok: false,
        code: transport ? 'network' : extractCode(error.message),
        error: transport ? OFFLINE_AR : describeError(error.message, overrides),
        offline: transport,
      }
    }
    return { ok: true, data: data as T }
  } catch {
    // supabase-js normally surfaces transport failures via `error`, but a hard
    // network drop can reject instead. Treat it as offline rather than generic.
    return { ok: false, code: 'network', error: OFFLINE_AR, offline: true }
  }
}
