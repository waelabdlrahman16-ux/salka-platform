import { useEffect, useState } from 'react'
import Icon from './Icon'
import { adminReport } from '../lib/adminReports'

// The read side of the funnel instrumentation.
//
// It answers two questions nothing in the product could answer before: where a
// visit dies, and whether the traffic being paid for behaves differently from
// the traffic that arrives on its own.
//
// Counts DISTINCT devices per step, never events -- one person opening four
// vendors is one person. Event counts are the flattering number; device counts
// are the true one.
type Step = {
  ord: number
  event: string
  devices: number
  paid_devices: number
  in_app_devices: number
}
type VendorDiagnostic = {
  restaurant_id: number
  name: string
  open_devices: number
  closed_browsers: number
  item_devices: number
  customization_opened: number
  customization_abandoned: number
  checkout_blocked: number
  order_devices: number
}
type CheckoutBlock = { reason: string; events: number; devices: number }
type Funnel = {
  since: string
  requested_since: string
  days: number
  funnel: Step[]
  totals: { devices: number; paid_devices: number; in_app_devices: number; events: number }
  closed_browsers: number
  vendors: VendorDiagnostic[]
  checkout_blocks: CheckoutBlock[]
}

const LABELS: Record<string, string> = {
  arrival:          'فتح التطبيق',
  place_chosen:     'اختار مكانه',
  vendor_opened:    'فتح مكان مفتوح',
  item_added:       'ضاف صنف',
  checkout_started: 'وصل للدفع',
  order_placed:     'أكّد الطلب',
}

const RANGES = [1, 7, 30]

const BLOCK_LABELS: Record<string, string> = {
  slot_full: 'الفترة اتمَلَت',
  invalid_combo: 'الكومبو اتغيّر',
  restaurant_closed: 'المكان قفل',
  coverage: 'خارج التغطية',
  timed_item_unavailable: 'صنف وقته خلص',
  item_unavailable: 'صنف خلص',
  size: 'الحجم ناقص',
  addon_required: 'اختيار مطلوب ناقص',
  addon_limit: 'إضافات زيادة',
  unknown: 'سبب غير معروف',
}

