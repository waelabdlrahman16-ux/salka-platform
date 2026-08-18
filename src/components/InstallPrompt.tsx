import { useEffect, useState } from 'react'
import { isIOS, isStandalone } from '../lib/platform'
import { clearInstallPrompt, onInstallPrompt } from '../lib/installPrompt'

const DISMISS_KEY = 'salka_install_dismissed'

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [showIOSHelp, setShowIOSHelp] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [stepsOpen, setStepsOpen] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === '1') { setDismissed(true); return }
    if (isStandalone()) return

    if (isIOS()) {
      setShowIOSHelp(true)
      return
    }

    // Subscribing, NOT listening. This component now mounts from Track's
    // delivered state, long after Chrome has already fired
    // `beforeinstallprompt` -- an own listener here would attach to an event
    // that has already gone, which is exactly what happened on 2026-08-07 and
    // made the Android install path unreachable. lib/installPrompt catches it
    // at app start and replays it to whoever is listening.
    return onInstallPrompt(setDeferredPrompt)
  }, [])

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  async function install() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    // Spent either way -- Chrome will not honour the same event twice.
    clearInstallPrompt()
    setDeferredPrompt(null)
  }

  if (dismissed || isStandalone()) return null
  if (!deferredPrompt && !showIOSHelp) return null

  // A CARD, not a page-wide banner, and rendered by the caller at the moment it
  // has earned -- see Track's delivered state. It no longer opens with an iOS
  // instruction manual: the headline is what the customer gets, and the steps
  // are behind «إزاي؟» for the one person in ten who wants them.
  return (
    <div className="card p-3 flex items-start gap-3">
      <img src="/icon-192.png" alt="" className="w-10 h-10 rounded-xl shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm">اطلب المرة الجاية في ثانية</p>
        <p className="text-xs text-mist mt-0.5">
          حطّ سالكة على شاشتك الرئيسية
          {showIOSHelp && (
            <>
              {' · '}
              <button className="text-sea font-bold underline" onClick={() => setStepsOpen(o => !o)}>
                {stepsOpen ? 'إخفاء' : 'إزاي؟'}
              </button>
            </>
          )}
        </p>
        {showIOSHelp && stepsOpen && (
          <p className="text-xs text-mist mt-2 bg-shellup rounded-lg p-2.5 leading-relaxed">
            اضغط <span className="font-bold">زر المشاركة</span> ⬆️ تحت،
            وبعدين <span className="font-bold">"إضافة إلى الشاشة الرئيسية"</span>
          </p>
        )}
        {!showIOSHelp && (
          <button className="btn-sea !py-1.5 !px-4 text-xs mt-2.5" onClick={install}>تثبيت</button>
        )}
      </div>
      {/* 44x44. It was 23x18 -- under half the minimum, on a banner the customer
          most wanted to get rid of. */}
      <button className="w-11 h-11 -m-1 shrink-0 grid place-items-center text-mist text-xl leading-none rounded-lg hover:bg-shellup"
        onClick={dismiss} aria-label="إغلاق">×</button>
    </div>
  )
}
