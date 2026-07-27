import { useEffect, useState } from 'react'

const DISMISS_KEY = 'salka_install_dismissed'

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as any).standalone === true // iOS Safari
}

function isIOS() {
  const ua = navigator.userAgent
  const classic = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream
  // iPadOS 13+ reports as a Mac in the user agent, but has touch support
  const modernIpad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return classic || modernIpad
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [showIOSHelp, setShowIOSHelp] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === '1') { setDismissed(true); return }
    if (isStandalone()) return

    if (isIOS()) {
      setShowIOSHelp(true)
      return
    }

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  }, [])

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  async function install() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
  }

  if (dismissed || isStandalone()) return null
  if (!deferredPrompt && !showIOSHelp) return null

  return (
    <div className="bg-sea/10 border-b border-sea/20">
      <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-3">
        <span className="w-8 h-8 rounded-lg bg-sea/15 text-sea grid place-items-center font-bold shrink-0 text-sm">س</span>
        <div className="flex-1 min-w-0 text-xs sm:text-sm">
          {showIOSHelp ? (
            <p>
              ثبّت سالكة على شاشتك الرئيسية: اضغط <span className="font-bold">زر المشاركة</span> ⬆️،
              بعدين <span className="font-bold">"إضافة إلى الشاشة الرئيسية"</span>
            </p>
          ) : (
            <p className="font-semibold">ثبّت تطبيق سالكة على موبايلك لسهولة الوصول</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!showIOSHelp && (
            <button className="btn-sea !py-1 !px-3 text-xs sm:text-sm" onClick={install}>تثبيت</button>
          )}
          <button className="text-mist text-lg leading-none px-1" onClick={dismiss} aria-label="إغلاق">×</button>
        </div>
      </div>
    </div>
  )
}
