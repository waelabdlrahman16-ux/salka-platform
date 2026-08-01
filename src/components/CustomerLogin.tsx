import { useState } from 'react'
import { Link } from 'react-router-dom'
import { isValidEgyptPhone, PHONE_HINT } from '../lib/validation'
import { useCustomerAuth } from '../lib/customerAuth'

export default function CustomerLogin({ onDone, onSkip }: { onDone: () => void; onSkip?: () => void }) {
  const { requestOtp, verifyOtp, signInWithGoogle, requestEmailLink } = useCustomerAuth()
  const [mode, setMode] = useState<'main' | 'email' | 'phone' | 'code'>('main')
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [resendIn, setResendIn] = useState(0)
  const [emailLinkSent, setEmailLinkSent] = useState(false)

  function goTo(next: 'main' | 'email' | 'phone' | 'code') {
    setError('')
    setEmailLinkSent(false)
    setMode(next)
  }

  async function sendCode() {
    if (!isValidEgyptPhone(phone)) return
    setSending(true); setError('')
    const res = await requestOtp(phone)
    setSending(false)
    if (!res.ok) {
      setError(
        res.error === 'sms_not_configured' ? 'خدمة الرسائل لسه مش متفعّلة، جرب تسجّل بالإيميل أو جوجل'
          : res.error === 'rate_limited' ? 'حاولت كتير، استنى شوية وجرب تاني'
          : 'حصل خطأ، جرب تاني'
      )
      return
    }
    setMode('code')
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

  async function sendEmailLink() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return
    setSending(true); setError('')
    const res = await requestEmailLink(email)
    setSending(false)
    if (!res.ok) { setError('حصل خطأ، جرب تاني'); return }
    setEmailLinkSent(true)
  }

  return (
    <div className="fixed inset-0 z-50 bg-night grid place-items-center p-4">
      <div className="card w-full max-w-sm p-6 text-center">
        {mode === 'main' && (
          <>
            <div className="text-4xl mb-3">👋</div>
            <h1 className="text-xl font-bold mb-1">أهلاً بيك في سالكة</h1>
            <p className="text-mist text-sm mb-5">سجّل دخولك عشان تتابع طلباتك</p>

            <button className="w-full !py-3 mb-2.5 rounded-xl border-2 border-line font-semibold flex items-center justify-center gap-2.5 hover:bg-shellup/60 transition-colors"
              onClick={signInWithGoogle}>
              <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.9 6 29.7 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.6 18.9 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.9 6 29.7 4 24 4c-7.8 0-14.5 4.5-17.7 10.7z"/><path fill="#4CAF50" d="M24 44c5.6 0 10.7-2.1 14.5-5.7l-6.7-5.7C29.8 34.4 27 35.4 24 35.4c-5.2 0-9.6-3.3-11.3-8l-6.6 5.1C9.4 39.5 16.1 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.2 4.3-4.1 5.7l6.7 5.7C39.9 37.4 44 31.5 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
              المتابعة بجوجل
            </button>

            <button className="w-full !py-3 mb-4 rounded-xl border-2 border-line font-semibold hover:bg-shellup/60 transition-colors"
              onClick={() => goTo('email')}>
              📧 المتابعة بالإيميل
            </button>

            <button className="text-xs text-mist hover:text-foam mb-1" onClick={() => goTo('phone')}>الدخول برقم الموبايل</button>

            {onSkip && (
              <div className="mt-3">
                <button className="text-sm text-mist hover:text-foam" onClick={onSkip}>تخطي دلوقتي</button>
              </div>
            )}
          </>
        )}

        {mode === 'email' && (
          <>
            <div className="text-4xl mb-3">📧</div>
            <h1 className="text-xl font-bold mb-1">الدخول بالإيميل</h1>
            <p className="text-mist text-sm mb-5">هنبعتلك رابط دخول على إيميلك</p>

            {emailLinkSent ? (
              <p className="text-sm bg-emerald-500/10 text-emerald-700 rounded-xl p-3 mb-4">
                ✓ بعتنالك رابط على {email} — افتح الإيميل واضغط عليه عشان تدخل
              </p>
            ) : (
              <>
                <input className="field text-center mb-4" dir="ltr" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" autoFocus />
                {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">{error}</p>}
                <button className="btn-sea w-full !py-3 mb-3"
                  disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || sending} onClick={sendEmailLink}>
                  {sending ? 'جاري الإرسال…' : 'ابعتلي رابط الدخول'}
                </button>
              </>
            )}
            <button className="text-sm text-mist hover:text-foam" onClick={() => goTo('main')}>رجوع</button>
          </>
        )}

        {mode === 'phone' && (
          <>
            <div className="text-4xl mb-3">📱</div>
            <h1 className="text-xl font-bold mb-1">الدخول برقم الموبايل</h1>
            <p className="text-mist text-sm mb-5">هنبعتلك كود تأكيد بالرسائل (SMS)</p>

            <div className="text-right space-y-3 mb-5">
              <div>
                <label className="label">الاسم</label>
                <input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="اسمك بالكامل" />
              </div>
              <div>
                <label className="label">رقم الموبايل</label>
                <input className={`field ${phone.trim() && !isValidEgyptPhone(phone) ? '!border-red-400' : ''}`}
                  dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01xxxxxxxxx" maxLength={13} />
                {phone.trim() && !isValidEgyptPhone(phone) && <p className="text-xs text-red-600 mt-1">{PHONE_HINT}</p>}
              </div>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">{error}</p>}

            <button className="btn-sea w-full !py-3 mb-2" disabled={!isValidEgyptPhone(phone) || sending} onClick={sendCode}>
              {sending ? 'جاري الإرسال…' : 'ابعتلي الكود'}
            </button>
            <button className="text-sm text-mist hover:text-foam" onClick={() => goTo('main')}>رجوع</button>
          </>
        )}

        {mode === 'code' && (
          <>
            <div className="text-4xl mb-3">💬</div>
            <h1 className="text-xl font-bold mb-1">اكتب الكود</h1>
            <p className="text-mist text-sm mb-5">بعتنالك كود من 6 أرقام برسالة نصية على {phone}</p>

            <input className="field text-center text-2xl tracking-widest mb-4" dir="ltr" value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="------" maxLength={6} />

            {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">{error}</p>}

            <button className="btn-sea w-full !py-3 mb-3" disabled={code.length !== 6 || sending} onClick={confirmCode}>
              {sending ? 'جاري التأكيد…' : 'تأكيد'}
            </button>

            <div className="flex items-center justify-between text-sm">
              <button className="text-mist hover:text-foam" onClick={() => goTo('phone')}>غيّر الرقم</button>
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
