import LiveMap from './LiveMap'
import Icon from './Icon'
import type { LiveDelivery } from '../lib/types'

// The contents of one in-flight delivery, shared by the admin's "توصيلات جارية"
// tab and the supervisor's in-flight list. Both boards had a header, a driver
// name and a status badge -- nothing that told the person on the phone WHAT is
// in the bag or WHERE the rider actually is. When a customer calls to ask why
// their order is late, those are the only two questions.
//
// Everything here comes from admin_live_deliveries(). The parent still owns the
// row (grouping, actions, the reassign modal) and passes the matching payload
// in; this renders only the part the RPC uniquely provides.

// How long since the driver's last fix, as the server measured it. Rendered as
// words rather than a timestamp because the operator needs "is this pin worth
// trusting", not "when exactly".
function seenLabel(seconds: number | null): { text: string; tone: string } {
  if (seconds == null) return { text: 'مفيش موقع من المندوب', tone: 'text-mist' }
  if (seconds < 90) return { text: 'موقعه دلوقتي', tone: 'text-sea' }
  if (seconds < 180) return { text: `آخر تحديث من ${Math.round(seconds / 60)} دقيقة`, tone: 'text-mist' }
  if (seconds < 3600) return { text: `آخر تحديث من ${Math.round(seconds / 60)} دقيقة`, tone: 'text-coral-700' }
  return { text: `آخر تحديث من ${Math.round(seconds / 3600)} ساعة`, tone: 'text-danger' }
}

export default function LiveDeliveryDetail({ live }: { live?: LiveDelivery }) {
  // The parent renders from its own assignments list, which is fetched
  // separately, so for one poll cycle a brand-new assignment can exist there
  // with no payload here yet. Render nothing rather than an empty scaffold.
  if (!live) return null

  // A catalogue order's lines live in order_items; a pharmacy or supermarket
  // basket is free text on the order itself. A board that reads only the first
  // one leaves half the vendors showing an empty card -- which is exactly what
  // the vendor ticket used to do.
  const lines: { label: string; qty: number; extra?: string }[] =
    (live.items ?? []).length > 0
      ? (live.items ?? []).map(it => ({
          label: it.name,
          qty: it.qty,
          extra: [it.size_name, it.combo_name, ...(it.addon_names ?? [])].filter(Boolean).join(' · ') || undefined,
        }))
      : (live.request_items ?? []).map(it => ({ label: it.name, qty: it.qty }))

  const seen = seenLabel(live.driver_seen_seconds_ago)
  const hasPin = live.driver_lat != null && live.driver_lng != null
    && live.dest_lat != null && live.dest_lng != null

  // Before pickup there is nothing to track -- the server only accepts a
  // position from Picked_Up onwards -- so an Offered or Accepted row would show
  // a row of identical "no position yet" boxes, which trains the operator to
  // stop reading the one that matters. Items still show at every stage.
  const onTheRoad = live.assignment_status === 'Picked_Up' || live.assignment_status === 'Out_for_Delivery'
  const showMap = hasPin || onTheRoad

  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-2xl bg-night border border-line p-3">
        <p className="text-xs text-mist mb-1.5">
          الطلب ({lines.length} صنف){live.total != null ? ` · ${live.total} ج.م` : ''}
        </p>
        {lines.length === 0 ? (
          <p className="text-xs text-mist">مفيش أصناف مسجلة على الطلب ده</p>
        ) : (
          <div className="space-y-1">
            {lines.map((l, i) => (
              <div key={i} className="text-sm">
                <span className="font-semibold">{l.qty}×</span> {l.label}
                {l.extra && <span className="text-xs text-mist block pr-5">{l.extra}</span>}
              </div>
            ))}
          </div>
        )}
        {live.request_notes && (
          <p className="text-xs text-coral-700 mt-2"><Icon name="penToSquare" size="xs" className="inline-block align-[-0.15em] me-1" />{live.request_notes}</p>
        )}
      </div>

      {showMap && (
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs text-mist">موقع المندوب</p>
          {/* Beside the pin, not buried in a tooltip. A stale position that
              looks live is worse than no position: it sends the operator to
              reassure a customer about a rider who stopped reporting. */}
          <p className={`text-xs font-semibold ${seen.tone}`}>{seen.text}</p>
        </div>
        {hasPin ? (
          <LiveMap
            driverLat={live.driver_lat!} driverLng={live.driver_lng!}
            destLat={live.dest_lat!} destLng={live.dest_lng!}
            driverUpdatedAt={live.driver_seen_at}
            ageSeconds={live.driver_seen_seconds_ago}
            height={200}
          />
        ) : (
          <div className="rounded-2xl border border-line bg-night text-center text-xs text-mist py-6 px-3">
            {live.dest_lat == null
              ? 'الكومباوند ده مالوش إحداثيات على الخريطة'
              : 'المندوب لسه مابعتش موقعه، بيبدأ يبعت أول ما يستلم الطلب والتطبيق مفتوح عنده'}
          </div>
        )}
      </div>
      )}
    </div>
  )
}
