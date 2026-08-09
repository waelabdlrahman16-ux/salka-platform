import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { describeError, edgeAction, isTransportFailure, rpc } from '../lib/rpc'
import InstallPrompt from '../components/InstallPrompt'
import { markOrderDelivered } from '../lib/firstOrder'
import { registerPush } from '../lib/push'
import type { PushPlatform } from '../lib/push'
import { reportSaveStale } from '../lib/push'
import EnablePushButton from '../components/EnablePushButton'
import { vendorNoun } from '../lib/vendorWords'
import { INSTAPAY_QR_URL, INSTAPAY_LINK, INSTAPAY_HANDLE } from '../lib/instapay'
import LiveMap from '../components/LiveMap'
import Icon from '../components/Icon'
import InAppLoginPrompt from '../components/InAppLoginPrompt'
import { isCancelled, cancelReasonLabel } from '../lib/statusLabels'
import { useDismissable } from '../lib/useDismissable'

// Found by driving it: a pharmacy order with no price, no vendor acceptance and
// no driver rendered "قيد التجهيز" with "الوصول المتوقع 7:15 ص". Nothing was
// being prepared and no one had committed to a time. The bar had three stages
// and the first one absorbed everything that had not started yet.
//
// The stage is now derived from the KITCHEN, not from orders.status. 'pending'
// was mapped to "قيد التجهيز", but pending means "placed and dispatchable" --
// the restaurant has not seen it yet (kitchen_status = 'new'). So a customer who
// had just tapped confirm was told their food was being prepared, seconds after
// ordering, by a restaurant that had not accepted. Whether a driver is being
// searched for is a parallel track and must not move this bar backwards either.
const STAGES = [
  { key: 'received',  label: 'استلمنا طلبك' },
  { key: 'placed',    label: 'قيد التجهيز' },
  { key: 'onway',     label: 'في الطريق إليك' },
  { key: 'delivered', label: 'تم التوصيل' },
]

const CUSTOMER_CANCEL_REASONS = [
  { code: 'customer_waiting_too_long', label: 'الطلب اتأخر وأنا مش هقدر أستنى' },
  { code: 'customer_price_too_high', label: 'السعر أعلى من اللي يناسبني' },
  { code: 'customer_payment_problem', label: 'عندي مشكلة في طريقة الدفع' },
  { code: 'customer_ordered_by_mistake', label: 'طلبت بالغلط' },
  { code: 'customer_changed_mind', label: 'غيّرت رأيي' },
  { code: 'customer_other', label: 'سبب تاني' },
] as const

type CustomerCancelReason = typeof CUSTOMER_CANCEL_REASONS[number]['code']

interface TrackData {
  order: {
    id: number; status: string; subtotal: number; delivery_fee: number; service_fee: number; wallet_used: number; total: number
    zone: string; unit_number: string; address_notes: string; restaurant_name: string; vendor_type: string | null
    ready_at: string | null; scheduled_date: string | null
    created_at: string; sla_minutes: number | null
    dest_lat: number | null; dest_lng: number | null
    order_type: 'catalog' | 'custom_request' | 'pickup_request'
    request_items: { name: string; qty: number }[] | null
    request_notes: string | null
    pricing_status: 'n/a' | 'pending_quote' | 'confirmed'
    payment_mode: 'prepaid' | 'driver_pays' | null
    collect_amount: number | null
    payment_method: 'cod' | 'online' | 'instapay' | null
    online_payment_status: 'pending' | 'paid' | 'failed' | null
    cancel_reason: string | null
    cancelled_at: string | null
    refund_status: string | null
    kitchen_status: 'new' | 'preparing' | 'ready' | null
    cod_deposit_amount: number | null
    instapay_claimed: boolean
    /** Whether this order already contributed to driver/vendor reputation. */
    rating_submitted: boolean
  } | null
  items: {
    name: string; qty: number; total: number; image_url: string | null
    size_name: string | null; combo_name: string | null; addon_names: string[] | null
    /** Admin price correction rather than something the customer ordered. */
    is_adjustment?: boolean
  }[]
  assignment: {
    status: string; driver_name: string | null; driver_phone: string | null
    driver_instapay: string | null
    driver_lat: number | null; driver_lng: number | null; driver_location_updated_at: string | null
    /** Set the moment the rider marks himself at the door. Added to track_order
     *  on 2026-08-07 — the server always knew, and never said. */
    arrived_at_customer_at: string | null
  } | null
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit' })
}

