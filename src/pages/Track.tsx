import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const STEPS = [
  { key: 'pending', label: 'قيد الانتظار' },
  { key: 'Accepted', label: 'المندوب في الطريق للمطعم' },
  { key: 'Picked_Up', label: 'تم استلام الطلب' },
  { key: 'Out_for_Delivery', label: 'في الطريق إليك' },
  { key: 'Delivered', label: 'تم التوصيل' },
]

interface TrackData {
  order: {
    id: number; status: string; subtotal: number; delivery_fee: number; total: number
    zone: string; unit_number: string; address_notes: string; restaurant_name: string
    ready_at: string | null; scheduled_date: string | null
  } | null
  items: { name: string; qty: number; total: number }[]
  assignment: { status: string; driver_name: string | null; driver_phone: string | null } | null
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
    const { error } = await supabase.rpc('cancel_order', { p_order_id: data.order.id, p_reason: 'customer_cancelled' })
    setCancelling(false)
    if (error) { alert('الطلب بدأ تجهيزه بالفعل، محدش يقدر يلغيه غير الإدارة'); return }
    setCancelled(true)
  }

  if (notFound) return (
    <div className="card p-6 text-center max-w-sm mx-auto">
      <p className="font-semibold">الطلب غير موجود</p>
      <Link className="text-sea text-sm mt-2 inline-block" to="/">العودة للرئيسية</Link>
    </div>
  )
  if (!data || !data.order) return <p className="text-mist">جاري التحميل…</p>

  const o = data.order
  const current = data.assignment?.status && data.assignment.status !== 'Offered' ? data.assignment.status : 'pending'
  const activeIdx = Math.max(0, STEPS.findIndex(s => s.key === current))
  const canCancel = current === 'pending' && !cancelled

  return (
    <div className="max-w-lg mx-auto">
      <Link to="/" className="text-sm text-mist hover:text-foam">← العودة للرئيسية</Link>
      <div className="card p-5 mt-3">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-bold text-lg">تتبع الطلب #{o.id}</h1>
            <p className="text-sm text-mist mt-0.5">من {o.restaurant_name}</p>
          </div>
          <span className="font-bold text-sea">{o.total} ج.م</span>
        </div>

        {cancelled && (
          <div className="mt-4 bg-red-500/10 border border-red-400/40 rounded-xl p-3 text-center text-red-600 text-sm">
            تم إلغاء الطلب
          </div>
        )}

        {canCancel && (
          <button className="btn-danger w-full mt-4" disabled={cancelling} onClick={cancelOrder}>
            {cancelling ? 'جاري الإلغاء…' : 'إلغاء الطلب'}
          </button>
        )}

        {o.ready_at && current === 'pending' && !cancelled && (
          <p className="text-sm text-mist mt-2">
            {(() => {
              const mins = Math.round((+new Date(o.ready_at) - Date.now()) / 60000)
              if (o.scheduled_date) {
                return `⏱ التوصيل خلال الفترة اللي اخترتها`
              }
              return mins > 0 ? `⏱ متوقع يجهز خلال ${mins} دقيقة` : '⏱ جاري التحضير الآن'
            })()}
          </p>
        )}

        <div className="mt-5">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-4 h-4 rounded-full border-2 ${i <= activeIdx ? 'bg-sea border-sea' : 'border-line'}`} />
                {i < STEPS.length - 1 && <div className={`w-0.5 h-8 ${i < activeIdx ? 'bg-sea' : 'bg-line'}`} />}
              </div>
              <p className={`text-sm -mt-0.5 ${i <= activeIdx ? 'text-foam font-semibold' : 'text-mist'}`}>{s.label}</p>
            </div>
          ))}
        </div>

        {data.assignment?.driver_name && (
          <div className="mt-4 bg-night border border-line rounded-xl p-4">
            <p className="text-sm text-mist">المندوب</p>
            <div className="flex items-center justify-between mt-1">
              <span className="font-semibold">🛵 {data.assignment.driver_name}</span>
              {data.assignment.driver_phone && (
                <a className="text-sea font-semibold" dir="ltr" href={`tel:${data.assignment.driver_phone}`}>
                  {data.assignment.driver_phone}
                </a>
              )}
            </div>
          </div>
        )}

        {current === 'Delivered' && !ratingSent && (
          <div className="mt-4 bg-night border border-line rounded-xl p-4">
            <p className="text-sm font-semibold mb-3">قيّم تجربتك (اختياري)</p>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-mist">المندوب</span>
                <div className="flex gap-1">
                  {[1,2,3,4,5].map(n => (
                    <button key={n} onClick={() => setDriverRating(n)} className={n <= driverRating ? 'text-sand' : 'text-line'}>★</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-mist">المطعم</span>
                <div className="flex gap-1">
                  {[1,2,3,4,5].map(n => (
                    <button key={n} onClick={() => setRestaurantRating(n)} className={n <= restaurantRating ? 'text-sand' : 'text-line'}>★</button>
                  ))}
                </div>
              </div>
            </div>
            <button className="btn-sea w-full mt-3 text-sm" disabled={!driverRating && !restaurantRating} onClick={sendRating}>إرسال التقييم</button>
          </div>
        )}
        {ratingSent && <p className="text-emerald-700 text-sm text-center mt-4">✅ شكرًا لتقييمك</p>}

        {complaintSent ? (
          <p className="text-sand text-sm text-center mt-4">✅ تم إرسال الشكوى — هنراجعها قريب</p>
        ) : complaining ? (
          <div className="mt-4 bg-night border border-line rounded-xl p-4">
            <p className="text-sm font-semibold mb-2">إيه المشكلة؟</p>
            <textarea className="field h-20 resize-none" value={complaintText} onChange={e => setComplaintText(e.target.value)} placeholder="مثال: نقص صنف من الطلب" />
            <div className="flex gap-2.5 mt-2.5">
              <button className="btn-ghost flex-1 text-sm" onClick={() => setComplaining(false)}>إلغاء</button>
              <button className="btn-danger flex-1 text-sm" disabled={!complaintText.trim()} onClick={sendComplaint}>إرسال</button>
            </div>
          </div>
        ) : (
          <button className="text-red-600 text-sm mt-4 underline" onClick={() => setComplaining(true)}>في مشكلة في الطلب؟</button>
        )}

        <div className="mt-4 border-t border-line pt-4 space-y-1.5">
          {data.items.map((it, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span>{it.name} × {it.qty}</span><span>{it.total} ج.م</span>
            </div>
          ))}
          <div className="flex justify-between text-sm text-mist"><span>التوصيل</span><span>{o.delivery_fee} ج.م</span></div>
        </div>

        <div className="mt-4 text-sm text-mist">
          📍 {o.zone} — وحدة {o.unit_number}{o.address_notes ? ` — ${o.address_notes}` : ''}
        </div>
      </div>
      <p className="text-center text-xs text-mist mt-3">الصفحة بتتحدث تلقائياً كل 10 ثواني</p>
    </div>
  )
}
