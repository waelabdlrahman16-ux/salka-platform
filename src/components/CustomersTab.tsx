import { useEffect, useMemo, useState } from 'react'
import { rpc } from '../lib/rpc'
import { orderStatusLabel } from '../lib/statusLabels'

/**
 * Customers.
 *
 * Salka has no customers *table* worth reading on its own: a customer is a
 * phone number that has ordered, plus (sometimes) a row in `customers` if they
 * signed in with Google or email. So this tab is built on two RPCs that do the
 * reconciling server-side -- admin_customers() for the list and
 * admin_customer_detail() for one person's history.
 *
 * Two decisions worth knowing, because both are easy to get wrong and both are
 * already wrong somewhere in production data:
 *
 *  - People are keyed by NORMALISED PHONE, never by name. The same person
 *    types their name differently between orders; there is a phone in this
 *    database that appears as both "Eslam" and "Eslam Nabawy". Grouping by
 *    name reports him as two customers and halves the repeat rate.
 *
 *  - The list includes people who registered and never ordered. They are
 *    invisible in any orders-derived view, and they are the single most
 *    actionable group on this screen -- someone who made an account and
 *    stopped is telling you where the app lost them.
 *
 * The default sort is spend, but the column that actually earns its place is
 * "ساكت من" (days quiet). Your best-ever customer can also be six weeks gone,
 * and a spend sort puts him at the top looking healthy.
 */

type Customer = {
  name: string | null
  phone: string
  email: string | null
  orders_all: number
  delivered: number
  cancelled: number
  refunds_due: number
  spend: number
  avg_order: number
  last_zone: string | null
  last_unit: string | null
  last_payment: string | null
  first_at: string | null
  last_at: string | null
  signed_up_at: string | null
  days_quiet: number | null
  wallet: number
  complaints: number
  avg_rating_given: number | null
  favourite_vendor: string | null
}

type DetailOrder = {
  id: number
  created_at: string
  status: string
  total: number
  delivery_fee: number | null
  service_fee: number | null
  payment_method: string | null
  zone: string | null
  unit_number: string | null
  cancel_reason: string | null
  refund_status: string | null
  order_type: string | null
  customer_note: string | null
  address_notes: string | null
  request_notes: string | null
  vendor_name: string | null
  driver_name: string | null
  items: string | null
  rating: { driver: number | null; restaurant: number | null; comment: string | null } | null
}

type Detail = {
  phone: string
  orders: DetailOrder[]
  complaints: { id: number; order_id: number; category: string | null; description: string | null; status: string | null; created_at: string }[]
}

type Segment = 'all' | 'repeat' | 'once' | 'never' | 'attention'

const SEGMENTS: { key: Segment; label: string; hint: string }[] = [
  { key: 'all', label: 'الكل', hint: 'كل اللي عندنا رقمه' },
  { key: 'repeat', label: 'رجعوا تاني', hint: 'طلبوا واستلموا مرتين أو أكتر — دول الدليل إن الخدمة شغالة' },
  { key: 'once', label: 'طلبوا مرة', hint: 'طلب واحد بس واستلمه — أقرب ناس ممكن ترجع لو كلمتهم' },
  { key: 'never', label: 'سجّلوا وماطلبوش', hint: 'عملوا حساب ومكملوش — دول بيقولولك التطبيق ضيّعهم فين' },
  { key: 'attention', label: 'محتاجين متابعة', hint: 'إلغاء أكتر من استلام، أو شكوى، أو فلوس مستحقة ليهم' },
]

const money = (n: number | null | undefined) =>
  `${Number(n ?? 0).toLocaleString('en-EG', { maximumFractionDigits: 0 })} ج.م`

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }) : '—'

const dayTime = (iso: string) =>
  new Date(iso).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/** Egyptian mobiles are stored normalised (no leading 0). Put it back for display and for tel:. */
const dial = (phone: string) => (phone.startsWith('0') ? phone : `0${phone}`)

