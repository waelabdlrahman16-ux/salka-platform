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
const OFFLINE_AR = 'مفيش اتصال بالنت. اتأكد من الشبكة وجرب تاني'

// Server-side codes are raised as bare identifiers by the SQL functions
// (`raise exception 'slot_full'`), so we match on substring.
export const ERROR_AR: Record<string, string> = {
  // ordering
  restaurant_closed: 'المكان ده قفل قبل ما تأكد الطلب، جرب تاني بعدين',
  vendor_not_covering_compound: 'المكان ده مش بيوصل لمنطقتك للأسف',
  item_not_available_now: 'في صنف في عربتك مش متاح دلوقتي (وقت محدود)، شيله وجرب تاني',
  item_unavailable: 'في صنف في عربتك خلص، شيله وجرب تاني',
  menu_item_not_found: 'في صنف في عربتك مابقاش موجود، شيله وجرب تاني',
  size_required: 'اختار حجم الصنف قبل ما تكمل',
  invalid_size: 'اختار حجم الصنف قبل ما تكمل',
  invalid_combo: 'فيه كومبو في عربتك مابقاش متاح. امسح الصنف وضيفه تاني',
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
  order_rate_limit: 'عملت طلبات كتير بسرعة. استنى شوية وجرب تاني',
  daily_order_limit: 'وصلت للحد اليومي للطلبات. كلّمنا عشان نساعدك',
  not_your_restaurant: 'مش مسموح تعمل طلب مندوب للمطعم ده',
  invalid_customer_input: 'راجع بيانات الاسم والموبايل والعنوان وجرب تاني',
  invalid_order_input: 'راجع تفاصيل الطلب وجرب تاني',
  order_creation_failed: 'مقدرناش نسجل الطلب. جرب تاني أو كلّمنا',
  invalid_push_input: 'بيانات التنبيهات مش مظبوطة. حاول تفعّلها تاني',
  invalid_rating_input: 'راجع التقييم وجرب تاني',
  invalid_complaint_input: 'اكتب تفاصيل المشكلة من ٥ حروف على الأقل',
  complaint_limit_reached: 'وصلت للحد اليومي للشكاوى على الطلب ده',
  complaint_too_short: 'اكتب تفاصيل أكتر عن المشكلة',
  complaint_too_long: 'تفاصيل المشكلة طويلة أوي',
  rating_required: 'اختار تقييم الأول',
  invalid_driver_rating: 'تقييم المندوب لازم يكون من ١ إلى ٥',
  invalid_restaurant_rating: 'تقييم المكان لازم يكون من ١ إلى ٥',
  rating_already_submitted: 'تم إرسال تقييم للطلب ده بالفعل',
  rating_window_closed: 'فترة تقييم الطلب انتهت',
  customer_order_access_failed: 'مقدرناش نحدّث الطلب. جرب تاني',
  invalid_financial_input: 'راجع المبلغ والبيانات وجرب تاني',
  financial_action_failed: 'العملية المالية متنفذتش. جرب تاني أو راجع السجل',
  invalid_account_input: 'راجع بيانات الحساب أو المندوب وجرب تاني',
  account_action_failed: 'العملية متنفذتش. جرب تاني أو راجع السجل',
  invalid_dispatch_input: 'راجع بيانات الطلب أو المندوب وجرب تاني',
  dispatch_action_failed: 'تحديث التوصيل متنفذش. جرب تاني أو راجع السجل',
  invalid_vendor_input: 'راجع بيانات الطلب أو المكان وجرب تاني',
  vendor_action_failed: 'تحديث المكان متنفذش. جرب تاني أو راجع السجل',
  cannot_delete_self: 'مينفعش تلغي حسابك انت',
  cannot_delete_admin: 'مينفعش تلغي حساب إدارة من هنا',
  cannot_target_self: 'مينفعش تغيّر صلاحية حسابك انت',
  profile_not_found: 'الحساب ده مش موجود. حدّث الصفحة',
  target_not_convertible: 'الحساب ده مينفعش يتحول للدور ده',
  invalid_role: 'نوع الحساب المطلوب مش صحيح',
  phone_already_used: 'الرقم ده مستخدم لمندوب تاني',
  name_required: 'اكتب اسم المندوب',
  phone_required: 'اكتب رقم الموبايل',
  invalid_vehicle_type: 'النوع لازم يكون موتوسيكل أو فان',
  invalid_payout_schedule: 'ميعاد صرف الأرباح مش صحيح',

  // admin panel -- catalog / compound / reports
  category_exists: 'في قسم بالاسم ده بالفعل',
  category_not_empty: 'فيه أصناف لسه في القسم ده. انقلهم أو احذفهم الأول',
  item_has_order_history: 'الصنف ده اتباع قبل كده، مينفعش يتمسح',
  library_item_exists: 'الإضافة دي موجودة بالفعل في المكتبة',
  library_item_not_found: 'الإضافة دي مش موجودة. حدّث الصفحة',
  invalid_price: 'السعر لازم يكون صفر أو أكبر',
  complaint_not_found: 'الشكوى دي مش موجودة',
  no_driver_on_this_complaint: 'مفيش مندوب متسجل على الشكوى دي',
  rank_must_be_positive: 'المركز لازم يكون ١ أو أكبر',
  restaurant_not_found: 'المطعم ده مش موجود',
  invalid_day: 'يوم الأسبوع مش مظبوط',
  hours_incomplete: 'لازم تحدد الفتح والقفل مع بعض',
  delivery_fee_required: 'لازم تحدد رسوم توصيل أكبر من صفر',
  region_not_found: 'المنطقة دي مش موجودة',
  invalid_direction: 'الاتجاه المطلوب مش صحيح',

  // order lifecycle
  order_not_found: 'الطلب ده مش موجود',
  not_authorized: 'مش مسموح بالعملية دي',
  too_late_to_cancel: 'الطلب بدأ تجهيزه بالفعل، محدش يقدر يلغيه غير الإدارة',
  order_not_delivered: 'الطلب لسه ما اتسلّمش',
  order_closed: 'الطلب ده خلص أو اتلغى قبل كده',
  order_not_priced: 'الطلب لسه محتاج تسعير قبل ما يتعيّن لمندوب',
  invalid_items: 'الأصناف المضافة مش مظبوطة. راجعها وجرب تاني',
  invalid_item_count: 'ضيف من صنف واحد لحد 20 صنف في المرة',
  too_many_order_items: 'الطلب وصل للحد الأقصى من الأصناف',
  invalid_merged_item: 'في صنف بعد الإضافة كميته مش مظبوطة',
  order_edit_rate_limit: 'حاولت تضيف أصناف كتير. استنى شوية وجرب تاني',
  daily_order_edit_limit: 'وصلت للحد اليومي لإضافة الأصناف. كلّمنا عشان نساعدك',
  order_edit_failed: 'مقدرناش نضيف الصنف. جرب تاني أو كلّمنا',

  // dispatch / driver
  already_taken: 'الطلب اتاخد من مندوب تاني',
  wrong_vehicle_type: 'الطلب ده محتاج فان',
  not_ready_yet: 'الطلب لسه بيتحضر، استنى شوية',
  dispatch_rule_blocked: 'وصلت للحد الأقصى (٤ طلبات) أو الطلب ده في اتجاه مختلف عن طلباتك الحالية',
  order_not_ready: 'الطلب لسه بيتحضر. استنى لحد ما المطعم يخليه جاهز',
  must_arrive_first: 'لازم تسجل إنك وصلت المطعم الأول',
  must_confirm_cash_first: 'أكد إنك استلمت الكاش الأول',
  must_call_customer_first: 'لازم تتصل بالعميل الأول',
  too_early: 'لسه بدري، استنى 5 دقايق من وقت خروجك للتوصيل',
  not_your_assignment: 'الطلب ده مش متعيّن ليك',
  already_assigned: 'الطلب ده معروض على مندوب بالفعل. اسحبه الأول لو عايز تغيّره',
  // These two carry a value after a colon (driver_holds_cash:270.00). Registered
  // by their bare prefix so extractCode's substring match still resolves them --
  // without an entry here they fall through to 'unknown' and the call site's
  // override never fires, which is exactly how payment_already_claimed was
  // silently generic before.
  driver_holds_cash: 'المندوب ده لسه ماسك كاش. سوّي الكاش الأول',
  customer_has_wallet_balance: 'العميل ده لسه معاه رصيد في المحفظة',
  customer_has_live_order: 'العميل ده عنده طلب شغال دلوقتي',
  no_account_for_phone: 'الرقم ده مالوش حساب مسجّل، ده سجل طلبات بس',
  driver_already_declined: 'المندوب ده رفض الطلب ده قبل كده',
  too_many_attempts: 'الطلب ده اتعرض 5 مرات. راجع السبب قبل ما تعرضه تاني',
  no_active_assignment: 'الطلب ده مش مع مندوب دلوقتي',
  driver_not_found: 'المندوب ده مش موجود',
  driver_suspended: 'المندوب ده موقوف',
  not_your_order: 'الطلب ده مش بتاع مطعمك',
  wrong_stage: 'الخطوة دي مش دورها دلوقتي',
  not_a_driver: 'حسابك مش مربوط بمندوب',
  device_locked: 'الحساب ده مربوط بموبايل تاني. كلّم الإدارة عشان يفكّوا الربط',
  invalid_device: 'مش قادرين نتعرف على الجهاز ده',
  unavailable: 'حد تاني سبقك',

  // Admin audit and cleanup
  audit_mark_too_late: 'الطلب اتأثر بالفعل بتوصيل أو حسابات، ومينفعش يتحول لتجربة',
  test_order_required: 'الحذف النهائي متاح للطلبات المعلّمة كتجربة فقط',
  test_order_has_financial_or_customer_history: 'الطلب ده له حركة مالية أو سجل عميل، فمينفعش يتحذف نهائياً. استخدم الأرشفة',
  order_not_closed: 'الأرشفة متاحة بعد التسليم أو الإلغاء فقط',

  // tips / feedback
  invalid_amount: 'المبلغ مش مظبوط',
  invalid_fee: 'الرسوم لازم تكون رقم موجب',
  fee_too_large: 'الرقم ده كبير أوي، أقصى رسوم توصيل 2000 ج.م',
  compound_not_found: 'المكان ده مش موجود',
  admin_only: 'العملية دي للإدارة بس',
  // A banned customer is told the account is blocked and given a way to argue,
  // not a generic failure they will retry ten times.
  account_blocked: 'الحساب ده متوقف عن الطلب. كلّم الإدارة لو في مشكلة',
  has_live_orders: 'العميل ده عنده طلب شغال دلوقتي. اقفله الأول قبل ما توقفه',
  no_driver_on_this_order: 'مفيش مندوب متسجل على الطلب ده',
  driver_instapay_unavailable: 'المندوب مش مسجل رقم إنستاباي. كلّمه أو اختار طريقة تانية',

  // Payment-method switching (switch_to_cash). These MUST live here, not only
  // in a call-site `overrides` map: describeError() resolves a code by matching
  // ERROR_AR's own keys against the server message, so a code absent from this
  // map resolves to 'unknown' and the override -- which is keyed by the
  // resolved code -- never fires. Caught in review: both of these were silently
  // falling through to "حصل خطأ، جرب تاني", including the one that fires when
  // someone has already told us they transferred the money.
  payment_already_claimed: 'قلت لنا إنك حوّلت بالفعل. استنى المراجعة، ولو في مشكلة كلّمنا',
  already_cash: 'الطلب ده أصلاً كاش عند الاستلام',
  order_not_awaiting_payment: 'الطلب مش مستني دفع دلوقتي',
  rate_limit_check_failed: 'حصل عطل مؤقت. جرب تاني بعد شوية',
  payment_action_failed: 'العملية متنفذتش. جرب تاني أو كلّمنا',

  // account
  not_logged_in: 'لازم تسجل دخولك الأول',
  invalid_phone: 'رقم الموبايل مش مظبوط',
  phone_already_registered: 'الرقم ده مسجل على حساب تاني',
  rate_limited: 'حاولت كتير، البحث بالرقم مسموح 5 مرات كل 10 دقايق. سجّل دخولك وهتشوف طلباتك من غير أي حد.',

  // driver assignment lifecycle (batch 9)
  not_your_pool: 'الطلب ده مش من نوع الطلبات اللي بتاخدها',
  kitchen_not_accepted_yet: 'المطعم لسه ما قبلش الطلب',
  reason_required: 'اكتب سبب المشكلة',
  // Wallet credits. duplicate_credit is raised by credit_wallet when the same
  // wallet, amount and reason arrive inside two minutes -- a repeat, not a
  // decision. Without an entry here extractCode() returns 'unknown' and the
  // operator gets the generic message, which is what made every promo failure
  // unreadable before PR #133.
  duplicate_credit: 'الرصيد ده اتضاف للعميل ده من دقيقتين. لو ده مقصود، غيّر السبب أو استنى شوية',
  invalid_credit_amount: 'اكتب مبلغ صحيح أكبر من صفر',
  reason_too_long: 'السبب طويل أوي، اختصره',
  invalid_assignment_input: 'راجع بيانات الطلب أو المندوب وجرب تاني',
  assignment_action_failed: 'تحديث الطلب متنفذش. جرب تاني أو راجع السجل',

  // driver self-service (batch 9)
  invalid_state: 'الحالة المطلوبة مش صحيحة',
  not_authenticated: 'لازم تسجل دخولك الأول',
  bad_platform: 'نوع الجهاز مش معروف',
  empty_token: 'بيانات التنبيهات ناقصة',
  invalid_driver_input: 'راجع البيانات وجرب تاني',
  driver_action_failed: 'العملية متنفذتش. جرب تاني أو راجع السجل',

  // catalog checks (batch 9)
  not_authorised: 'مش مسموح بالعملية دي',
  group_name_required: 'اكتب اسم المجموعة',
  item_belongs_to_another_vendor: 'الصنف ده تابع لمطعم تاني',
  invalid_scope: 'نوع الخصم مش مظبوط',
  restaurant_required: 'اختار المطعم الأول',
  invalid_catalog_input: 'راجع البيانات وجرب تاني',
  catalog_check_failed: 'العملية متنفذتش. جرب تاني أو راجع السجل',

  // ---------------------------------------------------------------------------
  // Promo codes.
  //
  // THESE WERE MISSING, AND THAT WAS A LIVE BUG. extractCode() only recognises
  // keys that appear in this object; anything else collapses to 'unknown'.
  // CheckoutPage then tests `err.message.includes('promo_expired')` against that
  // 'unknown' and never matches, so EVERY promo failure -- wrong code, expired,
  // already used, below the minimum, campaign exhausted -- showed the customer
  // «حصل خطأ، جرب تاني» instead of the reason.
  //
  // Found 2026-08-18 while SOKHNA30 was live and expiring the next day. The
  // Arabic below is not new: it already existed in CheckoutPage's ladder, which
  // was simply unreachable.
  promo_invalid: 'كود الخصم غير صحيح',
  promo_expired: 'كود الخصم انتهت صلاحيته',
  promo_not_available: 'الكود ده مش متاح للمطعم أو المنطقة دي',
  promo_minimum_not_met: 'الطلب أقل من الحد الأدنى لكود الخصم',
  promo_limit_reached: 'كود الخصم خلص',
  promo_already_used: 'استخدمت كود الخصم ده قبل كده',
  promo_nothing_to_discount: 'كود الخصم مش بيخصم حاجة في الطلب ده',
  promo_customer_missing: 'سجّل دخولك عشان تستخدم كود الخصم',

  // ---------------------------------------------------------------------------
  // Order-path validation the customer can act on. Same problem as the promo
  // block: emitted by customer-order-creation, absent from here, so they all
  // arrived as 'unknown' and the customer was told nothing useful.
  invalid_customer_name: 'اكتب اسمك بشكل صحيح',
  invalid_unit_number: 'اكتب رقم الوحدة بشكل صحيح',
  invalid_zone: 'اختار منطقتك الأول',
  notes_too_long: 'الملاحظات طويلة أوي. اختصرها شوية',
  invalid_item_quantity: 'الكمية مش مظبوطة',
  invalid_addon: 'في إضافة مابقتش متاحة، شيلها وجرب تاني',
  collect_amount_required: 'اكتب المبلغ المطلوب تحصيله',
  invalid_collect_amount: 'المبلغ المطلوب تحصيله مش مظبوط',
  invalid_payment_mode: 'اختار طريقة الدفع',
  invalid_prescription_path: 'صورة الروشتة فيها مشكلة. ارفعها تاني',
  not_a_custom_order_vendor: 'المكان ده مش بيستقبل طلبات خاصة',
  request_too_large: 'الطلب كبير أوي. قلل عدد الأصناف وجرب تاني',

  // ---------------------------------------------------------------------------
  // Our fault, not the customer's. Listed so extractCode RECOGNISES them and
  // analytics records which one happened -- previously indistinguishable from
  // every other 'unknown'. The wording says the problem is ours and does not
  // tell anyone to retry something that will fail again the same way.
  invalid_json: 'في مشكلة عندنا دلوقتي. جرب تاني بعد شوية',
  invalid_request: 'في مشكلة عندنا دلوقتي. جرب تاني بعد شوية',
  invalid_action: 'في مشكلة عندنا دلوقتي. جرب تاني بعد شوية',
  method_not_allowed: 'في مشكلة عندنا دلوقتي. جرب تاني بعد شوية',
  missing_rate_limit_pepper: 'في مشكلة عندنا دلوقتي. جرب تاني بعد شوية',
  rate_limit_identity_failed: 'في مشكلة عندنا دلوقتي. جرب تاني بعد شوية',
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

// Backoff between automatic retries. Short and few: this is for a dropped
// packet or a momentary radio drop-out, not a strategy for a genuinely
// offline device -- retrying into no connectivity at all just burns the
// user's patience three times instead of once.
const RETRY_DELAYS_MS = [500, 1500]

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Retrying is opt-in (`retries` defaults to 0, i.e. today's behaviour)
// because it is only safe for calls the server treats idempotently. A
// transport failure here does not mean the request never reached the
// server -- postgrest/edge functions can process a write and have the
// *response* get lost, in which case a naive blind retry double-submits
// it. This app's write RPCs are mostly single-column status transitions
// guarded by a stage check (`wrong_stage`, `already_taken`, ...), so a
// retry after a successful-but-unacknowledged first attempt just gets a
// harmless business-error rejection back -- but that is a property of the
// specific RPC being called, not something this generic wrapper can know.
// Callers must confirm that before passing retries > 0; see
// driverAssignmentActions.ts for the reasoning on the one place this is
// turned on today.
export async function rpc<T = unknown>(
  name: string,
  args?: Record<string, unknown>,
  overrides?: Record<string, string>,
  retries = 0
): Promise<RpcResult<T>> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { data, error, status } = await supabase.rpc(name, args)
      if (error) {
        const transport = isTransportFailure(error.message, status)
        if (transport && attempt < retries) { await delay(RETRY_DELAYS_MS[attempt] ?? 1500); continue }
        return {
          ok: false,
          code: transport ? 'network' : extractCode(error.message),
          error: transport ? OFFLINE_AR : describeError(error.message, overrides),
          offline: transport,
        }
      }
      return { ok: true, data: data as T }
    } catch {
      // supabase-js normally surfaces transport failures via `error`, but a
      // hard network drop can reject instead. Treat it as offline rather
      // than generic.
      if (attempt < retries) { await delay(RETRY_DELAYS_MS[attempt] ?? 1500); continue }
      return { ok: false, code: 'network', error: OFFLINE_AR, offline: true }
    }
  }
}

