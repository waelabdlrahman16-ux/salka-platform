import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { startRinging, stopRinging } from '../lib/ring'
import type { Order, OrderItem } from '../lib/types'

const KITCHEN = [
  { key: 'new', label: 'طلب جديد', next: 'preparing', action: 'قبول وبدء التحضير' },
  { key: 'preparing', label: 'قيد التحضير', next: 'ready', action: 'جاهز للاستلام' },
  { key: 'ready', label: 'جاهز', next: null, action: null },
]

export default function Vendor() {
  const { profile } = useAuth()
  const rid = profile?.restaurant_id
  const [orders, setOrders] = useState<Order[]>([])
  const [items, setItems] = useState<Record<number, OrderItem[]>>({})
  const [isOpen, setIsOpen] = useState(true)
  const [name, setName] = useState('')
  const [declining, setDeclining] = useState<Order | null>(null)
  const audioUnlocked = useRef(false)

  async function load() {
    if (!rid) return
    const { data: r } = await supabase.from('restaurants').select('name, is_open').eq('id', rid).single()
    if (r) { setIsOpen(r.is_open); setName(r.name) }
    const { data: o } = await supabase.from('orders').select('*')
      .eq('restaurant_id', rid).not('status', 'in', '("Delivered","Cancelled","Failed_Delivery")')
      .order('id', { ascending: false }).limit(30)
    setOrders(o ?? [])

    const hasNew = (o ?? []).some(x => (x.kitchen_status || 'new') === 'new')
    if (hasNew) startRinging(); else stopRinging()

    if (o?.length) {
      const { data: its } = await supabase.from('order_items').select('*')
        .in('order_id', o.map(x => x.id))
      const grouped: Record<number, OrderItem[]> = {}
      for (const it of its ?? []) (grouped[it.order_id] ??= []).push(it)
      setItems(grouped)
    }
  }

  useEffect(() => {
    // audio needs a user gesture to unlock on most mobile browsers
    const unlock = () => { audioUnlocked.current = true; document.removeEventListener('touchstart', unlock); document.removeEventListener('click', unlock) }
    document.addEventListener('touchstart', unlock, { once: true })
    document.addEventListener('click', unlock, { once: true })
    load()
    const t = setInterval(load, 8000)
    return () => { clearInterval(t); stopRinging() }
  }, [rid])

  async function advance(o: Order, next: string) {
    if (next === 'ready') {
      await supabase.rpc('vendor_ready', { p_order_id: o.id })
    } else {
      await supabase.from('orders').update({ kitchen_status: next }).eq('id', o.id)
    }
    load()
  }

  async function delay(o: Order) {
    await supabase.rpc('vendor_delay', { p_order_id: o.id, p_minutes: 10 })
    load()
  }

  async function decline() {
    if (!declining) return
    await supabase.rpc('cancel_order', { p_order_id: declining.id, p_reason: 'vendor_declined' })
    setDeclining(null); load()
  }

  function remaining(o: Order) {
    if (!o.ready_at) return null
    return Math.round((+new Date(o.ready_at) - Date.now()) / 60000)
  }

  if (!rid) return <p className="text-mist text-center py-10">حسابك غير مرتبط بمطعم. تواصل مع الإدارة.</p>

  const newOrders = orders.filter(o => (o.kitchen_status || 'new') === 'new')
  const active = orders.filter(o => (o.kitchen_status || 'new') === 'preparing')
  const ready = orders.filter(o => o.kitchen_status === 'ready')

  const card = (o: Order, big = false) => {
    const stage = KITCHEN.find(k => k.key === (o.kitchen_status || 'new'))!
    return (
      <div key={o.id} className={`card p-4 ${big ? 'border-sand ring-2 ring-sand/50' : ''}`}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-bold text-lg">طلب #{o.id}</h2>
            <p className="text-sm text-mist mt-0.5">{o.zone} — وحدة {o.unit_number}</p>
          </div>
          <div className="text-left">
            <span className="font-bold text-sea block text-lg">{o.subtotal} ج.م</span>
            <span className="text-xs text-mist">{stage.label}</span>
          </div>
        </div>

        <div className="mt-3 bg-night border border-line rounded-xl p-3.5 text-sm space-y-1">
          {(items[o.id] ?? []).map(it => (
            <div key={it.id} className="flex justify-between">
              <span>{it.name} × {it.qty}{it.requires_prescription ? ' 💊' : ''}</span>
              <span className="text-mist">{it.total} ج.م</span>
            </div>
          ))}
        </div>

        {(items[o.id] ?? []).some(it => it.requires_prescription) && (
          <p className="text-sand text-sm mt-2">💊 الطلب فيه صنف يحتاج روشتة — أكّد مع العميل قبل التجهيز</p>
        )}

        {remaining(o) !== null && o.kitchen_status !== 'ready' && (
          <p className={`text-sm mt-2 ${remaining(o)! < 0 ? 'text-red-300' : 'text-mist'}`}>
            {remaining(o)! < 0 ? `متأخر ${Math.abs(remaining(o)!)} دقيقة` : `المفروض يجهز خلال ${remaining(o)} دقيقة`}
          </p>
        )}

        {big ? (
          <div className="flex gap-2.5 mt-4">
            <button className="btn-sea flex-1 !text-lg !py-4" onClick={() => advance(o, stage.next!)}>
              ✅ {stage.action}
            </button>
            <button className="btn-danger !text-lg !py-4 !px-5" onClick={() => setDeclining(o)}>✗</button>
          </div>
        ) : (
          <>
            {stage.next && (
              <div className="flex gap-2.5 mt-3">
                <button className="btn-sea flex-1" onClick={() => advance(o, stage.next!)}>{stage.action}</button>
                <button className="btn-ghost" onClick={() => delay(o)}>+10 دقائق</button>
              </div>
            )}
            {!stage.next && <p className="text-emerald-300 text-center text-sm mt-3">✅ في انتظار المندوب</p>}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold">🍽️ {name}</h1>
        <span className={isOpen ? 'badge-open' : 'badge-closed'}>{isOpen ? 'مفتوح' : 'مغلق'}</span>
      </div>

      {orders.length === 0 && <div className="card p-6 text-center text-mist">لا توجد طلبات حالياً</div>}

      {newOrders.length > 0 && (
        <div className="mb-6 space-y-4">
          <p className="text-sand font-bold animate-pulse">🔔 طلب جديد — {newOrders.length}</p>
          {newOrders.map(o => card(o, true))}
        </div>
      )}

      <div className="space-y-4">{active.map(o => card(o))}</div>

      {ready.length > 0 && (
        <>
          <h2 className="font-bold text-mist mt-6 mb-3">جاهز للاستلام</h2>
          <div className="space-y-4">{ready.map(o => card(o))}</div>
        </>
      )}

      {declining && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => setDeclining(null)}>
          <div className="card w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-2">رفض الطلب #{declining.id}</h3>
            <p className="text-sm text-mist mb-4">هيتم إلغاء الطلب وإخطار العميل. متاح فقط قبل بدء التحضير.</p>
            <div className="flex gap-3">
              <button className="btn-ghost flex-1" onClick={() => setDeclining(null)}>تراجع</button>
              <button className="btn-danger flex-1" onClick={decline}>تأكيد الرفض</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
