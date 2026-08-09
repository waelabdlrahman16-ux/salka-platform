import { useState } from 'react'
import { useCustomerAuth } from '../lib/customerAuth'
import { isValidEgyptPhone, PHONE_HINT } from '../lib/validation'

function message(code?: string) {
  const messages: Record<string, string> = {
    sms_not_configured: 'تأكيد الرقم بالرسالة مش متاح دلوقتي. جرّب لاحقًا.',
    rate_limited: 'محاولات كتير. استنى شوية وجرب تاني.',
    service_busy: 'الخدمة مشغولة دلوقتي. جرّب بعد شوية.',
    invalid_or_expired_code: 'الكود غلط أو انتهت صلاحيته.',
    phone_already_registered: 'الرقم ده مربوط بحساب تاني.',
    not_authenticated: 'سجّل دخولك تاني عشان تغيّر الرقم.',
  }
  return messages[code ?? ''] ?? 'حصل خطأ، جرب تاني.'
}

export default function VerifiedPhoneEditor({ compact = false }: { compact?: boolean }) {
  const { requestPhoneChange, verifyPhoneChange } = useCustomerAuth()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function requestCode() {
    if (!isValidEgyptPhone(phone)) { setError(PHONE_HINT); return }
    setBusy(true); setError('')
    const result = await requestPhoneChange(phone)
    setBusy(false)
    if (!result.ok) { setError(message(result.error)); return }
    setSent(true)
  }

  async function confirm() {
    if (!/^\d{6}$/.test(code)) return
    setBusy(true); setError('')
    const result = await verifyPhoneChange(phone, code)
    setBusy(false)
    if (!result.ok) { setError(message(result.error)); return }
    setPhone(''); setCode(''); setSent(false)
  }

  return (
    <div className={compact ? '' : 'space-y-3'}>
      {!sent ? (
        <div className="space-y-2">
          <input className={`field ${phone.trim() && !isValidEgyptPhone(phone) ? '!border-red-400' : ''}`}
            aria-label="رقم الموبايل الجديد" dir="ltr" value={phone}
            onChange={e => { setPhone(e.target.value); setError('') }}
            placeholder="01xxxxxxxxx" maxLength={13} />
          <button className="btn-sea w-full" disabled={busy || !isValidEgyptPhone(phone)} onClick={requestCode}>
            {busy ? 'جاري الإرسال…' : 'ابعت كود التأكيد'}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-mist">اكتب الكود اللي اتبعت للرقم <span dir="ltr">{phone}</span></p>
          <input className="field text-center tracking-[0.35em]" aria-label="كود التأكيد"
            inputMode="numeric" autoComplete="one-time-code" value={code}
            onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
            placeholder="------" />
          <button className="btn-sea w-full" disabled={busy || code.length !== 6} onClick={confirm}>
            {busy ? 'جاري التأكيد…' : 'تأكيد الرقم'}
          </button>
          <button className="btn-ghost w-full text-sm" disabled={busy} onClick={() => { setSent(false); setCode(''); setError('') }}>
            غيّر الرقم
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600 mt-2" role="alert">{error}</p>}
    </div>
  )
}
