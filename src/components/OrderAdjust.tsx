import { useState } from 'react'
import Icon from './Icon'
import { adminFinancialAction } from '../lib/adminFinancialActions'

// Adjust the money on a placed order: a price difference, a goodwill discount,
// a forgotten item.
//
// It writes a visible LINE, never a header edit. admin_adjust_order() then
// recomputes subtotal as sum(order_items.total), so the total the customer sees
// can never disagree with the lines it is made of. Built after order #60, where
// the menu was stale at checkout and the header had to be corrected by 325 --
// editing the header alone would have left seven lines summing to a different
// number on the customer's own tracking page.
const PRESETS = [
  { label: 'فرق أسعار أصناف', sign: +1 },
  { label: 'صنف ناقص',        sign: +1 },
  { label: 'خصم اعتذار',      sign: -1 },
  { label: 'صنف مرجّع',       sign: -1 },
]

export default function OrderAdjust({ orderId, onDone }: {
  orderId: number
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const [sign, setSign] = useState<1 | -1>(1)
  const [chargeFee, setChargeFee] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    old_total: number; new_total: number; service_fee_waived: number | null
  } | null>(null)

  const value = Number(amount)
  const valid = reason.trim().length > 0 && Number.isFinite(value) && value > 0

  async function submit() {
    if (!valid) return
    setSaving(true); setError('')
    const response = await adminFinancialAction<typeof result>('adjustOrder', {
      orderId,
      amount: sign * value,
      reason: reason.trim(),
      chargeServiceFee: chargeFee,
    })
    setSaving(false)
    if (!response.ok) {
      setError(
        response.code === 'order_cancelled' ? 'الطلب ملغي، مش هينفع نعدّله'
        : response.code === 'negative_total' ? 'الخصم أكبر من إجمالي الطلب'
        : response.code === 'admin_only' ? 'محتاج صلاحية أدمن'
        : response.error)
      return
    }
    setResult(response.data)
    setReason(''); setAmount('')
    onDone()
  }

  async function markAsAuditTest() {
    const reason = window.prompt('سبب اختبار التدقيق (مطلوب)')?.trim()
    if (!reason) return
    if (!window.confirm('تحويل الطلب لاختبار؟ لا يمكن التراجع عنه، ولن يدخل الإيراد أو حسابات المندوب.')) return
    setSaving(true); setError('')
    const response = await adminFinancialAction('markAuditTest', { orderId, reason })
    setSaving(false)
    if (!response.ok) {
      setError(response.code === 'audit_mark_too_late'
        ? 'لازم يتحول لاختبار قبل تعيين مندوب أو أي حركة مالية'
        : response.error)
      return
    }
    onDone()
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3 mt-2">
        <button className="text-xs text-mist hover:text-foam underline"
          onClick={() => { setOpen(true); setResult(null) }}>
          تعديل مبلغ الطلب
        </button>
        <button className="text-xs text-sandink hover:text-foam underline" disabled={saving}
          onClick={markAsAuditTest}>
          <Icon name="flask" className="w-4 h-4 inline-block align-[-0.15em] me-1" />تسجيل كاختبار تدقيق
        </button>
        {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
      </div>
    )
  }

  return (
    <div className="mt-2.5 bg-shellup/60 border border-line rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-bold">تعديل مبلغ الطلب</p>
        <button className="text-mist text-sm" onClick={() => setOpen(false)} aria-label="إغلاق"><Icon name="x" className="w-4 h-4" /></button>
      </div>

      {result && (
        <div className="bg-emerald-500/10 text-emerald-800 rounded-lg p-2.5 mb-2.5 text-xs font-semibold">
          <Icon name="check" className="w-4 h-4 inline-block align-[-0.15em] me-1" />اتعدّل، الإجمالي من {result.old_total} لـ {result.new_total} ج.م
          {result.service_fee_waived
            ? ` · معفي من ${result.service_fee_waived} ج.م رسوم` : ''}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mb-2.5">
        {PRESETS.map(p => (
          <button key={p.label}
            className={`text-[11px] font-semibold rounded-full px-2.5 py-1.5 min-h-[36px] border ${
              reason === p.label ? 'bg-sea text-white border-sea' : 'bg-shell border-line text-foam'}`}
            onClick={() => { setReason(p.label); setSign(p.sign as 1 | -1) }}>
            {p.sign > 0 ? '+' : '−'} {p.label}
          </button>
        ))}
      </div>

      {/* The reason becomes the line's name, so the customer reads it on their
          tracking page. That is deliberate: a charge they cannot identify is
          worse than one they can argue with. */}
      <input className="field !h-10 mb-2 text-sm" value={reason} maxLength={60}
        placeholder="السبب، هيظهر للزبون في الطلب"
        onChange={e => { setReason(e.target.value); setError('') }} />

      <div className="flex items-center gap-2 mb-2.5">
        <button className={`text-sm font-bold rounded-lg px-3 min-h-[40px] border ${
          sign > 0 ? 'bg-sea text-white border-sea' : 'bg-shell border-line'}`}
          onClick={() => setSign(1)} aria-pressed={sign > 0}>+ زيادة</button>
        <button className={`text-sm font-bold rounded-lg px-3 min-h-[40px] border ${
          sign < 0 ? 'bg-red-500 text-white border-red-500' : 'bg-shell border-line'}`}
          onClick={() => setSign(-1)} aria-pressed={sign < 0}>− خصم</button>
        <input className="field !h-10 flex-1 text-center" type="number" inputMode="decimal"
          dir="ltr" placeholder="المبلغ" value={amount}
          onChange={e => { setAmount(e.target.value); setError('') }} />
        <span className="text-xs text-mist">ج.م</span>
      </div>

      {/* Off by default. On a correction the customer is already being asked for
          more than they agreed to at checkout; adding 8% on top of that is the
          moment goodwill is lost. Turning it on is a deliberate act. */}
      {sign > 0 && (
        <label className="flex items-center gap-2 text-xs text-mist mb-2.5">
          <input type="checkbox" className="w-4 h-4" checked={chargeFee}
            onChange={e => setChargeFee(e.target.checked)} />
          احسب رسوم الخدمة على الزيادة كمان
          {!chargeFee && <span className="text-sandink font-semibold"> · الرسوم هتفضل زي ما هي</span>}
        </label>
      )}

      {error && <p className="text-xs text-red-600 font-semibold mb-2">{error}</p>}

      <button className="btn-sea w-full !py-2 text-sm" disabled={!valid || saving} onClick={submit}>
        {saving ? 'جاري التعديل…' : `${sign > 0 ? 'ضيف' : 'اخصم'} ${value || 0} ج.م`}
      </button>
    </div>
  )
}
