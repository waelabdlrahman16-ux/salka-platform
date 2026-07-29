import { useState } from 'react'
import { Link } from 'react-router-dom'
import { isValidEgyptPhone, PHONE_HINT } from '../lib/validation'
import { useCustomerAuth } from '../lib/customerAuth'

export default function CustomerLogin({ onDone, onSkip }: { onDone: () => void; onSkip?: () => void }) {
  const { requestOtp, verifyOtp } = useCustomerAuth()
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [resendIn, setResendIn] = useState(0)

  async function sendCode() {
    if (!isValidEgyptPhone(phone)) return
    setSending(true); setError('')
    const res = await requestOtp(phone)
    setSending(false)
    if (!res.ok) {
      setError(
        res.error === 'whatsapp_not_configured' ? 'خدمة الواتساب لسه مش متفعّلة، حاول لاحقًا'
          : res.error === 'rate_limited' ? 'حاولت كتير، استنى شوية وجرب تاني'
          : 'حصل خطأ، جرب تاني'
      )
      return
    }
    setStep('code')
    setResendIn(30)
    const t = setInterval(() => setResendIn(s => { if (s <= 1) { clearInterval(t); return 0 } return s - 1 }), 1000)
  }

  async function confirmCode() {
    if (code.trim().length !== 6) return
    setSending(true); setError('')
    const res = await verifyOtp(phone, code.trim(), name.trim() || undefined)
    setSending(false)
    if (!res.ok) { setError('الكود غلط أو خلصت صلاحيته'); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 bg-night grid place-items-center p-4">
      <div className="card w-full max-w-sm p-6 text-center">
        {step === 'phone' ? (
          <>
            <div className="text-4xl mb-3">👋</div>
            <h1 className="text-xl font-bold mb-1">أهلاً بيك في سالكة</h1>
            <p className="text-mist text-sm mb-5">هنبعتلك كود تأكيد على الواتساب</p>

            <div className="text-right space-y-3 mb-5">
              <div>
                <label className="label">الاسم</label>
                <input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="اسمك بالكامل" />
              </div>
              <div>
                <label className="label">رقم الموبايل (واتساب)</label>
                <input className={`field ${phone.trim() && !isValidEgyptPhone(phone) ? '!border-red-400' : ''}`}
                  dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01xxxxxxxxx" maxLength={13} />
                {phone.trim() && !isValidEgyptPhone(phone) && <p className="text-xs text-red-600 mt-1">{PHONE_HINT}</p>}
              </div>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">{error}</p>}

            <button className="btn-sea w-full !py-3 mb-2" disabled={!isValidEgyptPhone(phone) || sending} onClick={sendCode}>
              {sending ? 'جاري الإرسال…' : 'ابعتلي الكود'}
            </button>
            {onSkip && (
              <button className="text-sm text-mist hover:text-foam" onClick={onSkip}>تخطي دلوقتي</button>
            )}
          </>
        ) : (
          <>
            <div className="text-4xl mb-3">💬</div>
            <h1 className="text-xl font-bold mb-1">اكتب الكود</h1>
            <p className="text-mist text-sm mb-5">بعتنالك كود من 6 أرقام على واتساب {phone}</p>

            <input className="field text-center text-2xl tracking-widest mb-4" dir="ltr" value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="------" maxLength={6} />

            {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">{error}</p>}

            <button className="btn-sea w-full !py-3 mb-3" disabled={code.length !== 6 || sending} onClick={confirmCode}>
              {sending ? 'جاري التأكيد…' : 'تأكيد'}
            </button>

            <div className="flex items-center justify-between text-sm">
              <button className="text-mist hover:text-foam" onClick={() => setStep('phone')}>غيّر الرقم</button>
              <button className="text-sea font-semibold disabled:opacity-40 disabled:pointer-events-none" disabled={resendIn > 0} onClick={sendCode}>
                {resendIn > 0 ? `أعد الإرسال بعد ${resendIn}` : 'أعد الإرسال'}
              </button>
            </div>
          </>
        )}

        <p className="text-xs text-mist mt-5">
          باستخدامك للتطبيق إنت موافق على <Link to="/terms" className="text-sea underline">الشروط والأحكام</Link>
        </p>
      </div>
    </div>
  )
}
