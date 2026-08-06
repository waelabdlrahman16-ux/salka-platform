import { useEffect, useId, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rpc } from '../lib/rpc'

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
  // Shown before submitting, because the number the driver will ask for at the
  // door is the whole point of the call and getting it wrong is a doorstep
  // argument, not a bug report.
  const total = fee != null ? fee + collect : null
  const valid = f.restaurant_id && f.compound_id && f.name.trim() && f.phone.trim() && f.unit.trim()

  async function submit() {
    setBusy(true); setError('')
    const res = await rpc<{ id: number; total: number }>('staff_create_pickup_order', {
      p_restaurant_id: Number(f.restaurant_id),
      p_customer_name: f.name.trim(),
      p_customer_phone: f.phone.trim(),
      p_compound_id: Number(f.compound_id),
      p_unit_number: f.unit.trim(),
      p_address_notes: '',
      p_collect_amount: collect,
      p_request_notes: f.notes.trim(),
    }, {
      not_authorized: 'الصيدلية والماركت مش من صلاحياتك',
      admin_only: 'مش من صلاحياتك تعمل طلب من هنا',
      compound_missing_fee: 'الكومباوند ده مالوش سعر توصيل — ظبّطه من الإعدادات الأول',
      restaurant_not_found: 'المكان ده مش موجود أو متخفي',
      missing_customer_details: 'اسم العميل ورقمه ورقم الشاليه لازم يتكتبوا',
    })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    setDone({ id: res.data!.id, total: res.data!.total })
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
              <p className="flex justify-between font-bold mt-1 pt-1 border-t border-line">
                <span>المندوب هيحصّل</span><span>{total} ج.م</span>
              </p>
            </>
          )}
        </div>

        <button className="btn-sea w-full text-sm" disabled={busy || !valid} onClick={submit}>
          {busy ? 'لحظة…' : 'اعمل الطلب ودوّر على مندوب'}
        </button>
      </div>
    </div>
  )
}
