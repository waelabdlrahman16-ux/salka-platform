import { useId, useState } from 'react'
import { rpc } from '../lib/rpc'
import type { Driver } from '../lib/types'

/**
 * Add or edit one driver, with the fields that actually matter operationally.
 *
 * The only way to create a driver was a textarea parsing "الاسم, رقم, النوع" —
 * so plate, InstaPay handle and payout schedule could never be set at creation,
 * and a typo in the paste was permanent until someone wrote an edit path. The
 * bulk paste is still there for onboarding five riders at once; this is for the
 * one you are hiring today.
 *
 * cash_held, rating, total_deliveries and the device binding are deliberately
 * absent. They are earned or bound by the system, and a form that can silently
 * zero a rider's outstanding cash is a form that eventually will.
 */
const EMPTY = {
  id: null as number | null, name: '', phone: '',
  vehicle_type: 'motorcycle', vehicle_plate: '', instapay_number: '',
  payout_schedule: 'daily', active: true,
}

export function driverToForm(d: Driver): typeof EMPTY {
  return {
    id: d.id, name: d.name ?? '', phone: d.phone ?? '',
    vehicle_type: d.vehicle_type ?? 'motorcycle', vehicle_plate: d.vehicle_plate ?? '',
    instapay_number: d.instapay_number ?? '', payout_schedule: d.payout_schedule ?? 'daily',
    active: d.active,
  }
}

export default function DriverForm({ initial, onDone, onCancel }: {
  initial?: typeof EMPTY
  onDone: () => void
  onCancel: () => void
}) {
  const fid = useId()
  const [f, setF] = useState<typeof EMPTY>(initial ?? EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setBusy(true); setError('')
    const res = await rpc('admin_upsert_driver', {
      p_id: f.id,
      p_name: f.name.trim(),
      p_phone: f.phone.trim(),
      p_vehicle_type: f.vehicle_type,
      p_vehicle_plate: f.vehicle_plate.trim(),
      p_instapay_number: f.instapay_number.trim() || null,
      p_payout_schedule: f.payout_schedule,
      p_active: f.active,
    }, {
      phone_already_used: 'الرقم ده مستخدم لمندوب تاني — رقمين على مندوب واحد معناه إن الدسباتش هيكلم الغلط',
      name_required: 'اكتب اسم المندوب',
      phone_required: 'اكتب رقم الموبايل',
      invalid_vehicle_type: 'النوع لازم يكون موتوسيكل أو فان',
      driver_not_found: 'المندوب ده مش موجود — حدّث الصفحة',
      admin_only: 'مش من صلاحياتك',
    })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    onDone()
  }

  const valid = f.name.trim() && f.phone.trim()

  return (
    <div className="card p-4 mb-3">
      <div className="flex items-center justify-between mb-3">
        <p className="font-bold text-sm">{f.id ? 'تعديل مندوب' : 'مندوب جديد'}</p>
        <button className="text-mist text-xs" onClick={onCancel}>إغلاق ✕</button>
      </div>
      {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-3" role="alert">{error}</p>}

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="label" htmlFor={`${fid}-n`}>الاسم</label>
          <input id={`${fid}-n`} className="field !h-9 text-sm" value={f.name}
            onChange={e => setF({ ...f, name: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={`${fid}-p`}>رقم الموبايل</label>
          <input id={`${fid}-p`} className="field !h-9 text-sm" dir="ltr" inputMode="tel" value={f.phone}
            onChange={e => setF({ ...f, phone: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={`${fid}-v`}>نوع المركبة</label>
          <select id={`${fid}-v`} className="field !h-9 text-sm" value={f.vehicle_type}
            onChange={e => setF({ ...f, vehicle_type: e.target.value })}>
            <option value="motorcycle">موتوسيكل</option>
            <option value="van">فان</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${fid}-pl`}>رقم اللوحة</label>
          <input id={`${fid}-pl`} className="field !h-9 text-sm" value={f.vehicle_plate}
            onChange={e => setF({ ...f, vehicle_plate: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={`${fid}-i`}>رقم InstaPay (اختياري)</label>
          <input id={`${fid}-i`} className="field !h-9 text-sm" dir="ltr" value={f.instapay_number}
            onChange={e => setF({ ...f, instapay_number: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={`${fid}-s`}>مواعيد الدفع</label>
          <select id={`${fid}-s`} className="field !h-9 text-sm" value={f.payout_schedule}
            onChange={e => setF({ ...f, payout_schedule: e.target.value })}>
            <option value="daily">يومي</option>
            <option value="weekly">أسبوعي</option>
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 mt-2 min-h-[44px] cursor-pointer">
        <input type="checkbox" className="w-5 h-5 accent-sea" checked={f.active}
          onChange={e => setF({ ...f, active: e.target.checked })} />
        <span className="text-sm">حسابه شغّال — يقدر يستلم طلبات</span>
      </label>

      {/* Says what this form does NOT touch, so nobody goes looking for it here. */}
      <p className="text-xs text-mist mb-2">
        الكاش اللي على عهدته وتقييمه وعدد توصيلاته والجهاز المربوط بحسابه — كل دي بتتحسب
        لوحدها ومش بتتعدل من هنا. حساب الدخول بيتعمل من «حسابات الدخول».
      </p>

      <button className="btn-sea w-full text-sm" disabled={busy || !valid} onClick={save}>
        {busy ? 'لحظة…' : (f.id ? 'حفظ التعديل' : 'إضافة المندوب')}
      </button>
    </div>
  )
}
