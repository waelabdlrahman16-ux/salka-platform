import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { customerOrderAccess } from '../lib/customerOrderAccess'
import { readLiveOrder, forgetLiveOrder, rememberLiveOrder, LIVE_ORDER_DONE } from '../lib/liveOrder'
import { getSessionToken, useCustomerAuth } from '../lib/customerAuth'
import { customerSessionAccess } from '../lib/customerSessionAccess'
import Icon from './Icon'

export interface LiveOrderSummary {
  id: number; status: string; restaurant_name: string
  created_at: string; sla_minutes?: number | null; scheduled_date?: string | null
}
interface Live { order: LiveOrderSummary }

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

// One icon per stage, filled. A coloured dot said "something is live" and
// nothing else; these say WHICH thing, so the state is readable before the
// words are. Filled rather than outline because the card reports a state --
// an outline glyph reads as a control you can press.
const STAGE_ICON = ['checkCircle', 'storefront', 'motorcycle', 'locationDot'] as const

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
  const { customer } = useCustomerAuth()

  useEffect(() => {
    const ref = readLiveOrder()
    let alive = true
    if (ref) {
      customerOrderAccess<Live>('track', { token: ref.token }).then(res => {
        if (!alive) return
        // A bad or expired token is not worth retrying on every home visit.
        if (!res.ok) { if (res.code === 'order_not_found' || res.code === 'not_authorized') forgetLiveOrder(); return }
        const o = res.data?.order
        if (!o) return
        if (LIVE_ORDER_DONE.includes(o.status)) { forgetLiveOrder(); return }
        setLive(o)
      })
    } else if (customer?.phone) {
      // A signed-in customer can return on a second device, or after browser
      // storage was cleared. Their current order must still lead Home even
      // though this device never saw the post-checkout tracking URL.
      customerSessionAccess<Array<Live['order'] & { public_token: string }>>('orders', {
        phone: customer.phone, sessionToken: getSessionToken(),
      }).then(res => {
        if (!alive || !res.ok) return
        const o = (res.data ?? []).find(row => !LIVE_ORDER_DONE.includes(row.status))
        if (!o) return
        rememberLiveOrder(o.public_token)
        setLive(o)
      })
    }
    return () => { alive = false }
  }, [customer?.id, customer?.phone])

  if (!live) return null
  return <LiveOrderLink live={live} token={readLiveOrder()?.token ?? ''} />
}

/** Shared running-order treatment for Home and My Account. */
export function LiveOrderLink({ live, token }: { live: LiveOrderSummary; token: string }) {
  const stage = stageOf(live.status)
  const headline = live.status === 'awaiting_payment'
    ? 'بانتظار الدفع'
    : live.status === 'awaiting_quote'
      ? 'بنراجع طلبك'
      : STAGE_LABEL[stage]
  const awaitingPayment = live.status === 'awaiting_payment'
  // Same promise Track makes, read from the same field, so the two screens can
  // never disagree about whether an order is late.
  const late = !['awaiting_quote', 'awaiting_payment'].includes(live.status)
    && live.sla_minutes != null && !live.scheduled_date
    && Date.now() > new Date(live.created_at).getTime() + live.sla_minutes * 60000

  return (
    <Link to={`/track/${token}`}
      className={`card block p-0 overflow-hidden mb-4 ${awaitingPayment ? 'border-warningline' : 'border-successline'}`}>
      <div className="p-3.5 flex items-center gap-3">
        {/* A scheduled order is not "at a stage" -- it is waiting for a date, so
            it gets the calendar rather than a point on a journey it has not
            started. */}
        <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${
          late || awaitingPayment ? 'bg-warningbg text-warning' : 'bg-successbg text-success'}`}>
          {awaitingPayment
            ? <Icon size="md" name="hourglass" className="animate-payment-wait" />
            : <Icon size="md" filled name={live.scheduled_date ? 'calendarCheck' : STAGE_ICON[stage]} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-[15px] truncate">{headline}</p>
          <p className="text-xs text-mist truncate">#{live.id} • {live.restaurant_name}</p>
        </div>
        <span className={`text-[11px] font-bold rounded-full px-2.5 py-0.5 border shrink-0 ${
          late || awaitingPayment ? 'bg-warningbg border-warningline text-warning'
               : 'bg-successbg border-successline text-success'}`}>
          {late ? 'متأخر شوية' : awaitingPayment ? 'محتاج تحويل' : live.status === 'awaiting_quote' ? 'هنبعتلك إشعار بالسعر' : 'في الميعاد'}
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
