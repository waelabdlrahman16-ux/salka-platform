import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { registerPush } from '../lib/push'
import { INSTAPAY_QR_URL, INSTAPAY_LINK } from '../lib/instapay'
import LiveMap from '../components/LiveMap'
import Icon from '../components/Icon'

const STAGES = [
  { key: 'placed', label: 'قيد التجهيز', statuses: ['pending', 'Accepted'] },
  { key: 'onway', label: 'في الطريق إليك', statuses: ['Picked_Up', 'Out_for_Delivery'] },
  { key: 'delivered', label: 'تم التوصيل', statuses: ['Delivered'] },
]

interface TrackData {
  order: {
    id: number; status: string; subtotal: number; delivery_fee: number; service_fee: number; wallet_used: number; total: number
    zone: string; unit_number: string; address_notes: string; restaurant_name: string
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
    instapay_claimed: boolean
  } | null
  items: { name: string; qty: number; total: number; image_url: string | null }[]
  assignment: {
    status: string; driver_name: string | null; driver_phone: string | null
    driver_lat: number | null; driver_lng: number | null; driver_location_updated_at: string | null
  } | null
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' })
}

export default function Track() {
  const { token } = useParams()
  const [data, setData] = useState<TrackData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const [driverRating, setDriverRating] = useState(0)
  const [restaurantRating, setRestaurantRating] = useState(0)
  const [ratingSent, setRatingSent] = useState(false)
  const [complaining, setComplaining] = useState(false)
  const [complaintText, setComplaintText] = useState('')
  const [complaintSent, setComplaintSent] = useState(false)
  const [repaying, setRepaying] = useState(false)
  const [claimingPayment, setClaimingPayment] = useState(false)
  const [copied, setCopied] = useState(false)

  async function retryPayment() {
    if (!data?.order) return
    setRepaying(true)
    const { data: fw, error } = await supabase.functions.invoke('fawaterak-create-invoice', {
      body: { order_id: data.order.id }
    })
    setRepaying(false)
    if (error || !fw?.url) { alert('حصل خطأ، جرب تاني'); return }
    window.location.href = fw.url
  }

  async function claimInstapayPayment() {
    if (!token) return
    setClaimingPayment(true)
    await supabase.rpc('mark_instapay_claimed', { p_token: token })
    setClaimingPayment(false)
    load()
  }

  async function load() {
    const { data: res, error } = await supabase.rpc('track_order', { p_token: token })
    if (error || !res || !(res as TrackData).order) { setNotFound(true); return }
    setData(res as TrackData)
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [token])

  useEffect(() => {
    if (!token) return
    registerPush(pushToken => {
      supabase.rpc('save_customer_push_token', { p_token: token, p_push_token: pushToken })
    })
  }, [token])

  async function sendRating() {
    if (!token || (!driverRating && !restaurantRating)) return
    await supabase.rpc('submit_rating', {
      p_token: token, p_driver_rating: driverRating || null, p_restaurant_rating: restaurantRating || null
    })
    setRatingSent(true)
  }

  async function sendComplaint() {
    if (!token || !complaintText.trim()) return
    await supabase.rpc('submit_complaint', { p_token: token, p_description: complaintText.trim() })
    setComplaintSent(true); setComplaining(false)
  }

  async function cancelOrder() {
    if (!data?.order || !confirm('تأكيد إلغاء الطلب؟')) return
    setCancelling(true)
    const { error } = await supabase.rpc('cancel_order', { p_order_id: data.order.id, p_reason: 'customer_cancelled', p_token: token })
    setCancelling(false)
    if (error) { alert('الطلب بدأ تجهيزه بالفعل، محدش يقدر يلغيه غير الإدارة'); return }
    setCancelled(true)
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
  if (!data || !data.order) return <p className="text-mist">جاري التحميل…</p>

  const o = data.order

  if (o.status === 'awaiting_payment' && o.payment_method === 'instapay') {
    return (
      <div className="max-w-lg mx-auto">
        <Link to="/" className="text-sm text-mist hover:text-foam">← العودة للرئيسية</Link>
        <div className="card p-4 mt-3 text-center">
          <h1 className="font-bold text-lg mb-1">حوّل المبلغ على InstaPay</h1>
          <p className="text-mist text-sm mb-3">طلب #{o.id} من {o.restaurant_name}</p>
          <p className="text-sea font-bold text-2xl mb-4">{o.total} ج.م</p>

          {INSTAPAY_QR_URL && (
            <img src={INSTAPAY_QR_URL} alt="InstaPay QR" className="w-44 h-44 mx-auto mb-4 rounded-xl border border-line" />
          )}

          <a href={INSTAPAY_LINK} target="_blank" rel="noreferrer" className="btn-sea w-full !flex items-center justify-center text-center mb-4">
            افتح InstaPay وحوّل مباشرة
          </a>

          {o.instapay_claimed ? (
            <p className="text-sm text-mist">
              تمام، إحنا بنراجع التحويل دلوقتي. الطلب هيتأكد خلال دقايق.
            </p>
          ) : (
            <button className="btn-sea w-full" disabled={claimingPayment} onClick={claimInstapayPayment}>
              {claimingPayment ? 'جاري التأكيد…' : 'حوّلت المبلغ ✓'}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (o.status === 'awaiting_payment') {
    return (
      <div className="max-w-lg mx-auto">
        <Link to="/" className="text-sm text-mist hover:text-foam">← العودة للرئيسية</Link>
        <div className="card p-4 mt-3 text-center">
          <p className="text-4xl mb-3">💳</p>
          <h1 className="font-bold text-lg mb-1">بننتظر تأكيد الدفع</h1>
          <p className="text-mist text-sm mb-1">طلب #{o.id} من {o.restaurant_name}</p>
          <p className="text-sea font-bold text-xl my-3">{o.total} ج.م</p>
          <p className="text-mist text-sm mb-4">
            لو خرجت من صفحة الدفع قبل ما تكمل، اضغط تحت وكمّل الدفع
          </p>
          <button className="btn-sea w-full" disabled={repaying} onClick={retryPayment}>
            {repaying ? 'جاري الفتح…' : 'كمّل الدفع'}
          </button>
        </div>
      </div>
    )
  }

  const current = data.assignment?.status && data.assignment.status !== 'Offered' ? data.assignment.status : 'pending'
  const stageIdx = Math.max(0, STAGES.findIndex(s => s.statuses.includes(current)))
  const canCancel = current === 'pending' && !cancelled && !isCancelled(o.status)

  return (
    <div className="max-w-lg mx-auto pb-6">
      <div className="flex items-center justify-between mb-3">
        <Link to="/" className="text-sm text-mist hover:text-foam">← العودة</Link>
        <span className="text-sm font-semibold text-mist">طلب #{o.id}</span>
      </div>

      {isCancelled(o.status) || cancelled ? (
        <div className="card p-4 text-center mb-4">
          <p className="text-4xl mb-2">📦</p>
          <h1 className="font-bold text-lg">تم إلغاء الطلب</h1>
        </div>
      ) : (
        <div className="card p-4 mb-4">
          <p className="text-xs text-mist mb-1">الحالة</p>
          <h1 className="font-bold text-xl mb-1">
            {current === 'Delivered' ? '✅ تم التوصيل' : STAGES[stageIdx]?.label ?? 'قيد التجهيز'}
          </h1>
          {o.ready_at && current === 'pending' && !o.scheduled_date && (
            <p className="text-sm text-mist">الوصول المتوقع {fmtTime(o.ready_at)}</p>
          )}
          {o.scheduled_date && <p className="text-sm text-mist">التوصيل خلال الفترة اللي اخترتها</p>}
          {o.sla_minutes && current !== 'Delivered' && !o.scheduled_date && (() => {
            const target = new Date(new Date(o.created_at).getTime() + o.sla_minutes * 60000)
            const isLate = Date.now() > target.getTime()
            return (
              <p className={`text-sm mt-1 flex items-center gap-1 ${isLate ? 'text-sand' : 'text-mist'}`}>
                <Icon name="clock" className="w-3.5 h-3.5" />
                {isLate ? 'اتأخر شوية عن الوقت المستهدف' : `الهدف: يوصلك قبل ${fmtTime(target.toISOString())}`}
              </p>
            )
          })()}

          <div className="flex gap-1.5 mt-4">
            {STAGES.map((s, i) => (
              <div key={s.key} className={`h-1.5 flex-1 rounded-full ${i <= stageIdx ? 'bg-sea' : 'bg-line'}`} />
            ))}
          </div>
        </div>
      )}

      {o.order_type === 'custom_request' && o.pricing_status === 'pending_quote' && (
        <p className="text-sm text-sand bg-sand/10 rounded-xl p-3 mb-4">
          💬 هنتصل بيك قريب نأكد السعر النهائي قبل ما نجهز الطلب
        </p>
      )}
      {o.order_type === 'pickup_request' && (
        <p className="text-sm bg-shellup/60 rounded-xl p-3 mb-4">
          {o.payment_mode === 'driver_pays'
            ? `💵 المندوب هيدفع ${o.collect_amount} ج.م للمطعم، ويحصلها منك كاش عند التوصيل`
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

      {/* payment */}
      <div className="card p-4 mb-4 flex items-center gap-3">
        <span className={`w-9 h-9 rounded-md grid place-items-center shrink-0 ${o.payment_method === 'instapay' ? 'bg-sand/15 text-sand' : 'bg-sea/10 text-sea'}`}>
          <Icon name={o.payment_method === 'instapay' ? 'mobileScreen' : 'moneyBill'} className="w-4.5 h-4.5" />
        </span>
        <div>
          <p className="font-semibold text-sm">{o.total} ج.م</p>
          <p className="text-sm text-mist">
            {o.payment_method === 'online' ? 'مدفوع أونلاين'
              : o.payment_method === 'instapay' ? 'مدفوع InstaPay'
              : 'كاش عند الاستلام'}
          </p>
        </div>
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
          </div>
        ) : o.order_type === 'pickup_request' ? (
          o.request_notes && <p className="text-sm text-mist italic">"{o.request_notes}"</p>
        ) : (
          <div className="space-y-2">
            {data.items.map((it, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                {it.image_url ? (
                  <img src={it.image_url} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0 border border-line" />
                ) : (
                  <span className="w-6 h-6 rounded-full bg-shellup grid place-items-center text-xs font-bold shrink-0">{it.qty}</span>
                )}
                <span className="flex-1">{it.image_url ? `${it.name} × ${it.qty}` : it.name}</span>
                <span className="text-mist">{it.total} ج.م</span>
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

      {current === 'Delivered' && !ratingSent && (
        <div className="card p-4 mb-4">
          <p className="text-sm font-semibold mb-3">قيّم تجربتك (اختياري)</p>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-mist">المندوب</span>
              <div className="flex gap-1">
                {[1,2,3,4,5].map(n => (
                  <button key={n} onClick={() => setDriverRating(n)} className={n <= driverRating ? 'text-sand' : 'text-line'}><Icon name="star" className="w-4.5 h-4.5" /></button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-mist">المطعم</span>
              <div className="flex gap-1">
                {[1,2,3,4,5].map(n => (
                  <button key={n} onClick={() => setRestaurantRating(n)} className={n <= restaurantRating ? 'text-sand' : 'text-line'}><Icon name="star" className="w-4.5 h-4.5" /></button>
                ))}
              </div>
            </div>
          </div>
          <button className="btn-sea w-full mt-3 text-sm" disabled={!driverRating && !restaurantRating} onClick={sendRating}>إرسال التقييم</button>
        </div>
      )}
      {ratingSent && <p className="text-emerald-700 text-sm text-center mb-4">✅ شكرًا لتقييمك</p>}

      {canCancel && (
        <button className="btn-danger w-full mb-2" disabled={cancelling} onClick={cancelOrder}>
          {cancelling ? 'جاري الإلغاء…' : 'إلغاء الطلب'}
        </button>
      )}
      {canCancel && <p className="text-center text-xs text-mist mb-4">تقدر تلغي الطلب طول ما لسه قيد الانتظار</p>}

      {complaintSent ? (
        <p className="text-sand text-sm text-center mb-4">✅ تم إرسال الشكوى — هنراجعها قريب</p>
      ) : complaining ? (
        <div className="card p-4 mb-4">
          <p className="text-sm font-semibold mb-2">إيه المشكلة؟</p>
          <textarea className="field h-20 resize-none" value={complaintText} onChange={e => setComplaintText(e.target.value)} placeholder="مثال: نقص صنف من الطلب" />
          <div className="flex gap-2.5 mt-2.5">
            <button className="btn-ghost flex-1 text-sm" onClick={() => setComplaining(false)}>إلغاء</button>
            <button className="btn-danger flex-1 text-sm" disabled={!complaintText.trim()} onClick={sendComplaint}>إرسال</button>
          </div>
        </div>
      ) : (
        <button className="text-red-600 text-sm underline block mx-auto mb-4" onClick={() => setComplaining(true)}>في مشكلة في الطلب؟</button>
      )}

      <p className="text-center text-xs text-mist">الصفحة بتتحدث تلقائياً كل 10 ثواني</p>
    </div>
  )
}

function isCancelled(status: string) {
  return status === 'Cancelled'
}
