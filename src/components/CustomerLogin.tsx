import { useEffect, useRef, useState, useId } from 'react'
import Icon from './Icon'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'
import { isValidEgyptPhone, PHONE_HINT } from '../lib/validation'
import { useCustomerAuth } from '../lib/customerAuth'
import { googleSignInBlocked } from '../lib/inAppBrowser'

export default function CustomerLogin({ onDone, onSkip }: { onDone: () => void; onSkip?: () => void }) {
  const fid = useId()
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
  const resendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // SMS OTP is built but cannot work until SMS Misr approves the sender ID and
  // template, so the entry point is hidden behind a settings flag rather than
  // removed -- flipping it in the admin panel is the whole rollout.
  //
  // Defaults to hidden and only opens on an explicit 'true'. A failed or slow
  // settings read therefore hides the option, which is the safe direction: a
  // missing login method is a smaller harm than one that always errors.
  const [smsEnabled, setSmsEnabled] = useState(false)
  useEffect(() => {
    let cancelled = false
    supabase.from('settings').select('value').eq('key', 'sms_login_enabled').maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error) return
        setSmsEnabled(data?.value === 'true')
      })
    return () => { cancelled = true }
  }, [])

  // Guard the state as well as the button: if the flag is turned off while
  // someone is mid-flow, drop them back rather than leaving them on a screen
  // whose submit can only fail.
  useEffect(() => {
    if (!smsEnabled && (mode === 'phone' || mode === 'code')) setMode('main')
  }, [smsEnabled, mode])

  // The resend countdown was started with a bare setInterval outside any effect
  // and never cleared. confirmCode() calls onDone(), which unmounts this
  // component immediately on success, leaving the timer ticking against an
  // unmounted tree for up to 30 seconds.
  useEffect(() => {
    return () => { if (resendTimerRef.current) clearInterval(resendTimerRef.current) }
  }, [])

  // Escape steps back through the flow, and only dismisses from the top level.
  // A blanket dismiss would be destructive mid-OTP: App.tsx's onSkip writes
  // salka_onboarded, so pressing Escape while typing a code the user had just
  // been texted would close onboarding for good and waste that code.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (mode === 'code') { goTo('phone'); return }
      if (mode === 'phone' || mode === 'email') { goTo('main'); return }
      if (onSkip) onSkip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSkip, mode])

  function startResendCountdown(seconds = 30) {
    if (resendTimerRef.current) clearInterval(resendTimerRef.current)
    setResendIn(seconds)
    resendTimerRef.current = setInterval(() => {
      setResendIn(s => {
        if (s <= 1) {
          if (resendTimerRef.current) clearInterval(resendTimerRef.current)
          resendTimerRef.current = null
          return 0
        }
        return s - 1
      })
    }, 1000)
  }

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
          : res.error === 'rate_limited' ? 'حاولت كتير، استنى 10 دقايق وجرب تاني، أو ادخل بجوجل/الإيميل'
          : res.error === 'service_busy' ? 'الخدمة مزحومة دلوقتي، جرب كمان شوية أو ادخل بجوجل/الإيميل'
          : res.error === 'invalid_phone' ? 'رقم الموبايل مش مظبوط'
          : res.error === 'sms_send_failed' ? 'مش قادرين نبعت الكود دلوقتي، جرب تاني أو ادخل بجوجل/الإيميل'
          : 'حصل خطأ، جرب تاني'
      )
      // Neither a rate limit nor a tripped circuit breaker is fixed by tapping
      // again, and the phone screen has no cooldown of its own -- so impose one
      // rather than inviting the user to burn the rest of their five attempts.
      if (res.error === 'rate_limited' || res.error === 'service_busy') startResendCountdown(60)
      return
    }
    setMode('code')
    startResendCountdown()
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

  // The backdrop used to be an opaque `bg-night`, and App.tsx did not render
  // <main> at all until this was dismissed -- so a first-time visitor's entire
  // first impression was a login card on an empty page, with no restaurants, no
  // prices and no evidence the service works. Ordering never required an account
  // (settings.require_customer_login = 'false'), so the wall bought nothing and
  // cost every visitor who was not ready to sign in to a brand they had not
  // heard of. It is now translucent over the live app.
  //
  // Backdrop click dismisses only from the top level, the same rule Escape uses
  // above and for the same reason: a dismiss mid-OTP would burn the code the
  // customer had just been texted.
  return (
    <div
      className="fixed inset-0 z-50 bg-night/80 backdrop-blur-sm grid place-items-center p-4"
      role="dialog" aria-labelledby="customer-login-title" aria-modal="true"
      onClick={e => { if (e.target === e.currentTarget && onSkip && mode === 'main') onSkip() }}>
      <div className="card w-full max-w-sm p-6 text-center relative">
        {/* Only at the top level -- the sub-steps already have their own
            "رجوع", and a dismiss from mid-OTP would burn the code just sent. */}
        {onSkip && mode === 'main' && (
          <button
            className="absolute top-2 left-2 w-11 h-11 grid place-items-center text-mist hover:text-foam text-xl"
            aria-label="إغلاق"
            onClick={onSkip}>
            <Icon name="x" size="md" />
          </button>
        )}
        {mode === 'main' && (
          <>
            <div className="text-4xl mb-3">👋</div>
            <h1 id="customer-login-title" className="text-xl font-bold mb-1">أهلاً بيك في سالكة</h1>
            <p className="text-mist text-sm mb-5">سجّل دخولك عشان تتابع طلباتك</p>

            {/* App.tsx no longer opens this card on arrival inside a Facebook or
                Instagram in-app browser, but the card is still reachable there
                by hand from «طلباتي» and Profile -- so the Google button has to
                go on this screen too, or the dead end just moves one tap deeper.
                Google answers `403: disallowed_useragent` in an embedded
                WebView; a button that cannot work is worse than no button. */}
            {!googleSignInBlocked() && (
              <button className="w-full !py-3 mb-2.5 rounded-xl border-2 border-line font-semibold flex items-center justify-center gap-2.5 hover:bg-shellup/60 transition-colors"
                onClick={signInWithGoogle}>
                <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.9 6 29.7 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.6 18.9 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.9 6 29.7 4 24 4c-7.8 0-14.5 4.5-17.7 10.7z"/><path fill="#4CAF50" d="M24 44c5.6 0 10.7-2.1 14.5-5.7l-6.7-5.7C29.8 34.4 27 35.4 24 35.4c-5.2 0-9.6-3.3-11.3-8l-6.6 5.1C9.4 39.5 16.1 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.2 4.3-4.1 5.7l6.7 5.7C39.9 37.4 44 31.5 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
                المتابعة بجوجل
              </button>
            )}

            <button className="w-full !py-3 mb-4 rounded-xl border-2 border-line font-semibold hover:bg-shellup/60 transition-colors"
              onClick={() => goTo('email')}>
              <Icon name="envelope" size="sm" className="inline-block align-[-0.15em] me-1" />المتابعة بالإيميل
            </button>

            {/* Only shown where Google was removed, so it explains the gap
                rather than appearing as unexplained advice. */}
            {googleSignInBlocked() && (
              <p className="text-[11px] text-mist -mt-2 mb-4 leading-relaxed">
                الدخول بجوجل مش شغّال جوه فيسبوك. اضغط على ••• فوق واختار «فتح في المتصفح» لو عايزه
              </p>
            )}

            {smsEnabled && (
              <button className="text-xs text-mist hover:text-foam mb-1" onClick={() => goTo('phone')}>الدخول برقم الموبايل</button>
            )}

            {onSkip && (
              <div className="mt-3">
                <button className="inline-flex items-center justify-center min-h-[44px] px-4 text-sm text-mist hover:text-foam" onClick={onSkip}>تخطي دلوقتي</button>
              </div>
            )}
          </>
        )}

        {mode === 'email' && (
          <>
            <Icon name="envelope" size="xl" className="mx-auto mb-3 text-mist" />
            <h1 className="text-xl font-bold mb-1">الدخول بالإيميل</h1>
            <p className="text-mist text-sm mb-5">هنبعتلك رابط دخول على إيميلك</p>

            {emailLinkSent ? (
              <p className="text-sm bg-emerald-500/10 text-emerald-700 rounded-xl p-3 mb-4">
                <Icon name="check" size="sm" className="inline-block align-[-0.15em] me-1" />بعتنالك رابط على {email}، افتح الإيميل واضغط عليه عشان تدخل
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
            <Icon name="mobileScreen" size="xl" className="mx-auto mb-3 text-mist" />
            <h1 className="text-xl font-bold mb-1">الدخول برقم الموبايل</h1>
            <p className="text-mist text-sm mb-5">هنبعتلك كود تأكيد بالرسائل (SMS)</p>

            <div className="text-right space-y-3 mb-5">
              <div>
                <label className="label" htmlFor={`${fid}-1`}>الاسم</label>
                <input id={`${fid}-1`} className="field" value={name} onChange={e => setName(e.target.value)} placeholder="اسمك بالكامل" />
              </div>
              <div>
                <label className="label" htmlFor={`${fid}-2`}>رقم الموبايل</label>
                <input id={`${fid}-2`} className={`field ${phone.trim() && !isValidEgyptPhone(phone) ? '!border-red-400' : ''}`}
                  dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01xxxxxxxxx" maxLength={13} />
                {phone.trim() && !isValidEgyptPhone(phone) && <p className="text-xs text-red-600 mt-1">{PHONE_HINT}</p>}
              </div>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">{error}</p>}

            <button className="btn-sea w-full !py-3 mb-2" disabled={!isValidEgyptPhone(phone) || sending || resendIn > 0} onClick={sendCode}>
              {sending ? 'جاري الإرسال…' : resendIn > 0 ? `استنى ${resendIn} ثانية` : 'ابعتلي الكود'}
            </button>
            <button className="text-sm text-mist hover:text-foam" onClick={() => goTo('main')}>رجوع</button>
          </>
        )}

        {mode === 'code' && (
          <>
            <Icon name="chatCircle" size="xl" className="mx-auto mb-3 text-mist" />
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
