import { useEffect, useId, useState } from 'react'
import { supabase } from '../lib/supabase'
import { dispatchOperation } from '../lib/dispatchOperations'
import { serviceFeeFor, useServiceFeePct } from '../lib/serviceFee'

/**
 * An order a vendor phoned in.
 *
 * The restaurant took the order themselves and wants Salka to deliver it. That
 * is not a catalogue order -- there is no basket, no menu item, no price we
 * computed -- so it is written as a `pickup_request`: the driver collects the
 * food price for the vendor plus our delivery fee at the door.
 *
 * Deliberately self-contained. It loads its own vendors and compounds rather
 * than taking them as props, because Admin already holds both and Supervisor
 * holds neither, and threading them through two pages to save one query is how
 * the two copies start to differ.
 */
type Vendor = { id: number; name: string; vendor_type: string | null }
type Compound = { id: number; name: string; delivery_fee: number | null }

export default function PhoneOrderForm({ onCreated }: { onCreated: () => void }) {
  const fid = useId()
  const [open, setOpen] = useState(false)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [compounds, setCompounds] = useState<Compound[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ id: number; total: number } | null>(null)

  const [f, setF] = useState({
    restaurant_id: '', compound_id: '', name: '', phone: '',
    unit: '', notes: '', collect: '',
  })

  useEffect(() => {
    if (!open || vendors.length > 0) return
    supabase.from('restaurants').select('id, name, vendor_type').eq('archived', false).order('name')
      .then(({ data }) => setVendors((data ?? []) as Vendor[]))
    supabase.from('compounds').select('id, name, delivery_fee').eq('active', true).order('name')
      .then(({ data }) => setCompounds((data ?? []) as Compound[]))
  }, [open, vendors.length])

  const fee = compounds.find(c => String(c.id) === f.compound_id)?.delivery_fee ?? null
  const collect = Number(f.collect) || 0
  // Server-owned, never a hardcoded 0.08 -- same rule and the same hook as
  // CheckoutPage and CartPage. staff_create_pickup_order charges this now; it
  // used to charge nothing, so two real orders went out earning the delivery
  // fee alone.
  const { pct: serviceFeePct } = useServiceFeePct()
  const serviceFee = serviceFeeFor(collect, serviceFeePct)
  // Shown before submitting, because the number the driver will ask for at the
  // door is the whole point of the call and getting it wrong is a doorstep
  // argument, not a bug report. null while any component is unknown -- quoting
  // a number over the phone that the server will not honour is the one failure
  // this box exists to prevent.
  const total = fee != null && serviceFee != null ? fee + collect + serviceFee : null

  // Advisory only. staff_create_pickup_order deliberately does NOT force a
  // phoned-in order into awaiting_payment -- the vendor is on the line and
  // cannot wait for an InstaPay transfer. But a driver carrying 2500 ج.م of
  // someone else's stock with nothing secured is worth one sentence on screen.
  // Never guessed: null until settings answers, same as CheckoutPage.
  const [depositThreshold, setDepositThreshold] = useState<number | null>(null)
  useEffect(() => {
    if (!open) return
    supabase.from('settings').select('value').eq('key', 'cod_deposit_threshold_egp').maybeSingle()
      .then(({ data, error }) => {
        if (error || data?.value == null) return
        setDepositThreshold(Number(data.value))
      })
  }, [open])
  const needsDeposit = total != null && depositThreshold != null && total > depositThreshold
  const valid = f.restaurant_id && f.compound_id && f.name.trim() && f.phone.trim() && f.unit.trim()

  async function submit() {
    setBusy(true); setError('')
    const res = await dispatchOperation<{ id: number; total: number }>('staffPickup', {
      restaurantId: Number(f.restaurant_id), customerName: f.name.trim(), customerPhone: f.phone.trim(),
      compoundId: Number(f.compound_id), unitNumber: f.unit.trim(), addressNotes: '',
      collectAmount: collect, requestNotes: f.notes.trim(),
    }, {
      not_authorized: 'الصيدلية والماركت مش من صلاحياتك',
      admin_only: 'مش من صلاحياتك تعمل طلب من هنا',
      compound_missing_fee: 'الكومباوند ده مالوش سعر توصيل — ظبّطه من الإعدادات الأول',
      restaurant_not_found: 'المكان ده مش موجود أو متخفي',
      missing_customer_details: 'اسم العميل ورقمه ورقم الشاليه لازم يتكتبوا',
    })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    // staff_create_pickup_order returns json (verified against the catalogue),
    // so this is an object -- but a caller should never render #undefined
    // because a function signature changed under it.
    const row: any = Array.isArray(res.data) ? res.data[0] : res.data
    if (!row?.id) { setError('اتعمل الطلب بس مارجعش رقمه — شوفه في الطلبات غير المعيّنة'); onCreated(); return }
    setDone({ id: row.id, total: row.total })
    setF({ restaurant_id: f.restaurant_id, compound_id: '', name: '', phone: '', unit: '', notes: '', collect: '' })
    onCreated()
  }

  if (!open) {
    return (
      <button className="btn-ghost w-full text-sm mb-3" onClick={() => setOpen(true)}>
        ☎️ طلب جه بالتليفون من مطعم
      </button>
    )
  }

  return (
    <div className="card p-4 mb-3">
      <div className="flex items-center justify-between mb-1">
        <p className="font-bold text-sm">☎️ طلب بالتليفون</p>
        <button className="text-mist text-xs" onClick={() => { setOpen(false); setDone(null); setError('') }}>إغلاق ✕</button>
      </div>
      <p className="text-xs text-mist mb-3">
        للمطعم اللي أخد الطلب بنفسه وعايز مندوب يوصّله. المندوب هيحصّل فلوس الأكل للمطعم + التوصيل لينا.
      </p>

      {done && (
        <p className="text-sm bg-sea/10 text-sea rounded-xl p-3 mb-3">
          ✅ اتعمل طلب #{done.id} — المندوب هيحصّل {done.total} ج.م. موجود دلوقتي في الطلبات غير المعيّنة.
        </p>
      )}
      {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-3" role="alert">{error}</p>}

      <div className="space-y-2.5">
        <div>
          <label className="label" htmlFor={`${fid}-v`}>المكان</label>
          <select id={`${fid}-v`} className="field" value={f.restaurant_id}
            onChange={e => setF({ ...f, restaurant_id: e.target.value })}>
            <option value="">اختار…</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="label" htmlFor={`${fid}-n`}>اسم العميل</label>
            <input id={`${fid}-n`} className="field" value={f.name}
              onChange={e => setF({ ...f, name: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor={`${fid}-p`}>رقم الموبايل</label>
            <input id={`${fid}-p`} className="field" dir="ltr" inputMode="tel" value={f.phone}
              onChange={e => setF({ ...f, phone: e.target.value })} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="label" htmlFor={`${fid}-c`}>الكومباوند</label>
            <select id={`${fid}-c`} className="field" value={f.compound_id}
              onChange={e => setF({ ...f, compound_id: e.target.value })}>
              <option value="">اختار…</option>
              {compounds.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor={`${fid}-u`}>رقم الشاليه / الفيلا</label>
            <input id={`${fid}-u`} className="field" value={f.unit}
              onChange={e => setF({ ...f, unit: e.target.value })} />
          </div>
        </div>

        <div>
          <label className="label" htmlFor={`${fid}-m`}>فلوس الأكل اللي المندوب هيحصّلها للمطعم</label>
          <input id={`${fid}-m`} className="field" type="number" inputMode="decimal" placeholder="0"
            value={f.collect} onChange={e => setF({ ...f, collect: e.target.value })} />
          <p className="text-xs text-mist mt-1">سيبها فاضية لو العميل دافع للمطعم خلاص.</p>
        </div>

        <div>
          <label className="label" htmlFor={`${fid}-o`}>ملاحظات للمندوب (اختياري)</label>
          <input id={`${fid}-o`} className="field" value={f.notes}
            onChange={e => setF({ ...f, notes: e.target.value })} placeholder="اتصل قبل الوصول…" />
        </div>

        {/* The doorstep number, before you commit to it on the phone. */}
        <div className="bg-night border border-line rounded-xl p-3 text-sm">
          {fee == null ? (
            <p className="text-mist">اختار الكومباوند عشان نحسب التوصيل</p>
          ) : (
            <>
              <p className="flex justify-between"><span className="text-mist">فلوس المطعم</span><span>{collect} ج.م</span></p>
              <p className="flex justify-between"><span className="text-mist">التوصيل</span><span>{fee} ج.م</span></p>
              <p className="flex justify-between">
                <span className="text-mist">رسوم الخدمة</span>
                <span>{serviceFee != null ? `${serviceFee} ج.م` : <span className="text-mist">…</span>}</span>
              </p>
              <p className="flex justify-between font-bold mt-1 pt-1 border-t border-line">
                <span>المندوب هيحصّل</span>
                <span>{total != null ? `${total} ج.م` : <span className="text-mist">…</span>}</span>
              </p>
            </>
          )}
        </div>

        {needsDeposit && (
          <div className="bg-sand/15 border border-sand rounded-xl p-3 text-sm" role="alert">
            <p className="font-semibold text-sandink">
              ده فوق {depositThreshold} ج.م — اطلب عربون قبل ما تبعت المندوب
            </p>
            <p className="text-xs text-mist mt-1">
              المندوب هيشيل بضاعة بـ {collect} ج.م. لو الباب مافتحش، الخسارة عليك.
              الطلب هيتعمل عادي — ده تنبيه بس.
            </p>
          </div>
        )}

        <button className="btn-sea w-full text-sm" disabled={busy || !valid} onClick={submit}>
          {busy ? 'لحظة…' : 'اعمل الطلب ودوّر على مندوب'}
        </button>
      </div>
    </div>
  )
}
