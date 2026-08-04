import { useState } from 'react'
import { isValidEgyptPhone, PHONE_HINT } from '../lib/validation'
import { useCustomerAuth } from '../lib/customerAuth'
import { useDismissable } from '../lib/useDismissable'

export default function PhonePrompt() {
  const { updatePhone, logout } = useCustomerAuth()
  // null: deliberately unskippable -- an order cannot be delivered without a
  // phone number. It still gets the focus trap, so Tab cannot wander into the
  // page underneath, which is what made this feel like a hang.
  const overlayRef = useDismissable<HTMLDivElement>(null)
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!isValidEgyptPhone(phone)) return
    setSaving(true); setError('')
    const res = await updatePhone(phone)
    setSaving(false)
    if (!res.ok) setError('حصل خطأ، جرب تاني')
  }

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 bg-night grid place-items-center p-4" role="dialog" aria-modal="true">
      <div className="card w-full max-w-sm p-6 text-center">
        <div className="text-4xl mb-3">📱</div>
        <h1 className="text-xl font-bold mb-1">رقم موبايلك؟</h1>
        <p className="text-mist text-sm mb-5">محتاجينه عشان المندوب يقدر يوصلك ويكلمك</p>

        <input className={`field text-center mb-4 ${phone.trim() && !isValidEgyptPhone(phone) ? '!border-red-400' : ''}`}
          dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01xxxxxxxxx" maxLength={13} />
        {phone.trim() && !isValidEgyptPhone(phone) && <p className="text-xs text-red-600 -mt-3 mb-4">{PHONE_HINT}</p>}

        {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">{error}</p>}

        <button className="btn-sea w-full !py-3 mb-3" disabled={!isValidEgyptPhone(phone) || saving} onClick={save}>
          {saving ? 'جاري الحفظ…' : 'تأكيد'}
        </button>
        <button className="text-sm text-mist hover:text-foam" onClick={logout}>تسجيل خروج</button>
      </div>
    </div>
  )
}