export default function FunnelPanel() {
  const [days, setDays] = useState(7)
  const [data, setData] = useState<Funnel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load(d: number) {
    setLoading(true); setError('')
    const res = await adminReport<Funnel>('funnel', { days: d })
    setLoading(false)
    // Checked, not discarded. A funnel that silently renders zeroes on a failed
    // read is worse than one that says it could not load -- zeroes look like a
    // finding, and someone will act on them.
    if (!res.ok) { setError(`مش قادرين نحمّل الأرقام: ${res.error}`); return }
    setData(res.data)
  }

  useEffect(() => { load(days) }, [days])

  const steps = data?.funnel ?? []
  const top = steps[0]?.devices ?? 0
  const topPaid = steps[0]?.paid_devices ?? 0

  const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="font-bold"><Icon name="chartLineDown" size="sm" className="inline-block align-[-0.15em] me-1" />رحلة الزبون</h3>
        <div className="flex gap-1.5">
          {RANGES.map(d => (
            <button key={d}
              className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 min-h-[36px] ${
                days === d ? 'bg-shellup text-foam' : 'text-mist hover:text-foam'}`}
              onClick={() => setDays(d)}>
              {d === 1 ? 'النهاردة' : `${d} يوم`}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-mist mb-3">كل رقم = جهاز مختلف، مش عدد الضغطات</p>
      {data && (
        <p className="text-[10px] text-mist mb-3">
          القياس الدقيق بدأ {new Date(data.since).toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' })}
        </p>
      )}

      {error && (
        <div className="border border-dangerline bg-dangerbg rounded-xl p-3 mb-3 flex items-center justify-between gap-3">
          <p className="text-sm text-danger font-semibold">{error}</p>
          <button className="btn-ghost !py-1.5 !px-3 text-xs shrink-0" onClick={() => load(days)}>جرب تاني</button>
        </div>
      )}

      {loading && <p className="text-mist text-sm text-center py-6">جاري التحميل…</p>}

      {!loading && !error && top === 0 && (
        <p className="text-mist text-sm text-center py-6">
          لسه مفيش بيانات في الفترة دي، الأرقام هتبدأ تظهر بعد ما النسخة الجديدة تنزل
        </p>
      )}

      {!loading && !error && top > 0 && (
        <>
          <div className="space-y-1.5">
            {steps.map((s, i) => {
              const prev = i === 0 ? null : steps[i - 1]
              const dropped = prev ? prev.devices - s.devices : 0
              return (
                <div key={s.event}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-mist w-20 shrink-0">{LABELS[s.event] ?? s.event}</span>
                    <div className="flex-1 h-7 bg-shellup rounded-lg overflow-hidden relative">
                      <div className="h-full bg-sea/70 transition-all"
                        style={{ width: `${pct(s.devices, top)}%` }} />
                      <span className="absolute inset-0 flex items-center px-2 text-[11px] font-bold text-foam">
                        {s.devices} <span className="text-mist font-normal mr-1">({pct(s.devices, top)}%)</span>
                      </span>
                    </div>
                  </div>
                  {/* The drop between steps is the actionable number, so it is
                      shown explicitly rather than left as arithmetic between
                      two bars. */}
                  {prev && dropped > 0 && (
                    <p className="text-[10px] text-danger mr-20 mt-0.5">
                      <Icon name="arrowDown" size="sm" className="inline-block align-[-0.15em] me-1" />خسرنا {dropped} هنا
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          <div className="grid grid-cols-3 gap-2 mt-4 text-center">
            <div className="bg-shellup rounded-xl p-2.5">
              <p className="text-lg font-bold">{data?.totals.devices ?? 0}</p>
              <p className="text-[10px] text-mist">أجهزة</p>
            </div>
            <div className="bg-shellup rounded-xl p-2.5">
              <p className="text-lg font-bold text-coral-700">{data?.totals.paid_devices ?? 0}</p>
              <p className="text-[10px] text-mist">من الإعلان</p>
            </div>
            <div className="bg-shellup rounded-xl p-2.5">
              <p className="text-lg font-bold">{data?.totals.in_app_devices ?? 0}</p>
              <p className="text-[10px] text-mist">جوه فيسبوك</p>
            </div>
          </div>

          {(data?.closed_browsers ?? 0) > 0 && (
            <p className="text-xs text-mist mt-3 bg-shellup rounded-xl p-3">
              <b className="text-foam">{data?.closed_browsers}</b> جهاز اتفرّج على قايمة مكان مقفول،
              دول تصفّح، مش عملاء ضاعوا وقت الطلب.
            </p>
          )}

          {/* The ad question, stated plainly. Suppressed entirely when no paid
              traffic arrived in the window, because 0 of 0 renders as 0% and
              reads as "the ad converts nobody". */}
          {topPaid > 0 && (
            <p className="text-xs text-mist mt-3 leading-relaxed">
              من الإعلان: <b className="text-foam">{topPaid}</b> جهاز فتح التطبيق،
              منهم <b className="text-foam">{steps.find(s => s.event === 'order_placed')?.paid_devices ?? 0}</b> طلبوا
              {' '}({pct(steps.find(s => s.event === 'order_placed')?.paid_devices ?? 0, topPaid)}%)
            </p>
          )}

          {(data?.vendors?.length ?? 0) > 0 && (
            <div className="mt-5 pt-4 border-t border-line">
              <h4 className="font-bold text-sm mb-1">التحويل حسب المكان</h4>
              <p className="text-[10px] text-mist mb-2">فتح وهو شغال ← ضاف ← طلب</p>
              <div className="space-y-2">
                {data!.vendors.map(v => (
                  <div key={v.restaurant_id} className="bg-shellup rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold truncate">{v.name}</p>
                      <p className="text-xs font-bold shrink-0" dir="ltr">
                        {v.open_devices} → {v.item_devices} → {v.order_devices}
                      </p>
                    </div>
                    {(v.customization_opened > 0 || v.checkout_blocked > 0) && (
                      <p className="text-[10px] text-mist mt-1">
                        فتح الاختيارات {v.customization_opened}
                        {' · '}خرج من غير إضافة {v.customization_abandoned}
                        {' · '}اتعطّل في التأكيد {v.checkout_blocked}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(data?.checkout_blocks?.length ?? 0) > 0 && (
            <div className="mt-5 pt-4 border-t border-line">
              <h4 className="font-bold text-sm mb-2">ليه تأكيد الطلب وقف؟</h4>
              <div className="flex flex-wrap gap-2">
                {data!.checkout_blocks.map(b => (
                  <span key={b.reason} className="text-xs bg-dangerbg text-danger rounded-full px-3 py-1.5">
                    {BLOCK_LABELS[b.reason] ?? b.reason}: {b.devices}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