/**
 * Same result contract as rpc(), but for privileged customer actions that now
 * enter through an Edge Function rather than an anonymous database RPC.
 * `retries` carries the same idempotency caveat as rpc() above.
 */
export async function edgeAction<T = unknown>(
  name: string,
  body: Record<string, unknown>,
  overrides?: Record<string, string>,
  retries = 0
): Promise<RpcResult<T>> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke(name, { body })
      if (error || data?.error || !data?.ok) {
        let serverMessage = typeof data?.error === 'string' ? data.error : error?.message
        if (error && 'context' in error && error.context instanceof Response) {
          const payload = await error.context.clone().json().catch(() => null)
          if (typeof payload?.error === 'string') serverMessage = payload.error
        }
        const transport = isTransportFailure(serverMessage)
        if (transport && attempt < retries) { await delay(RETRY_DELAYS_MS[attempt] ?? 1500); continue }
        return {
          ok: false,
          code: transport ? 'network' : extractCode(serverMessage),
          error: transport ? OFFLINE_AR : describeError(serverMessage, overrides),
          offline: transport,
        }
      }
      return { ok: true, data: data.data as T }
    } catch (error) {
      const message = error instanceof Error ? error.message : null
      const transport = isTransportFailure(message)
      if (transport && attempt < retries) { await delay(RETRY_DELAYS_MS[attempt] ?? 1500); continue }
      return {
        ok: false,
        code: transport ? 'network' : 'unknown',
        error: transport ? OFFLINE_AR : GENERIC_AR,
        offline: transport,
      }
    }
  }
}