function needsAttention(c: Customer) {
  return c.cancelled > c.delivered || c.complaints > 0 || c.refunds_due > 0
}

export default function CustomersTab() {
  const [rows, setRows] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [segment, setSegment] = useState<Segment>('all')
  const [sort, setSort] = useState<'spend' | 'recent' | 'quiet' | 'orders'>('spend')

  const [open, setOpen] = useState<Customer | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailError, setDetailError] = useState('')

  async function load() {
    setLoading(true)
    const res = await rpc<Customer[]>('admin_customers')
    setLoading(false)
    if (!res.ok) { setError(res.error); return }
    setError('')
    setRows(res.data ?? [])
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!open) { setDetail(null); setDetailError(''); return }
    let cancelled = false
    setDetail(null); setDetailError('')
    rpc<Detail>('admin_customer_detail', { p_phone: open.phone }).then(res => {
      if (cancelled) return
      if (!res.ok) { setDetailError(res.error); return }
      setDetail(res.data)
    })
    return () => { cancelled = true }
  }, [open])

  const totals = useMemo(() => {
    const ordered = rows.filter(r => r.delivered > 0)
    const returned = rows.filter(r => r.delivered >= 2)
    return {
      people: rows.length,
      ordered: ordered.length,
      returned: returned.length,
      repeatRate: ordered.length ? Math.round((returned.length / ordered.length) * 100) : 0,
      revenue: rows.reduce((s, r) => s + Number(r.spend || 0), 0),
      attention: rows.filter(needsAttention).length,
    }
  }, [rows])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = rows.filter(r => {
      if (segment === 'repeat' && r.delivered < 2) return false
      if (segment === 'once' && r.delivered !== 1) return false
      if (segment === 'never' && r.orders_all > 0) return false
      if (segment === 'attention' && !needsAttention(r)) return false
      if (!q) return true
      return [r.name, r.phone, r.email, r.last_zone, r.last_unit]
        .some(v => (v ?? '').toLowerCase().includes(q))
    })
    list = [...list]
    if (sort === 'spend') list.sort((a, b) => Number(b.spend) - Number(a.spend))
    if (sort === 'orders') list.sort((a, b) => b.delivered - a.delivered)
    if (sort === 'recent') list.sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''))
    // Nulls last: someone who never ordered has no silence to measure.
    if (sort === 'quiet') list.sort((a, b) => (b.days_quiet ?? -1) - (a.days_quiet ?? -1))
    return list
  }, [rows, query, segment, sort])

  if (loading) return <div className="card p-6 text-center text-mist">بنحمّل العملاء…</div>

  if (error) {
    return (
      <div className="card p-6 text-center space-y-3">
        <p className="text-red-700 font-semibold">{error}</p>
        <button className="btn-ghost" onClick={load}>جرب تاني</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Six numbers, and the only one to act on is the last. */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="عملاء" value={String(totals.people)} />
        <Stat label="طلبوا فعلًا" value={String(totals.ordered)} />
        <Stat label="رجعوا تاني" value={`${totals.returned} · ${totals.repeatRate}%`} />
        <Stat label="إجمالي الإنفاق" value={money(totals.revenue)} />
        <Stat label="متوسط للعميل"
          value={money(totals.ordered ? totals.revenue / totals.ordered : 0)} />
        <Stat label="محتاجين متابعة" value={String(totals.attention)}
          tone={totals.attention > 0 ? 'warn' : 'plain'} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SEGMENTS.map(s => (
          <button key={s.key} title={s.hint}
            className={`tab ${segment === s.key ? 'tab-active' : ''}`}
            onClick={() => setSegment(s.key)}>
            {s.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-mist -mt-2">{SEGMENTS.find(s => s.key === segment)?.hint}</p>

      <div className="flex gap-2">
        <input className="field flex-1" placeholder="ابحث بالاسم أو الموبايل أو الكمبوند أو رقم الوحدة"
          value={query} onChange={e => setQuery(e.target.value)} />
        <select className="field !w-auto" value={sort} onChange={e => setSort(e.target.value as typeof sort)}>
          <option value="spend">الأعلى إنفاقًا</option>
          <option value="orders">الأكتر طلبًا</option>
          <option value="recent">آخر طلب</option>
          <option value="quiet">أطول سكوت</option>
        </select>
      </div>

      {shown.length === 0 && (
        <div className="card p-6 text-center text-mist">مفيش حد هنا</div>
      )}

      <div className="space-y-2">
        {shown.map(c => (
          <button key={c.phone} onClick={() => setOpen(c)}
            className="card p-3.5 w-full text-right hover:border-sea/40 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold truncate">{c.name || 'بدون اسم'}</span>
                  {c.orders_all === 0 && (
                    <Tag tone="warn">سجّل وماطلبش</Tag>
                  )}
                  {c.delivered >= 2 && <Tag tone="good">عميل راجع</Tag>}
                  {c.complaints > 0 && <Tag tone="bad">{c.complaints} شكوى</Tag>}
                  {c.refunds_due > 0 && <Tag tone="bad">استرداد مستحق</Tag>}
                </div>
                <p dir="ltr" className="text-sm text-mist mt-0.5 text-right">{dial(c.phone)}</p>
                <p className="text-xs text-mist mt-0.5 truncate">
                  {[c.last_zone, c.last_unit].filter(Boolean).join(' · ') || 'لسه مافيش عنوان'}
                </p>
              </div>
              <div className="text-left shrink-0">
                <p className="font-bold">{money(c.spend)}</p>
                <p className="text-xs text-mist mt-0.5">
                  {c.delivered} مكتمل{c.cancelled > 0 ? ` · ${c.cancelled} ملغي` : ''}
                </p>
                <p className="text-xs text-mist mt-0.5">
                  {c.days_quiet === null ? 'مطلبش' : c.days_quiet === 0 ? 'النهارده' : `ساكت ${c.days_quiet} يوم`}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {open && (
        <CustomerSheet
          customer={open}
          detail={detail}
          error={detailError}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

function Stat({ label, value, tone = 'plain' }: { label: string; value: string; tone?: 'plain' | 'warn' }) {
  return (
    <div className={`card p-3 ${tone === 'warn' ? 'border-sand/60 bg-sand/10' : ''}`}>
      <p className="text-[11px] text-mist">{label}</p>
      <p className="font-bold text-[15px] mt-0.5">{value}</p>
    </div>
  )
}

function Tag({ children, tone }: { children: React.ReactNode; tone: 'good' | 'warn' | 'bad' }) {
  const cls = tone === 'good' ? 'bg-sea/10 text-sea'
    : tone === 'warn' ? 'bg-sand/20 text-sandink'
    : 'bg-red-500/10 text-red-700'
  return <span className={`${cls} text-[10px] font-bold rounded px-1.5 py-0.5 shrink-0`}>{children}</span>
}

function CustomerSheet({ customer: c, detail, error, onClose }: {
  customer: Customer
  detail: Detail | null
  error: string
  onClose: () => void
}) {
  // Escape closes. A full-screen panel with no keyboard exit is a trap on a
  // laptop, which is where this tab will actually be used.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-line px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-bold text-lg truncate">{c.name || 'بدون اسم'}</h3>
            <p dir="ltr" className="text-sm text-mist text-right">{dial(c.phone)}</p>
            {c.email && <p dir="ltr" className="text-xs text-mist text-right break-all">{c.email}</p>}
          </div>
          <button className="text-mist hover:text-foam text-sm shrink-0" onClick={onClose}>إغلاق ✕</button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex gap-2">
            <a className="btn-sea flex-1 text-center !py-2.5" href={`tel:${dial(c.phone)}`}>📞 اتصل</a>
            <a className="btn-ghost flex-1 text-center !py-2.5"
              href={`https://wa.me/2${dial(c.phone)}`} target="_blank" rel="noreferrer">واتساب</a>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <Field label="إجمالي الإنفاق" value={money(c.spend)} />
            <Field label="متوسط الطلب" value={money(c.avg_order)} />
            <Field label="طلبات مكتملة" value={String(c.delivered)} />
            <Field label="طلبات ملغية" value={String(c.cancelled)} />
            <Field label="أول طلب" value={day(c.first_at)} />
            <Field label="آخر طلب" value={day(c.last_at)} />
            <Field label="سجّل معانا" value={day(c.signed_up_at)} />
            <Field label="رصيد المحفظة" value={money(c.wallet)} />
            <Field label="آخر مكان" value={[c.last_zone, c.last_unit].filter(Boolean).join(' · ') || '—'} />
            <Field label="أكتر مطعم" value={c.favourite_vendor || '—'} />
            <Field label="طريقة الدفع" value={c.last_payment || '—'} />
            <Field label="تقييمه للمندوبين" value={c.avg_rating_given ? `${c.avg_rating_given} ★` : '—'} />
          </div>

          {detail && detail.complaints.length > 0 && (
            <div className="bg-red-500/5 rounded-xl p-3 space-y-2">
              <p className="font-bold text-sm text-red-700">شكاوى ({detail.complaints.length})</p>
              {detail.complaints.map(x => (
                <div key={x.id} className="text-xs">
                  <p className="font-semibold">#{x.order_id} · {x.category || 'شكوى'} · {x.status || 'مفتوحة'}</p>
                  {x.description && <p className="text-mist mt-0.5">{x.description}</p>}
                </div>
              ))}
            </div>
          )}

          <div>
            <p className="font-bold text-sm mb-2">
              الطلبات {detail ? `(${detail.orders.length})` : ''}
            </p>

            {error && <p className="text-sm text-red-700">{error}</p>}
            {!detail && !error && <p className="text-sm text-mist">بنحمّل…</p>}

            {detail && detail.orders.length === 0 && (
              <p className="text-sm text-mist">
                عمل حساب بس مطلبش ولا مرة. ده أهم سطر في الصفحة دي — يستاهل مكالمة.
              </p>
            )}

            <div className="space-y-2">
              {detail?.orders.map(o => (
                <div key={o.id} className="border border-line rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm">#{o.id} · {o.vendor_name || 'طلب خاص'}</span>
                    <span className="text-xs text-mist">{dayTime(o.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-mist">
                    <span className="font-semibold text-foam">{orderStatusLabel(o.status)}</span>
                    <span>·</span>
                    <span>{money(o.total)}</span>
                    {o.payment_method && <><span>·</span><span>{o.payment_method}</span></>}
                    {o.driver_name && <><span>·</span><span>{o.driver_name}</span></>}
                  </div>
                  {o.items && <p className="text-xs text-mist mt-1.5">{o.items}</p>}
                  {o.request_notes && <p className="text-xs text-mist mt-1">📝 {o.request_notes}</p>}
                  {o.customer_note && <p className="text-xs text-mist mt-1">💬 {o.customer_note}</p>}
                  {o.cancel_reason && (
                    <p className="text-xs text-red-700 mt-1">سبب الإلغاء: {o.cancel_reason}</p>
                  )}
                  {o.rating && (o.rating.driver || o.rating.restaurant) && (
                    <p className="text-xs text-sandink mt-1">
                      قيّم المندوب {o.rating.driver ?? '—'}★ والمطعم {o.rating.restaurant ?? '—'}★
                      {o.rating.comment ? ` — ${o.rating.comment}` : ''}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-shellup rounded-lg px-3 py-2">
      <p className="text-[11px] text-mist">{label}</p>
      <p className="font-semibold mt-0.5 truncate">{value}</p>
    </div>
  )
}
