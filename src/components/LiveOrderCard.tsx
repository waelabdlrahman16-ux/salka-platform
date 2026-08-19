import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { customerOrderAccess } from '../lib/customerOrderAccess'
import { readLiveOrder, forgetLiveOrder, LIVE_ORDER_DONE } from '../lib/liveOrder'
import Icon from './Icon'

interface Live {
  order: { id: number; status: string; restaurant_name: string
    created_at: string; sla_minutes: number | null; scheduled_date: string | null }
}

// Which of the four Track stages an order is in. Kept deliberately coarse: this
// card exists to say "something is happening and roughly where", not to
// reproduce Track.
function stageOf(status: string): number {
  if (status === 'Delivered') return 3
  if (status === 'Out_for_Delivery') return 2
  if (status === 'Preparing' || status === 'Accepted' || status === 'Ready') return 1
  return 0
}
const STAGE_LABEL = ['استلمنا طلبك', 'بيتجهّز دلوقتي', 'في الطريق إليك', 'تم التوصيل']

/**
 * The home screen had no idea an order was in flight. A customer who placed one
 * and closed the tab came back to a catalogue -- the token lived only in the
 * URL, so for a guest the order was simply gone.
 *
 * Renders nothing, and costs NOTHING, when there is no stored token: the check
 * is a synchronous localStorage read, so the overwhelming majority of visits
 * make no request at all. One request only when there is something to show.
 */
export default function LiveOrderCard() {
  const [live, setLive] = useState<Live['order'] | null>(null)

  useEffect(() => {
    const ref = readLiveOrder()
    if (!ref) return
    let alive = true
    customerOrderAccess<Live>('track', { token: ref.token }).then(res => {
      if (!alive) return
      // A bad or expired token is not worth retrying on every home visit.
      if (!res.ok) { if (res.code === 'order_not_found' || res.code === 'not_authorized') forgetLiveOrder(); return }
      const o = res.data?.order
      if (!o) return
      if (LIVE_ORDER_DONE.includes(o.status)) { forgetLiveOrder(); return }
      setLive(o)
    })
    return () => { alive = false }
  }, [])

  if (!live) return null

  const ref = readLiveOrder()
  const stage = stageOf(live.status)
  // Same promise Track makes, read from the same field, so the two screens can
  // never disagree about whether an order is late.
  const late = live.sla_minutes != null && !live.scheduled_date
    && Date.now() > new Date(live.created_at).getTime() + live.sla_minutes * 60000

  return (
    <Link to={`/track/${ref?.token ?? ''}`}
      className="card block p-0 overflow-hidden mb-4 border-successline">
      <div className="p-3.5 flex items-center gap-3">
        <span className="w-2.5 h-2.5 rounded-full bg-sea shrink-0 ring-4 ring-successbg" />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-[15px] truncate">{STAGE_LABEL[stage]}</p>
          <p className="text-xs text-mist truncate">#{live.id} · {live.restaurant_name}</p>
        </div>
        <span className={`text-[11px] font-bold rounded-full px-2.5 py-0.5 border shrink-0 ${
          late ? 'bg-warningbg border-warningline text-warning'
               : 'bg-successbg border-successline text-success'}`}>
          {late ? 'متأخر شوية' : 'في الميعاد'}
        </span>
        <Icon name="chevronLeft" size="xs" className="text-mist shrink-0" />
      </div>
      <div className="flex items-center gap-1 px-3.5 pb-3.5">
        {[0, 1, 2, 3].map(i => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= stage ? 'bg-sea' : 'bg-line'}`} />
        ))}
      </div>
    </Link>
  )
}
