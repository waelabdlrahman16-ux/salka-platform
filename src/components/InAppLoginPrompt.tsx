import { useState } from 'react'
import Icon from './Icon'
import { useCustomerAuth } from '../lib/customerAuth'
import { isInAppBrowser } from '../lib/inAppBrowser'

const DISMISS_KEY = 'salka_inapp_login_dismissed'

// The login ask for customers inside a Facebook/Instagram in-app browser.
//
// App.tsx no longer shows CustomerLogin on arrival for these customers, because
// its primary button is Google and Google is hard-blocked in a WebView. This is
// where the ask moved to: the tracking screen, AFTER an order exists. The
// trade is deliberate -- we lose the chance to capture an account from someone
// who was only browsing, and we gain not putting a dead end in front of every
// paid click. Someone who has just placed an order also has an actual reason to
// want an account, which the arrival prompt never had.
//
// Google is not offered here at all. Not hidden behind a warning, not shown
// disabled -- absent. A button that cannot work is worse than no button.
export default function InAppLoginPrompt({ className = '' }: { className?: string }) {
  const { customer, requestEmailLink } = useCustomerAuth()
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem(DISMISS_KEY))
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  // Signed in already, dismissed once, or in a real browser where the normal
  // login card already did its job -- render nothing.
  if (customer || dismissed || !isInAppBrowser()) return null

  async function send() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('اكتب إيميل صحيح'); return }
    setSending(true); setError('')
    const res = await requestEmailLink(email)
    setSending(false)
    if (!res.ok) { setError('حصل خطأ، جرب تاني'); return }
    setSent(true)
  }

  // Copy, not "open". A button labelled «افتح في المتصفح» would be a lie: iOS
  // gives a WebView no reliable way to hand a URL to Safari. `x-safari-https://`
  // works in some host apps and silently does nothing in others, which reads as
  // a broken button -- worse than an honest one. Copying always works, and the
  // line underneath says what to do with it.
  async function copyLink() {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      return
    } catch { /* clipboard blocked -- fall through to the manual path */ }
    // Older WebViews reject navigator.clipboard on a non-secure origin. Ads land
    // on http:// often enough that this fallback is not theoretical.
    try {
      const ta = document.createElement('textarea')
      ta.value = url
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
    } catch {
      setError('مش قادرين ننسخ اللينك. اضغط على ••• فوق واختار «فتح في المتصفح»')
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  if (sent) {
    return (
      <div className={`card p-4 text-center ${className}`}>
        <p className="text-sm bg-emerald-500/10 text-emerald-700 rounded-xl p-3">
          <Icon name="check" className="w-4 h-4 inline-block align-[-0.15em] me-1" />بعتنالك رابط على {email}، افتح الإيميل واضغط عليه عشان تدخل
        </p>
      </div>
    )
  }

  return (
    <div className={`card p-4 text-center ${className}`}>
      <p className="font-bold text-sm">عايز تتابع طلباتك بعدين؟</p>
      <p className="text-xs text-mist mt-0.5 mb-3">سيبلنا إيميلك ونبعتلك رابط دخول</p>

      <input
        className="field text-center mb-2.5"
        dir="ltr"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@example.com"
        aria-label="الإيميل"
        value={email}
        onChange={e => { setEmail(e.target.value); setError('') }}
      />

      <button className="btn-sea w-full text-sm mb-2" disabled={sending || !email.trim()} onClick={send}>
        {sending ? 'جاري الإرسال…' : '📧 ابعتلي رابط الدخول'}
      </button>

      <button className="btn-ghost w-full text-sm" onClick={copyLink}>
        {copied ? '✓ اتنسخ' : '🔗 انسخ اللينك'}
      </button>
      <p className="text-[11px] text-mist mt-1.5 leading-relaxed">
        {copied
          ? 'افتح المتصفح بتاعك والصق اللينك، هناك تقدر تدخل بجوجل كمان'
          : 'أو اضغط على ••• فوق واختار «فتح في المتصفح»'}
      </p>

      {error && <p className="text-xs text-red-600 bg-red-500/10 rounded-xl p-2 mt-2.5">{error}</p>}

      <button className="text-xs text-mist hover:text-foam mt-3 min-h-[44px] px-4" onClick={dismiss}>
        مش دلوقتي
      </button>
    </div>
  )
}
