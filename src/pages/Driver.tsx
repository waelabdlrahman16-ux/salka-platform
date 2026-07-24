import { useEffect, useState } from 'react'
import { supabase, DELIVERY_FEE, DRIVER_EARNING, ADMIN_AMOUNT } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { ping, askNotificationPermission } from '../lib/notify'
import type { Assignment, Driver, Shift, SwapRequest } from '../lib/types'

interface PoolOrder {
  id: number; total: number; zone: string
  kitchen_status: string; restaurant_name: string; created_at: string
}

export default function DriverPage() {
  const { profile } = useAuth()
  const id = profile?.driver_id
  const [driver, setDriver] = useState<Driver | null>(null)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [rejecting, setRejecting] = useState<Assignment | null>(null)
  const [reason, setReason] = useState('')
  const [pool, setPool] = useState<PoolOrder[]>([])
  const [claiming, setClaiming] = useState<number | null>(null)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [swaps, setSwaps] = useState<SwapRequest[]>([])
  const [myOpenRequests, setMyOpenRequests] = useState<Map<number, number>>(new Map())
  const [swapReason, setSwapReason] = useState<Record<number, string>>({})

  async function load() {
    if (!id) return
    const { data: d } = await supabase.from('drivers').select('*').eq('id', id).single()
    setDriver(d)
    const { data: a } = await supabase.from('delivery_assignments')
      .select('*, orders(*, restaurants(name))').eq('driver_id', id)
      .in('status', ['Offered', 'Accepted', 'Picked_Up', 'Out_for_Delivery', 'Delivered'])
      .order('id', { ascending: false }).limit(20)
    setAssignments(a ?? [])
    const { data: p } = await supabase.rpc('available_orders')
    setPool((p as PoolOrder[]) ?? [])

    const today = new Date().toISOString().slice(0, 10)
    const { data: sh } = await supabase.from('shifts').select('*')
      .eq('driver_id', id).gte('shift_date', today)
      .neq('status', 'cancelled').order('shift_date').limit(10)
    setShifts(sh ?? [])

    const { data: sw } = await supabase.rpc('open_swaps')
    setSwaps((sw as SwapRequest[]) ?? [])

    const { data: mine } = await supabase.from('shift_swap_requests')
      .select('id, shift_id').eq('requested_by', id).eq('status', 'open')
    setMyOpenRequests(new Map((mine ?? []).map((x: any) => [x.shift_id, x.id])))
    ping('pool', ((p as PoolOrder[]) ?? []).length, 'طلب متاح', 'في طلب جديد متاح للاستلام')
  }

  useEffect(() => {
    askNotificationPermission()
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [id])

  async function setStatus(a: Assignment, status: string, extra: Record<string, unknown> = {}) {
    if (!id) return
    await supabase.from('delivery_assignments').update({ status, ...extra }).eq('id', a.id)
    if (status === 'Accepted') {
      await supabase.from('drivers').update({ status: 'On_Delivery', available: false }).eq('id', id)
      await supabase.from('orders').update({ status: 'Accepted' }).eq('id', a.order_id)
    }
    if (status === 'Picked_Up') await supabase.from('orders').update({ status: 'Picked_Up' }).eq('id', a.order_id)
    if (status === 'Out_for_Delivery') await supabase.from('orders').update({ status: 'Out_for_Delivery' }).eq('id', a.order_id)
    if (status === 'Delivered') {
      await supabase.from('orders').update({ status: 'Delivered' }).eq('id', a.order_id)
      await supabase.from('driver_earnings').insert({
        driver_id: id, order_id: a.order_id, assignment_id: a.id,
        delivery_fee: DELIVERY_FEE, driver_earning: DRIVER_EARNING, admin_amount: ADMIN_AMOUNT
      })
      await supabase.from('drivers').update({
        status: 'Available', available: true,
        total_deliveries: (driver?.total_deliveries ?? 0) + 1
      }).eq('id', id)
    }
    load()
  }

  async function requestSwap(shiftId: number) {
    const { error } = await supabase.rpc('request_swap', {
      p_shift_id: shiftId, p_reason: swapReason[shiftId] || ''
    })
    if (error) alert('حصل خطأ، جرب تاني')
    load()
  }

  async function acceptSwap(requestId: number) {
    const { error } = await supabase.rpc('accept_swap', { p_request_id: requestId })
    if (error) alert(error.message.includes('unavailable') ? 'حد تاني سبقك' : 'حصل خطأ')
    load()
  }

  async function escalate(requestId: number) {
    await supabase.rpc('escalate_swap', { p_request_id: requestId })
    load()
  }

  async function claim(orderId: number) {
    setClaiming(orderId)
    const { error } = await supabase.rpc('claim_order', { p_order_id: orderId })
    setClaiming(null)
    if (error) {
      alert(error.message.includes('already_taken')
        ? 'الطلب اتاخد من مندوب تاني'
        : 'حصل خطأ، جرب تاني')
    }
    load()
  }

  async function reject() {
    if (!rejecting) return
    await supabase.from('delivery_assignments').update({
      status: 'Rejected', responded_at: new Date().toISOString(), rejection_reason: reason.trim()
    }).eq('id', rejecting.id)
    await supabase.from('orders').update({ status: 'pending' }).eq('id', rejecting.order_id)
    setRejecting(null); setReason(''); load()
  }

  if (!id) return <p className="text-mist text-center py-10">حسابك غير مرتبط بمندوب. تواصل مع الإدارة.</p>
  if (!driver) return <p className="text-mist">جاري التحميل…</p>

  const fmt = (t: string | null) => t ? new Date(t).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold">🛵 {driver.name}</h1>
          <p className="text-sm text-mist">★ {driver.rating} · {driver.total_deliveries} توصيلة</p>
        </div>
        <span className={driver.available ? 'badge-open' : 'badge-closed'}>{driver.status}</span>
      </div>

      {shifts.length > 0 && (
        <div className="mb-6">
          <h2 className="font-bold text-mist mb-3">ورديتك القادمة</h2>
          <div className="space-y-3">
            {shifts.map(sh => {
              const requested = myOpenRequests.has(sh.id)
      const myRequestId = myOpenRequests.get(sh.id)
              return (
                <div key={sh.id} className="card p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">
                        {new Date(sh.shift_date).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'numeric' })}
                      </p>
                      <p className="text-sm text-mist mt-0.5">{sh.start_time.slice(0,5)} — {sh.end_time.slice(0,5)}</p>
                    </div>
                    {sh.status === 'swapped' && <span className="badge-closed">اتبدلت</span>}
                  </div>

                  {sh.status === 'scheduled' && !requested && (
                    <div className="mt-3 flex gap-2">
                      <input className="field !py-1.5 text-sm" placeholder="سبب الاستبدال (اختياري)"
                        value={swapReason[sh.id] || ''}
                        onChange={e => setSwapReason({ ...swapReason, [sh.id]: e.target.value })} />
                      <button className="btn-ghost !py-1.5 text-sm shrink-0" onClick={() => requestSwap(sh.id)}>
                        طلب استبدال
                      </button>
                    </div>
                  )}
                  {requested && myRequestId && (
                    <div className="mt-3">
                      <p className="text-sand text-sm">⏳ طلب الاستبدال معروض على باقي المندوبين</p>
                      <button className="btn-danger w-full mt-2 text-sm"
                        onClick={() => escalate(myRequestId)}>
                        محدش وافق — بلّغ الإدارة
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {swaps.filter(s => !myOpenRequests.has(s.shift_id)).length > 0 && (
        <div className="mb-6">
          <h2 className="font-bold text-mist mb-3">ورديات محتاجة مندوب بديل</h2>
          <div className="space-y-3">
            {swaps.filter(s => !myOpenRequests.has(s.shift_id)).map(sw => (
              <div key={sw.request_id} className="card p-4 border-sand/40">
                <p className="font-semibold">
                  {new Date(sw.shift_date).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'numeric' })}
                  {' '}· {sw.start_time.slice(0,5)}–{sw.end_time.slice(0,5)}
                </p>
                <p className="text-sm text-mist mt-1">مطلوبة من {sw.requested_by_name}</p>
                {sw.reason && <p className="text-sm text-mist mt-0.5">"{sw.reason}"</p>}
                <button className="btn-sea w-full mt-3" onClick={() => acceptSwap(sw.request_id)}>
                  أقبل الوردية
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {pool.length > 0 && (
        <div className="mb-6">
          <h2 className="font-bold text-mist mb-3">طلبات متاحة — أول واحد يقبل ياخدها</h2>
          <div className="space-y-3">
            {pool.map(o => (
              <div key={o.id} className="card p-4 border-sea/40">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold">{o.restaurant_name}</h3>
                    <p className="text-sm text-mist mt-0.5">📍 {o.zone}</p>
                    <p className="text-xs text-mist mt-1">
                      {o.kitchen_status === 'ready' ? '✅ جاهز للاستلام'
                        : o.kitchen_status === 'preparing' ? '👨‍🍳 قيد التحضير' : '🕐 المطعم لسه ما بدأش'}
                    </p>
                  </div>
                  <span className="font-bold text-sea">{o.total} ج.م</span>
                </div>
                <button className="btn-sea w-full mt-3" disabled={claiming === o.id}
                  onClick={() => claim(o.id)}>
                  {claiming === o.id ? 'جاري القبول…' : 'أستلم الطلب'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {assignments.length === 0 && pool.length === 0 && <div className="card p-6 text-center text-mist">لا توجد طلبات حالياً</div>}

      <div className="space-y-4">
        {assignments.map(a => {
          const o = a.orders
          if (!o) return null
          return (
            <div key={a.id} className="card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-bold">طلب #{o.id} — {o.restaurants?.name}</h2>
                  <p className="text-sm text-mist mt-0.5">{o.total} ج.م · كاش عند الاستلام</p>
                </div>
                <span className="text-xs font-semibold bg-shellup rounded-full px-2.5 py-1">{a.status === 'Offered' ? 'عرض جديد' : a.status}</span>
              </div>

              <div className="mt-3 bg-night border border-line rounded-xl p-3.5 text-sm space-y-1.5">
                <p>👤 {o.customer_name}</p>
                <p>📍 {o.zone} — وحدة {o.unit_number}{o.address_notes ? ` — ${o.address_notes}` : ''}</p>
                <div className="flex gap-2 pt-1.5">
                  <a className="btn-ghost !py-1.5 text-sm flex-1 text-center" href={`tel:${o.customer_phone}`}>📞 اتصال</a>
                  <a className="btn-ghost !py-1.5 text-sm flex-1 text-center" href={`https://wa.me/${o.customer_phone.replace(/^0/, '20').replace('+', '')}`} target="_blank" rel="noreferrer">💬 واتساب</a>
                </div>
              </div>

              <div className="mt-3">
                {a.status === 'Offered' && (
                  <div className="flex gap-3">
                    <button className="btn-sea flex-1" onClick={() => setStatus(a, 'Accepted', { responded_at: new Date().toISOString() })}>قبول</button>
                    <button className="btn-danger flex-1" onClick={() => setRejecting(a)}>رفض</button>
                  </div>
                )}
                {a.status === 'Accepted' && <button className="btn-sea w-full" onClick={() => setStatus(a, 'Picked_Up', { picked_up_at: new Date().toISOString() })}>استلمت الطلب</button>}
                {a.status === 'Picked_Up' && <button className="btn-sea w-full" onClick={() => setStatus(a, 'Out_for_Delivery')}>خرجت للتوصيل</button>}
                {a.status === 'Out_for_Delivery' && <button className="btn-sea w-full" onClick={() => setStatus(a, 'Delivered', { delivered_at: new Date().toISOString() })}>تم التسليم</button>}
                {a.status === 'Delivered' && <p className="text-emerald-300 font-semibold text-center">✅ اكتمل — +{DRIVER_EARNING} ج.م</p>}
              </div>

              <div className="mt-2.5 text-xs text-mist flex flex-wrap gap-x-4 gap-y-1">
                {a.responded_at && <span>القبول: {fmt(a.responded_at)}</span>}
                {a.picked_up_at && <span>الاستلام: {fmt(a.picked_up_at)}</span>}
                {a.delivered_at && <span>التسليم: {fmt(a.delivered_at)}</span>}
              </div>
            </div>
          )
        })}
      </div>

      {rejecting && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => setRejecting(null)}>
          <div className="card w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-3">سبب الرفض</h3>
            <input className="field" value={reason} onChange={e => setReason(e.target.value)} placeholder="مثال: بعيد عن منطقتي" />
            <div className="flex gap-3 mt-4">
              <button className="btn-ghost flex-1" onClick={() => setRejecting(null)}>إلغاء</button>
              <button className="btn-danger flex-1" onClick={reject}>تأكيد الرفض</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