export default function Track() {
  const { token } = useParams()
  const [data, setData] = useState<TrackData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const [cancelPickerOpen, setCancelPickerOpen] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [driverRating, setDriverRating] = useState(0)
  const [restaurantRating, setRestaurantRating] = useState(0)
  const [ratingSent, setRatingSent] = useState(false)
  const [complaining, setComplaining] = useState(false)
  const [showTipPrompt, setShowTipPrompt] = useState(false)
  const [tipAmount, setTipAmount] = useState<number | null>(null)
  const [customTip, setCustomTip] = useState('')
  const [tipSent, setTipSent] = useState(false)
  const [complaintCategory, setComplaintCategory] = useState<'missing_item' | 'wrong_item' | 'driver_conduct' | 'quality' | 'other'>('other')
  const [complaintText, setComplaintText] = useState('')
  const [complaintSent, setComplaintSent] = useState(false)
  const [claimingPayment, setClaimingPayment] = useState(false)
  const [copied, setCopied] = useState(false)

  // Scoped so the message renders next to the control that failed. A single
  // top-of-page banner is invisible for the cancel/rating/tip/complaint
  // buttons, which sit several screens below the fold.
  const [actionError, setActionError] = useState<{ scope: string; message: string } | null>(null)
  const errFor = (scope: string) => (actionError?.scope === scope ? actionError.message : '')
  const [staleSince, setStaleSince] = useState<number | null>(null)
  const [switchingToCash, setSwitchingToCash] = useState(false)
  const [switchedNote, setSwitchedNote] = useState('')
  const [addingItem, setAddingItem] = useState(false)
  const [extraItem, setExtraItem] = useState('')
  const [extraSaving, setExtraSaving] = useState(false)

  // Remember, on this device, that an order has actually landed. It is what
  // gates the install prompt: the app asks for a home-screen slot once, from the
  // screen where the food just arrived, instead of on every route from the first
  // second of the first visit.
  useEffect(() => {
    if (data?.order?.status === 'Delivered') markOrderDelivered()
  }, [data?.order?.status])

  // Changing your mind about HOW you pay should not mean cancelling WHAT you
  // ordered. An InstaPay order is created at awaiting_payment, so by the time
  // this screen appears the cart is emptied and checkout is gone -- and the
  // only exit here was "الغِ الطلب", i.e. rebuild the whole basket to swap a
  // payment method. switch_to_cash() moves the order to cash in place; if it is
  // over the cash-deposit threshold it stays on this screen owing the deposit
  // instead of the full amount, which the server tells us so we can say so.
  async function switchToCash() {
    if (!token) return
    setSwitchingToCash(true); setActionError(null)
    const res = await edgeAction<{ status: string; deposit_required: number | null }>(
      'customer-payment-actions', { action: 'switch_to_cash', token }, {
        rate_limited: 'حاولت تغيّر طريقة الدفع كتير — استنى شوية وجرب تاني',
        payment_already_claimed: 'قلت لنا إنك حوّلت بالفعل — استنى المراجعة، ولو في مشكلة كلّمنا',
        wrong_stage: 'الطلب اتحرك خلاص — مش هينفع نغيّر طريقة الدفع دلوقتي',
        already_assigned: 'المندوب استلم الطلب خلاص — ادفع كاش عند التوصيل عادي',
      })
    setSwitchingToCash(false)
    if (!res.ok) { setActionError({ scope: 'instapay', message: res.error }); return }

    // A cash order above cod_deposit_threshold_egp still owes a 50% deposit --
    // the same rule it would have met had cash been picked at checkout. So this
    // screen can reappear, now headed "ادفع عربون 50%", and without a word of
    // warning that reads as the button having done nothing, or worse, as a
    // bait-and-switch after a button that said "cash on delivery". Say it.
    if (res.data?.deposit_required) {
      setSwitchedNote(`الطلب أكبر من الحد المسموح كاش بالكامل، فمحتاجين عربون ${res.data.deposit_required} ج.م دلوقتي والباقي كاش عند الاستلام.`)
    } else {
      setSwitchedNote('تمام — الطلب بقى كاش عند الاستلام.')
    }
    load()
  }

  // "نسيت صنف". Without it, remembering the milk means placing a SECOND order
  // to the same house -- two deliveries, two drivers, two delivery fees for one
  // shopping trip, and two things for the vendor to reconcile. The server only
  // allows it while nobody has started work.
  async function addForgottenItem() {
    if (!token || !extraItem.trim()) return
    setExtraSaving(true); setActionError(null)
    const res = await edgeAction('customer-order-editing', {
      token, items: [{ name: extraItem.trim(), qty: 1 }],
    }, {
      order_not_priced: 'الطلب اتسعّر خلاص — كلّمنا عشان نضيفه',
      wrong_stage: 'بدأنا نجهّز الطلب — كلّمنا عشان نضيفه',
      already_assigned: 'المندوب في الطريق — كلّمنا عشان نضيفه',
      order_edit_rate_limit: 'حاولت تضيف أصناف كتير — استنى شوية وجرب تاني',
      daily_order_edit_limit: 'وصلت للحد اليومي لإضافة الأصناف — كلّمنا عشان نساعدك',
    })
    setExtraSaving(false)
    if (!res.ok) { setActionError({ scope: 'extra', message: res.error }); return }
    setExtraItem(''); setAddingItem(false)
    load()
  }

  async function claimInstapayPayment() {
    if (!token) return
    setClaimingPayment(true); setActionError(null)
    const res = await edgeAction('customer-payment-actions', {
      action: 'claim_instapay', token,
    }, {
      rate_limited: 'حاولت تأكد التحويل كتير — استنى شوية وجرب تاني',
    })
    setClaimingPayment(false)
    // The customer's money is already gone at this point. A failure here used
    // to silently redraw the same button with no explanation.
    if (!res.ok) { setActionError({ scope: 'instapay', message: res.error }); return }
    load()
  }

  // The polling effect captures `load` from the first render, so reading `data`
  // directly here would always see its initial null and re-latch not-found on
  // any later failure. Mirror it in a ref.
  const dataRef = useRef<TrackData | null>(null)

  async function load() {
    const res = await rpc<TrackData>('track_order', { p_token: token })

    // A transient poll failure used to set notFound permanently -- one lift ride
    // replaced a live order with "الطلب غير موجود" and it never recovered,
    // because network errors and "this token is invalid" were conflated.
    //
    // Latch not-found ONLY on a definitive answer from the server. Anything
    // else -- unknown code, transport failure, 500 -- is treated as transient.
    // Deciding by *exclusion* ("not a network error") is unsafe here, because
    // postgrest resolves rather than rejects on a dropped fetch and
    // navigator.onLine lies inside a Capacitor webview, so an unrecognised
    // failure is far more likely to be a bad connection than a bad token.
    if (!res.ok) {
      if (res.code === 'order_not_found' || res.code === 'not_authorized') {
        setNotFound(true)
        return
      }
      setStaleSince(prev => prev ?? Date.now())
      return
    }
    if (!res.data || !res.data.order) { setNotFound(true); return }
    dataRef.current = res.data
    setNotFound(false)
    setStaleSince(null)
    setData(res.data)
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Named and hoisted so the mount-time refresh and the opt-in BUTTON below
  // share one sink. They used to be one anonymous callback that only the effect
  // could reach, which is part of why the button was never added.
  //
  // The platform argument was being dropped. persistPushToken forwards it for
  // staff; this one took `pushToken` alone, so any token an Android app
  // registered for a customer was stored as though it came from a browser --
  // and a web-shaped message to a killed Android app displays nothing.
  const saveCustomerToken = useCallback(async (pushToken: string, platform: PushPlatform) => {
    reportSaveStale(false)
    const { data, error } = await supabase.rpc('save_customer_push_token', {
      p_token: token, p_push_token: pushToken, p_platform: platform,
    })
    if (error) { console.error('saving customer push token failed', error); return false }
    // Same contract as the staff sink. Without reporting this, the self-heal in
    // saveWebTokenHealing could never fire for a customer -- it reads a module
    // flag that only persistPushToken used to set.
    if (data && typeof data === 'object' && (data as any).stale) {
      reportSaveStale(true)
      return false
    }
    return (data as any)?.stored !== false
  }, [token])

  useEffect(() => {
    if (!token) return
    // Was a floating promise inside a floating promise: no await, no catch, no
    // error check. And the server does a bare `update ... where public_token =
    // p_token`, so a token matching nothing updates 0 rows and raises nothing --
    // meaning even a successful call could silently do nothing.
    registerPush(saveCustomerToken)
  }, [token, saveCustomerToken])

  // These four all used to discard their error and set the success flag
  // regardless, so a failed rating, tip or complaint told the customer it had
  // been sent and there was no way to discover otherwise or retry.
  async function sendRating() {
    if (!token || (!driverRating && !restaurantRating)) return
    setActionError(null)
    const res = await rpc('submit_rating', {
      p_token: token, p_driver_rating: driverRating || null, p_restaurant_rating: restaurantRating || null
    }, {
      rating_already_submitted: 'تم إرسال تقييم للطلب ده بالفعل',
      rating_window_closed: 'فترة تقييم الطلب انتهت',
    })
    if (!res.ok) { setActionError({ scope: 'rating', message: res.error }); return }
    setRatingSent(true)
    if (driverRating > 0 && driverRating <= 2) {
      setComplaintCategory('driver_conduct')
      setComplaining(true)
    } else if (driverRating >= 4 && data?.assignment?.driver_instapay) {
      setShowTipPrompt(true)
    }
  }

  async function sendTip() {
    const amount = tipAmount ?? Number(customTip)
    if (!token || !amount || amount <= 0) return
    setActionError(null)
    const res = await edgeAction('customer-payment-actions', {
      action: 'submit_tip', token, amount,
    }, {
      rate_limited: 'حاولت تبعت الإكرامية كتير — استنى شوية وجرب تاني',
    })
    if (!res.ok) { setActionError({ scope: 'tip', message: res.error }); return }
    setTipSent(true)
  }

  async function sendComplaint() {
    if (!token || !complaintText.trim()) return
    setActionError(null)
    const res = await rpc('submit_complaint', {
      p_token: token, p_description: complaintText.trim(), p_category: complaintCategory
    })
    if (!res.ok) { setActionError({ scope: 'complaint', message: res.error }); return }
    setComplaintSent(true); setComplaining(false)
  }

  async function cancelOrder(reason: CustomerCancelReason) {
    if (!data?.order) return
    setCancelPickerOpen(false)
    setCancelling(true); setActionError(null)
    try {
      const { data: result, error } = await supabase.functions.invoke('cancel-order', {
        body: { order_id: data.order.id, reason, token }
      })
      if (error || !result?.ok) {
        let code = typeof result?.error === 'string' ? result.error : null
        if (!code && error && 'context' in error && error.context instanceof Response) {
          const payload = await error.context.clone().json().catch(() => null)
          if (typeof payload?.error === 'string') code = payload.error
        }
        const cancellationErrors: Record<string, string> = {
          rate_limited: 'حاولت تلغي كتير في وقت قصير — استنى شوية وجرب تاني',
          cancel_failed: 'الإلغاء متنفذش — جرب تاني أو كلّمنا',
          rate_limit_check_failed: 'حصل عطل مؤقت — جرب تاني بعد شوية',
          invalid_cancel_reason: 'اختار سبب الإلغاء وجرب تاني',
        }
        const message = (code && cancellationErrors[code]) || describeError(code ?? error?.message)
        setActionError({ scope: 'cancel', message })
        return
      }
      setCancelled(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : null
      setActionError({
        scope: 'cancel',
        message: isTransportFailure(message) ? 'مفيش اتصال بالنت — اتأكد من الشبكة وجرب تاني' : 'الإلغاء متنفذش — جرب تاني أو كلّمنا'
      })
    } finally {
      setCancelling(false)
    }
  }

  function copyOrderNumber() {
    if (!data?.order) return
    navigator.clipboard?.writeText(`#${data.order.id}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (notFound) return (
    <div className="card p-6 text-center max-w-sm mx-auto">
      <p className="font-semibold">الطلب غير موجود</p>
      <Link className="text-sea text-sm mt-2 inline-block" to="/">العودة للرئيسية</Link>
    </div>
  )
  // A failed *first* load used to sit on "جاري التحميل…" forever.
  if (!data || !data.order) {
    if (staleSince !== null) return (
      <div className="card p-6 text-center max-w-sm mx-auto">
        <p className="font-semibold">مش قادرين نجيب حالة الطلب دلوقتي</p>
        <p className="text-sm text-mist mt-1.5">اتأكد من الاتصال بالنت</p>
        <button className="btn-sea mt-4" onClick={load}>جرب تاني</button>
        <Link className="text-sea text-sm mt-3 block" to="/">العودة للرئيسية</Link>
      </div>
    )
    return <p className="text-mist">جاري التحميل…</p>
  }

  const o = data.order

  if (o.status === 'awaiting_payment' && (o.payment_method === 'instapay' || o.cod_deposit_amount != null)) {
    const isDeposit = o.cod_deposit_amount != null
    const payNow = isDeposit ? o.cod_deposit_amount! : o.total
    return (
      <div className="max-w-lg mx-auto">
        {cancelPickerOpen && (
          <CancelReasonSheet busy={cancelling}
            onClose={() => setCancelPickerOpen(false)}
            onConfirm={cancelOrder} />
        )}
        <Link to="/" className="text-sm text-mist hover:text-foam"><Icon name="chevronLeft" className="w-3 h-3 inline-block align-middle ml-1" />العودة للرئيسية</Link>
        {errFor('instapay') && (
          <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mt-3">{errFor('instapay')}</p>
        )}
        {/* Also rendered here, not only in the main return.
            The two switch_to_cash outcomes leave by different doors: a small
            order moves to pending and falls through to the main return, while
            an order over the deposit threshold STAYS on this wall -- and it is
            that one whose message matters, because the screen redraws headed
            "ادفع عربون 50%" and looks like the button did nothing. */}
        {switchedNote && (
          <p className="text-sm bg-sea/10 text-seadeep rounded-xl p-3 mt-3">{switchedNote}</p>
        )}
        <div className="card p-4 mt-3 text-center">
          <h1 className="font-bold text-lg mb-1">{isDeposit ? 'ادفع عربون 50% على InstaPay' : 'حوّل المبلغ على InstaPay'}</h1>
          <p className="text-mist text-sm mb-3">طلب #{o.id} من {o.restaurant_name}</p>
          <p className="text-sea font-bold text-2xl mb-1">{payNow} ج.م</p>
          {isDeposit && (
            <p className="text-mist text-sm mb-4">والباقي {o.total - payNow} ج.م كاش عند الاستلام</p>
          )}

          {INSTAPAY_QR_URL && (
            <img src={INSTAPAY_QR_URL} alt="InstaPay QR" className="w-44 h-44 mx-auto mb-4 rounded-xl border border-line" />
          )}

          <a href={INSTAPAY_LINK} target="_blank" rel="noreferrer" className="btn-sea w-full !flex items-center justify-center text-center mb-4">
            افتح InstaPay وحوّل مباشرة
          </a>

          {/* THE ADDRESS, IN TEXT. This screen asked for money and showed only
              two ways to send it that can both fail silently: a QR image with
              no onError, and an ipn.eg deep link that resolves to nothing on a
              desktop browser or a phone without the app installed. In either
              case the customer was left on a payment wall holding an amount and
              no destination -- and the only remaining button says "cancel".
              A copyable handle costs one line and always works. */}
          <div className="flex items-center justify-center gap-2 mb-4 text-sm">
            <span className="text-mist">أو حوّل على</span>
            <bdi dir="ltr" className="font-semibold select-all">{INSTAPAY_HANDLE}</bdi>
            <button
              className="text-sea underline text-xs"
              onClick={async () => {
                try { await navigator.clipboard.writeText(INSTAPAY_HANDLE); setCopied(true); setTimeout(() => setCopied(false), 2000) }
                catch { /* select-all above is the fallback */ }
              }}>
              {copied ? 'تم النسخ ✓' : 'نسخ'}
            </button>
          </div>

          {o.instapay_claimed ? (
            <p className="text-sm text-mist">
              تمام، إحنا بنراجع التحويل دلوقتي. الطلب هيتأكد خلال دقايق.
            </p>
          ) : (
            <>
              <button className="btn-sea w-full" disabled={claimingPayment} onClick={claimInstapayPayment}>
                {claimingPayment ? 'جاري التأكيد…' : 'حوّلت المبلغ ✓'}
              </button>

              {/* The missing door. Before this, someone who opened InstaPay and
                  decided they would rather pay cash had exactly one option:
                  cancel the order and rebuild the basket from scratch, because
                  the cart was emptied the moment the order was created. Not
                  offered on a deposit order -- that one is already cash. */}
              {o.payment_method === 'instapay' && (
                <button className="btn-ghost w-full mt-2.5" disabled={switchingToCash} onClick={switchToCash}>
                  {switchingToCash ? 'لحظة…' : '💵 هدفع كاش بدل'}
                </button>
              )}
            </>
          )}

          {/* This screen used to have no way out. An InstaPay or deposit order is
              CREATED at awaiting_payment, and cancel_order refused a non-admin
              once status left 'pending' -- so from the very first thing the
              customer saw, cancelling was already impossible. The cancel button
              further down this file never rendered either, because this branch
              returns before it. Someone who changed their mind could only close
              the tab, and the order stayed open on the admin's list forever. */}
          {!cancelled ? (
            <>
              {errFor('cancel') && (
                <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mt-4">{errFor('cancel')}</p>
              )}
              <button className="text-sm text-mist underline mt-4" disabled={cancelling} onClick={() => setCancelPickerOpen(true)}>
                {cancelling ? 'جاري الإلغاء…' : 'مش عايز أكمل — الغِ الطلب'}
              </button>

            </>
          ) : (
            <p className="text-sm text-mist mt-4">تم إلغاء الطلب.</p>
          )}
        </div>
      </div>
    )
  }

  // Before a driver exists there is no assignment, and this fell back to the
  // literal string 'pending' -- which is how an unpriced order inherited the
  // "قيد التجهيز" stage. Fall back to the order's own status instead, which now
  // distinguishes awaiting_quote / Scheduled / Driver_Searching / No_Driver_Found.
  const current = data.assignment?.status && data.assignment.status !== 'Offered'
    ? data.assignment.status
    : o.status

  // Furthest point actually reached. The kitchen and the dispatch run in
  // parallel -- an order can be cooking while we are still looking for a rider,
  // and neither of them should be able to pull the bar back.
  const kitchen = o.kitchen_status ?? 'new'
  const asg = data.assignment?.status && data.assignment.status !== 'Offered' ? data.assignment.status : null
  const stageIdx =
    o.status === 'Delivered' || asg === 'Delivered' ? 3
    // 'Failed' means it WAS picked up and the delivery did not complete. Falling
    // through to the kitchen check sent the bar backwards to «قيد التجهيز» --
    // telling a customer their already-cooked food is being prepared.
    : asg === 'Picked_Up' || asg === 'Out_for_Delivery' || asg === 'Failed' ? 2
    : kitchen === 'preparing' || kitchen === 'ready' ? 1
    : 0

  // Named where we have one, «المندوب» where we do not. Used everywhere the
  // rider is referred to, so the screen never calls أشرف "the courier" in one
  // line and أشرف in the next.
  const driverName = data.assignment?.driver_name || 'المندوب'
  // NOT once the delivery has failed. arrived_at_customer_at is never cleared,
  // so a failed drop still carried the 🎉 «المندوب وصل تحت» banner directly
  // above the notice saying the delivery did not complete.
  const hasArrived = !!data.assignment?.arrived_at_customer_at
    && o.status !== 'Failed_Delivery' && data.assignment?.status !== 'Failed'

  // The customer keeps the right to cancel until the vendor accepts. It used to
  // survive until a driver appeared, so the page offered "إلغاء الطلب" directly
  // underneath a heading saying the order was being cooked. The server enforces
  // the same rule; this only decides whether to show a button that would fail.
  const notStartedYet = (o.kitchen_status ?? 'new') === 'new'
  const cancellableStatus = ['pending', 'awaiting_payment', 'awaiting_quote', 'Scheduled', 'Driver_Searching']
    .includes(o.status)
  const canCancel = cancellableStatus && notStartedYet && !data.assignment
    && !cancelled && !isCancelled(o.status)

  return (
    <div className="max-w-lg mx-auto pb-6">
      {cancelPickerOpen && (
        <CancelReasonSheet busy={cancelling}
          onClose={() => setCancelPickerOpen(false)}
          onConfirm={cancelOrder} />
      )}
      <div className="flex items-center justify-between mb-3">
        {/* rotate-180: the page is RTL, so "back" points RIGHT — same mirror
            fix as RestaurantDetail and Vendor. */}
        <Link to="/" className="text-sm text-mist hover:text-foam"><Icon name="chevronLeft" className="w-3 h-3 inline-block align-middle ml-1 rotate-180" />العودة</Link>
        <span className="text-sm font-semibold text-mist">طلب #{o.id}</span>
      </div>

      {/* Polling stopped succeeding but we keep the last known order on screen
          rather than replacing it with a not-found card. */}
      {staleSince !== null && (
        <div className="bg-sand/15 border border-sand/40 rounded-xl p-3 mb-4 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-foam">📡 مش قادرين نحدّث الحالة — ممكن تكون قديمة</p>
          <button className="btn-ghost !py-2 text-sm shrink-0" onClick={load}>حدّث</button>
        </div>
      )}

      {/* Rendered HERE, not inside the InstaPay wall, because the successful
          non-deposit path moves the order to pending and drops straight out of
          that branch -- so the confirmation the customer just earned flashed
          for about 200ms and vanished. The deposit path keeps them on the wall
          and would have been fine; the common path was not. */}
      {switchedNote && (
        <p className="text-sm bg-sea/10 text-seadeep rounded-xl p-3 mb-4">{switchedNote}</p>
      )}

      {errFor('instapay') && (
        <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">{errFor('instapay')}</p>
      )}

      {isCancelled(o.status) || cancelled ? (
        <div className="card p-4 text-center mb-4">
          <p className="text-4xl mb-2">📦</p>
          <h1 className="font-bold text-lg">تم إلغاء الطلب</h1>
          {/* cancelReasonLabel, not the raw column. The reason is a code --
              `customer_cancelled`, `vendor_rejected` -- and it was being
              printed straight onto an Arabic RTL screen in English. It was
              fixed on the admin card the same day and missed here, which is
              the surface the CUSTOMER reads. */}
          {o.cancel_reason && (
            <p className="text-sm text-mist mt-1.5">{cancelReasonLabel(o.cancel_reason)}</p>
          )}
          {/* Silence here was the worst version of this screen: the customer had
              paid, the order was gone, and the page said nothing about the money
              -- while an admin was looking at the same row in a refunds queue. */}
          {o.refund_status === 'pending' && (
            <p className="text-sm text-sandink bg-sand/10 rounded-xl p-3 mt-3">
              💰 فلوسك في طريقها ليك — هنحوّلها على نفس الرقم اللي حوّلت منه.
              لو اتأخرت، كلّمنا.
            </p>
          )}
          {o.refund_status === 'refunded' && (
            <p className="text-sm text-emerald-700 bg-emerald-500/10 rounded-xl p-3 mt-3">
              ✓ تم تحويل المبلغ ليك
            </p>
          )}
        </div>
      ) : (
        <div className="card p-4 mb-4">
          {/* THE moment. The rider is downstairs — this is what the customer has
              been refreshing for, and until now it read exactly like every other
              status line. The cash figure is the SERVER's `total`, never
              recomputed here: five different client-side copies of that sum
              already disagree across Track, Driver and Admin, and this is not
              becoming the sixth. */}
          {hasArrived && current !== 'Delivered' && (
            <div className="-m-4 mb-4 rounded-t-xl bg-gradient-to-b from-emerald-600 to-emerald-700 text-white p-4 text-center">
              <p className="text-2xl mb-1">🎉</p>
              <p className="font-bold text-lg">{driverName} وصل تحت</p>
              {o.payment_method === 'cod' && (
                <p className="text-sm opacity-90 mt-0.5">معاه طلبك · جهّز {o.total} ج.م كاش</p>
              )}
            </div>
          )}
          <div className="flex items-start justify-between gap-2 mb-1">
            <h1 className="font-bold text-xl">
              {current === 'Delivered' ? '✅ تم التوصيل'
                // The BAR is right to sit at stage 2 -- the order really did get
                // that far -- but «في الطريق إليك» as the headline for a
                // delivery that has already failed is simply false, and it was
                // rendering directly above the paragraph explaining the failure.
                : o.status === 'Failed_Delivery' ? 'التوصيلة ما اكتملتش'
                : STAGES[stageIdx]?.label ?? 'استلمنا طلبك'}
            </h1>
            {/* One word for the thing the customer actually wants to know. It
                was buried in a sentence under the ETA. */}
            {o.sla_minutes && current !== 'Delivered' && !o.scheduled_date
              && o.status !== 'Failed_Delivery'
              && o.pricing_status !== 'pending_quote' && (() => {
              const late = Date.now() > new Date(o.created_at).getTime() + o.sla_minutes * 60000
              return (
                <span className={`shrink-0 text-[11px] font-bold rounded-full px-2.5 py-1 ${
                  late ? 'bg-sand/20 text-sandink' : 'bg-emerald-500/12 text-emerald-700'}`}>
                  {late ? 'متأخر شوية' : 'في الميعاد'}
                </span>
              )
            })()}
          </div>
          {o.status === 'awaiting_quote' && (
            <p className="text-sm text-mist">لسه بنراجع الأصناف وهنتصل بيك بالسعر</p>
          )}
          {o.status === 'Driver_Searching' && (
            <p className="text-sm text-mist">بندوّر على مندوب قريب منك</p>
          )}
          {o.status === 'No_Driver_Found' && (
            <p className="text-sm text-sandink">الزحمة عالية دلوقتي — الإدارة بتظبط لك مندوب</p>
          )}
          {/* Failed_Delivery was a genuine dead end. It appears in no branch of
              this screen, so the stage bar pinned it at «في الطريق إليك» -- for
              a delivery that had already failed -- and, because it was also
              missing from the suppression list on the SLA line below, the page
              then added «اتأخر شوية عن الوقت المستهدف». A customer whose
              delivery had failed was told their order was on its way and
              slightly late, with no action anywhere on the screen.

              The order is still live and re-dispatchable (statusLabels.ts), so
              the copy says a second attempt is being arranged rather than
              implying it is over. */}
          {o.status === 'Failed_Delivery' && (
            <p className="text-sm text-sandink">
              التوصيلة ما اكتملتش — الإدارة بتراجع الطلب وهنكلّمك حالًا
            </p>
          )}
          {/* This said «الوصول المتوقع» -- expected ARRIVAL -- while ready_at is
              when the food is ready and the DRIVER COLLECTS it. It was missing
              the whole delivery leg, and it contradicted the «الهدف: يوصلك قبل»
              line right below it, which is the real arrival promise. Order #53
              showed «الوصول المتوقع 15:49» at the moment the driver was still
              picking up. Two times on one screen and the louder one was wrong. */}
          {o.ready_at && current === 'pending' && !o.scheduled_date && o.pricing_status !== 'pending_quote' && (
            <p className="text-sm text-mist">الطلب هيبقى جاهز حوالي {fmtTime(o.ready_at)}</p>
          )}
          {o.scheduled_date && <p className="text-sm text-mist">التوصيل خلال الفترة اللي اخترتها</p>}
          {o.sla_minutes && current !== 'Delivered' && !o.scheduled_date
            && o.pricing_status !== 'pending_quote'
            && !['awaiting_quote', 'Scheduled', 'No_Driver_Found', 'Failed_Delivery'].includes(o.status) && (() => {
            const target = new Date(new Date(o.created_at).getTime() + o.sla_minutes * 60000)
            const isLate = Date.now() > target.getTime()
            return (
              <p className={`text-sm mt-1 flex items-center gap-1 ${isLate ? 'text-sandink' : 'text-mist'}`}>
                <Icon name="clock" className="w-3.5 h-3.5" />
                {isLate ? 'اتأخر شوية عن الوقت المستهدف' : `الهدف: يوصلك قبل ${fmtTime(target.toISOString())}`}
              </p>
            )
          })()}

          {/* Four flat bars said "you are somewhere in three thirds". An icon
              per stage says which stage, and the icons are the ones the customer
              already associates with the steps -- basket, scooter, door. */}
          <div className="flex items-center gap-1 mt-4">
            {STAGES.map((s, i) => (
              <div key={s.key} className="contents">
                <span aria-hidden="true"
                  className={`w-7 h-7 shrink-0 rounded-full grid place-items-center text-[13px] ${
                    i <= stageIdx ? 'bg-sea text-white' : 'bg-line text-mist'}`}>
                  {['✓', '🍳', '🛵', '📍'][i]}
                </span>
                {i < STAGES.length - 1 && (
                  <span className={`h-1 flex-1 rounded-full ${i < stageIdx ? 'bg-sea' : 'bg-line'}`} />
                )}
              </div>
            ))}
          </div>

          {/* THE ASK THAT WAS NEVER MADE.
           *
           * Every customer notification the server can send -- order accepted,
           * food ready, rider on the way, rider at your door, delivered --
           * guards on `orders.push_token is null` and returns. On 2026-08-07
           * that column had NEVER been non-null: `select count(push_token) from
           * orders` returned 0 across every order ever placed. All of it was
           * dead code in production.
           *
           * The reason was here. Track called registerPush(), which by design
           * never prompts -- it only refreshes a token when permission is
           * already granted -- and no customer surface anywhere in the app
           * offered the prompt. Permission could not become granted through
           * Salka, so the refresh had nothing to refresh, forever.
           *
           * Placed after the progress bar, not on mount: the customer has just
           * watched the stages and the question "do you want to be told when it
           * moves?" answers itself here. Asking on load is how an origin gets
           * denied permanently. EnablePushButton renders nothing once granted.
           */}
          {current !== 'Delivered' && !isCancelled(o.status) && (
            <div className="mt-3">
              <EnablePushButton onToken={saveCustomerToken} label="نبّهني لما الطلب يتحرك 🔔" />
            </div>
          )}

          {/* The stage-by-stage story, in the order it actually happens. The
              server now distinguishes awaiting_quote / Scheduled /
              Driver_Searching / No_Driver_Found, so there is something real to
              show at every step instead of one "قيد التجهيز" covering all of it. */}
          <button className="text-xs text-sea font-semibold mt-3"
            onClick={() => setTimelineOpen(v => !v)}>
            {timelineOpen ? 'إخفاء التفاصيل ▲' : 'إزاي طلبك ماشي ▼'}
          </button>
          {timelineOpen && (
            <ol className="mt-2.5 border-t border-line pt-3 space-y-0">
              {[
                // The rider has a name. «المندوب» is what you call a stranger;
                // once we know he is أشرف, saying so costs nothing and is the
                // warmest thing on the screen.
                { k: 'placed',    label: 'الطلب اتسجل',              done: true },
                { k: 'confirmed', label: `${o.restaurant_name} أكّد الطلب`, done: stageIdx >= 1 },
                { k: 'searching', label: 'بندوّر على مندوب',          done: !!data.assignment },
                { k: 'picked',    label: `${driverName} استلم الطلب`, done: stageIdx >= 2 },
                // Was `stageIdx >= 3`, i.e. Delivered -- so "arrived" lit up only
                // after the handover was already finished. track_order now
                // returns arrived_at_customer_at, which is the real moment.
                { k: 'arrived',   label: `${driverName} وصل عندك`,    done: hasArrived || stageIdx >= 3 },
              ].map((step, i, arr) => (
                <li key={step.k} className="flex gap-3">
                  <span className="flex flex-col items-center">
                    <span className={`w-3.5 h-3.5 rounded-full shrink-0 mt-1 ${
                      step.done ? 'bg-sea' : 'bg-line'}`} />
                    {i < arr.length - 1 && <span className="w-px flex-1 bg-line" />}
                  </span>
                  <span className={`text-sm pb-3 ${step.done ? 'font-semibold' : 'text-mist'}`}>
                    {step.label}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* "هنتصل بيك بالسعر" was on this screen three times at once: here, in the
          status card, and again in the payment card with the delivery fee
          attached. The payment card is the one that carries a number, so it is
          the one that stays. */}
      {o.order_type === 'pickup_request' && (
        <p className="text-sm bg-shellup/60 rounded-xl p-3 mb-4">
          {o.payment_mode === 'driver_pays'
            ? `💵 المندوب هيدفع ${o.collect_amount} ج.م لـ${vendorNoun(o.vendor_type)}، ويحصلها منك كاش عند التوصيل`
            : '✅ الأوردر متدفوع بالفعل — هتدفع رسوم التوصيل بس'}
        </p>
      )}

      {/* address */}
      <div className="card p-4 mb-4 flex items-start gap-3">
        <span className="w-9 h-9 rounded-md bg-sea/10 text-sea grid place-items-center shrink-0"><Icon name="locationDot" className="w-4 h-4" /></span>
        <div>
          <p className="font-semibold text-sm">{o.zone}</p>
          <p className="text-sm text-mist">وحدة {o.unit_number}{o.address_notes ? ` — ${o.address_notes}` : ''}</p>
        </div>
      </div>

      {/* payment
          Two bugs lived in these four lines.
          1. After a COD deposit is paid, admin_confirm_cod_deposit moves the
             order to 'pending' but leaves payment_method='cod' and
             cod_deposit_amount set -- so this printed the FULL total as
             "كاش عند الاستلام". On a 1215 order with a 607.50 deposit already
             paid, the customer was told to have 1215 at the door while the
             driver's screen said 607.50. Two people, one doorway, 607.50 apart.
          2. An unquoted pharmacy basket has total = the delivery fee alone, so
             a 400 ج.م order announced "65 ج.م — كاش عند الاستلام", directly
             contradicting the قيد التسعير line further down the same page. */}
      <div className="card p-4 mb-4">
        {o.pricing_status === 'pending_quote' && !isCancelled(o.status) && !cancelled ? (
          <div>
            {/* An open-ended wait with no number attached is the worst kind.
                "خلال ١٠ دقايق" gives it an end, and gives you something to
                measure the vendor against. */}
            <p className="font-semibold text-sm">📞 هنتصل بيك خلال ١٠ دقايق</p>
            <p className="text-sm text-mist mt-0.5">
              بنراجع طلبك دلوقتي ونحسب السعر. مفيش دفع لحد ما توافق.
            </p>
            <div className="flex justify-between text-xs text-mist mt-2.5 pt-2.5 border-t border-line">
              <span>التوصيل (مؤكد)</span><span>{o.delivery_fee} ج.م</span>
            </div>
            <div className="flex justify-between text-xs text-mist mt-1">
              <span>الأصناف</span><span>بالمكالمة</span>
            </div>

            {errFor('extra') && (
              <p className="text-xs text-red-600 bg-red-500/10 rounded-xl p-2.5 mt-3">{errFor('extra')}</p>
            )}

            {addingItem ? (
              <div className="flex gap-2 mt-3">
                <input className="field flex-1 !h-10 text-sm" value={extraItem} autoFocus
                  onChange={e => setExtraItem(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addForgottenItem() } }}
                  placeholder="مثال: لبن" />
                <button className="btn-sea !py-2 !px-4 text-sm shrink-0"
                  disabled={!extraItem.trim() || extraSaving} onClick={addForgottenItem}>
                  {extraSaving ? '…' : 'ضيف'}
                </button>
              </div>
            ) : (
              <button className="btn-ghost w-full !py-2.5 text-sm mt-3" onClick={() => setAddingItem(true)}>
                + نسيت صنف
              </button>
            )}
          </div>
        ) : (isCancelled(o.status) || cancelled) && o.pricing_status === 'pending_quote' ? (
          // Gating the quote panel on "not cancelled" pushed this case into the
          // else branch below, which prints an amount due -- and an unpriced
          // order's total is the delivery fee alone. A cancelled pharmacy
          // basket announced "65 ج.م — كاش عند الاستلام" underneath its own
          // cancellation banner. Nothing is owed on a cancelled unpriced order.
          <div>
            <p className="font-semibold text-sm">الطلب اتلغى</p>
            <p className="text-sm text-mist mt-0.5">مفيش أي مبلغ مستحق.</p>
          </div>
        ) : (
          <div>
            <p className="font-semibold text-sm">
              {o.cod_deposit_amount != null && o.payment_method === 'cod'
                ? `${Math.round((o.total - o.cod_deposit_amount) * 100) / 100} ج.م`
                : `${o.total} ج.م`}
            </p>
            <p className="text-sm text-mist">
              {o.payment_method === 'online' ? 'مدفوع أونلاين'
                : o.payment_method === 'instapay' ? 'مدفوع InstaPay'
                : o.cod_deposit_amount != null
                  ? `كاش عند الاستلام · العربون ${o.cod_deposit_amount} ج.م مدفوع`
                  : 'كاش عند الاستلام'}
            </p>
          </div>
        )}
      </div>

      {o.status !== 'Cancelled' && data.assignment
        && (data.assignment.status === 'Picked_Up' || data.assignment.status === 'Out_for_Delivery')
        && data.assignment.driver_lat != null && data.assignment.driver_lng != null
        && o.dest_lat != null && o.dest_lng != null && (
        <div className="mb-4">
          <LiveMap
            driverLat={data.assignment.driver_lat} driverLng={data.assignment.driver_lng}
            destLat={o.dest_lat} destLng={o.dest_lng}
            driverUpdatedAt={data.assignment.driver_location_updated_at}
          />
        </div>
      )}

      {o.status !== 'Cancelled' && current !== 'Delivered' && data.assignment?.driver_name && (
        <div className="card p-4 mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-mist mb-0.5">المندوب</p>
            <span className="font-semibold text-sm">🛵 {data.assignment.driver_name}</span>
          </div>
          {data.assignment.driver_phone && (
            <a className="btn-ghost !py-1.5 !px-3 text-sm" dir="ltr" href={`tel:${data.assignment.driver_phone}`}>
              اتصال
            </a>
          )}
        </div>
      )}

      {/* items */}
      <div className="card p-4 mb-4">
        {o.order_type === 'custom_request' ? (
          <div className="space-y-2">
            {(o.request_items ?? []).map((it, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="w-6 h-6 rounded-full bg-shellup grid place-items-center text-xs font-bold shrink-0">{it.qty}</span>
                <span>{it.name}</span>
              </div>
            ))}
            {o.request_notes && <p className="text-sm text-mist italic mt-1">"{o.request_notes}"</p>}
            <Adjustments items={data.items} />
          </div>
        ) : o.order_type === 'pickup_request' ? (
          <>
            {o.request_notes && <p className="text-sm text-mist italic">"{o.request_notes}"</p>}
            <Adjustments items={data.items} />
          </>
        ) : (
          <div className="space-y-2">
            {data.items.map((it, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                {it.image_url ? (
                  <img src={it.image_url} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0 border border-line" />
                ) : (
                  <span className="w-6 h-6 rounded-full bg-shellup grid place-items-center text-xs font-bold shrink-0">{it.qty}</span>
                )}
                {/* The vendor screen has always shown these; the person paying
                    for them did not. Two برجر lines at 75 and 130 with nothing
                    saying why is the receipt someone disputes. */}
                <span className="flex-1 min-w-0">
                  <span className="block">{it.image_url ? `${it.name} × ${it.qty}` : it.name}</span>
                  {(it.combo_name || it.size_name || (it.addon_names && it.addon_names.length > 0)) && (
                    <span className="block text-xs text-mist mt-0.5">
                      {[it.combo_name && `🍟 كومبو ${it.combo_name}`, it.size_name, ...(it.addon_names ?? [])].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
                <span className="text-mist shrink-0">{it.total} ج.م</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* order summary */}
      <div className="card p-4 mb-4 space-y-2">
        <div className="flex items-center justify-between text-sm pb-2 border-b border-line">
          <span className="text-mist">رقم الطلب</span>
          <button className="font-semibold flex items-center gap-1.5" onClick={copyOrderNumber}>
            #{o.id} <span className="text-xs text-mist">{copied ? '✅ اتنسخ' : <Icon name="clone" className="w-3.5 h-3.5" />}</span>
          </button>
        </div>
        {o.pricing_status !== 'pending_quote' && (
          <div className="flex justify-between text-sm"><span className="text-mist">المنتجات</span><span>{o.subtotal} ج.م</span></div>
        )}
        <div className="flex justify-between text-sm"><span className="text-mist">التوصيل</span><span>{o.delivery_fee} ج.م</span></div>
        {o.service_fee > 0 && (
          <div className="flex justify-between text-sm"><span className="text-mist">رسوم الخدمة</span><span>{o.service_fee} ج.م</span></div>
        )}
        {o.wallet_used > 0 && (
          <div className="flex justify-between text-sm text-emerald-700"><span>من رصيدك</span><span>-{o.wallet_used} ج.م</span></div>
        )}
        <div className="flex justify-between font-bold pt-2 border-t border-line">
          <span>الإجمالي</span>
          <span className="text-sea">{o.pricing_status === 'pending_quote' ? 'قيد التسعير' : `${o.total} ج.م`}</span>
        </div>
      </div>

      {/* The one moment the app has earned the right to ask for a home-screen
          slot: the food just arrived. It used to ask on every route from the
          first second of the first visit, including checkout. */}
      {current === 'Delivered' && (
        <div className="mb-4"><InstallPrompt /></div>
      )}

      {current === 'Delivered' && !ratingSent && !o.rating_submitted && (
        <div className="card p-4 mb-4">
          <p className="text-sm font-semibold mb-3">قيّم تجربتك (اختياري)</p>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-mist">المندوب</span>
              <div className="flex gap-1">
                {[1,2,3,4,5].map(n => (
                  <button key={n} onClick={() => setDriverRating(n)} aria-label={`${n} من 5`}
                    className={`grid place-items-center min-w-[44px] min-h-[44px] ${n <= driverRating ? 'text-sand' : 'text-mist/40'}`}>
                    <Icon name="star" className="w-4.5 h-4.5" />
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-mist">{vendorNoun(o.vendor_type)}</span>
              <div className="flex gap-1">
                {[1,2,3,4,5].map(n => (
                  <button key={n} onClick={() => setRestaurantRating(n)} aria-label={`${n} من 5`}
                    className={`grid place-items-center min-w-[44px] min-h-[44px] ${n <= restaurantRating ? 'text-sand' : 'text-mist/40'}`}>
                    <Icon name="star" className="w-4.5 h-4.5" />
                  </button>
                ))}
              </div>
            </div>
          </div>
          {errFor('rating') && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-2">{errFor('rating')}</p>}
          <button className="btn-sea w-full mt-3 text-sm" disabled={!driverRating && !restaurantRating} onClick={sendRating}>إرسال التقييم</button>
        </div>
      )}
      {o.rating_submitted && !ratingSent && (
        <p className="text-emerald-700 text-sm text-center mb-4">✅ شكرًا، تقييم الطلب مسجّل</p>
      )}
      {ratingSent && !showTipPrompt && <p className="text-emerald-700 text-sm text-center mb-4">✅ شكرًا لتقييمك</p>}

      {showTipPrompt && !tipSent && data.assignment?.driver_instapay && (
        <div className="card p-4 mb-4">
          <p className="text-sm font-semibold mb-1">حابب تكرّم المندوب؟ 🙏</p>
          <p className="text-xs text-mist mb-3">التحويل مباشر للمندوب خارج سالكة. سالكة لا تستلم المبلغ ولا تؤكد وصوله.</p>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[10, 20, 50].map(amt => (
              <button key={amt} className={`text-sm font-semibold py-2.5 rounded-xl border-2 ${tipAmount === amt ? 'border-sea bg-sea/5 text-sea' : 'border-line text-mist'}`}
                onClick={() => { setTipAmount(amt); setCustomTip('') }}>{amt} ج.م</button>
            ))}
            <input className={`text-sm text-center rounded-xl border-2 ${tipAmount === null && customTip ? 'border-sea' : 'border-line'}`}
              placeholder="تاني" inputMode="numeric" value={customTip}
              onChange={e => { setCustomTip(e.target.value.replace(/\D/g, '')); setTipAmount(null) }} />
          </div>
          {(tipAmount || Number(customTip) > 0) && data.assignment?.driver_instapay && (
            <div className="bg-sea/10 rounded-xl p-3 mb-3 text-center">
              <p className="text-xs text-mist mb-1">حوّل على رقم إنستاباي بتاع {data.assignment.driver_name}</p>
              <p className="font-bold text-sea" dir="ltr">{data.assignment.driver_instapay}</p>
            </div>
          )}
          {errFor('tip') && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-2">{errFor('tip')}</p>}
          <div className="flex gap-2">
            <button className="btn-ghost flex-1 text-sm" onClick={() => setShowTipPrompt(false)}>لأ شكرًا</button>
            <button className="btn-sea flex-1 text-sm" disabled={!tipAmount && !(Number(customTip) > 0)} onClick={sendTip}>أبلغت إني حوّلت</button>
          </div>
        </div>
      )}
      {tipSent && <p className="text-emerald-700 text-sm text-center mb-4">✅ تم إبلاغ المندوب — يراجع إنستاباي للتأكيد</p>}

      {canCancel && (
        <>
          {errFor('cancel') && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-2">{errFor('cancel')}</p>}
          <button className="btn-danger w-full mb-2" disabled={cancelling} onClick={() => setCancelPickerOpen(true)}>
            {cancelling ? 'جاري الإلغاء…' : 'إلغاء الطلب'}
          </button>
        </>
      )}
      {canCancel && <p className="text-center text-xs text-mist mb-4">تقدر تلغي الطلب طول ما لسه قيد الانتظار</p>}

      {/* The login ask for in-app-browser traffic, moved here from the arrival
          card in App.tsx -- see lib/inAppBrowser.ts for why it cannot live
          there. Renders nothing for signed-in customers, for anyone who has
          dismissed it once, and for every normal browser. Placed after the
          order state and before the complaint link on purpose: it is an offer,
          so it must not sit above the thing the customer opened this page for. */}
      <InAppLoginPrompt className="mb-4" />

      {complaintSent ? (
        <p className="text-sandink text-sm text-center mb-4">✅ تم إرسال الشكوى — هنراجعها قريب</p>
      ) : complaining ? (
        <div className="card p-4 mb-4">
          <p className="text-sm font-semibold mb-2">إيه المشكلة؟</p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {([
              ['missing_item', '📦 نقص صنف'],
              ['wrong_item', '❌ صنف غلط'],
              ['driver_conduct', '🛵 مشكلة مع المندوب'],
              ['quality', '👎 جودة الطلب'],
              ['other', '❓ حاجة تانية'],
            ] as const).map(([val, label]) => (
              <button key={val} type="button"
                className={`text-xs py-2 rounded-lg border-2 ${complaintCategory === val ? 'border-sea bg-sea/5' : 'border-line'}`}
                onClick={() => setComplaintCategory(val)}>{label}</button>
            ))}
          </div>
          <textarea className="field h-20 resize-none" value={complaintText} onChange={e => setComplaintText(e.target.value)} placeholder="مثال: نقص صنف من الطلب" />
          {errFor('complaint') && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-2">{errFor('complaint')}</p>}
          <div className="flex gap-2.5 mt-2.5">
            <button className="btn-ghost flex-1 text-sm" onClick={() => setComplaining(false)}>إلغاء</button>
            <button className="btn-danger flex-1 text-sm" disabled={!complaintText.trim()} onClick={sendComplaint}>إرسال</button>
          </div>
        </div>
      ) : !isCancelled(o.status) && !cancelled ? (
        <button className="text-red-600 text-sm underline block mx-auto mb-4" onClick={() => setComplaining(true)}>في مشكلة في الطلب؟</button>
      ) : null}

      {/* Both of these belong to an order that is still happening.
          On a CANCELLED order they are noise at best: "في مشكلة في الطلب؟" invites
          a complaint about an order nobody is working on, and the auto-refresh
          notice promises live updates for something whose state will never
          change again. It was also the only remaining line of technical
          plumbing shown to a customer -- how often the page polls is our
          problem, not theirs. */}
      {!isCancelled(o.status) && !cancelled && o.status !== 'Delivered' && (
        <p className="text-center text-xs text-mist">الصفحة بتتحدث تلقائياً</p>
      )}
    </div>
  )
}

function CancelReasonSheet({ busy, onClose, onConfirm }: {
  busy: boolean
  onClose: () => void
  onConfirm: (reason: CustomerCancelReason) => void
}) {
  const [reason, setReason] = useState<CustomerCancelReason | null>(null)
  const ref = useDismissable<HTMLDivElement>(onClose)

  return (
    <div className="fixed inset-0 z-50 bg-black/50 grid place-items-end sm:place-items-center"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="cancel-reason-title"
        className="card w-full sm:max-w-sm p-5 rounded-b-none sm:rounded-2xl">
        <h2 id="cancel-reason-title" className="font-bold text-lg">ليه عايز تلغي الطلب؟</h2>
        <p className="text-xs text-mist mt-1 mb-4">اختار السبب عشان نعرف نصلّح المشكلة.</p>

        <div className="space-y-2">
          {CUSTOMER_CANCEL_REASONS.map(item => (
            <label key={item.code}
              className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-3 cursor-pointer ${
                reason === item.code ? 'border-red-500 bg-red-500/5' : 'border-line'
              }`}>
              <input type="radio" name="cancel-reason" value={item.code}
                checked={reason === item.code}
                onChange={() => setReason(item.code)}
                className="accent-red-600 w-4 h-4 shrink-0" />
              <span className="text-sm font-medium">{item.label}</span>
            </label>
          ))}
        </div>

        <div className="flex gap-2 mt-4">
          <button className="btn bg-red-600 text-white hover:bg-red-700 flex-1"
            disabled={!reason || busy}
            onClick={() => reason && onConfirm(reason)}>
            {busy ? 'جاري الإلغاء…' : 'تأكيد إلغاء الطلب'}
          </button>
          <button className="btn-ghost" disabled={busy} onClick={onClose}>رجوع</button>
        </div>
      </div>
    </div>
  )
}


/**
 * Admin price adjustments, shown on EVERY order type.
 *
 * The catalog branch above already lists order_items, so adjustments appear
 * there for free. Custom and pickup orders render request_items instead and
 * would have shown nothing at all -- meaning a customer on a pharmacy order
 * could be charged a corrected price with no line anywhere explaining it. Those
 * are exactly the orders priced by hand, so they are the ones most likely to be
 * corrected later. A charge the customer cannot identify is worse than one they
 * can argue with.
 */
function Adjustments({ items }: { items: { name: string; total: number; is_adjustment?: boolean }[] }) {
  const rows = (items ?? []).filter(i => i.is_adjustment)
  if (!rows.length) return null
  return (
    <div className="mt-2 pt-2 border-t border-line space-y-1.5">
      {rows.map((it, i) => (
        <div key={i} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-mist">{it.name}</span>
          <span className={`font-semibold ${Number(it.total) < 0 ? 'text-emerald-700' : 'text-foam'}`}>
            {Number(it.total) > 0 ? '+' : ''}{it.total} ج.م
          </span>
        </div>
      ))}
    </div>
  )
}
