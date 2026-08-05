import { useEffect, useState } from 'react'
import { enablePush, lastPushError, pushPermission, pushSupport, registerPush } from '../lib/push'

/**
 * Explicit opt-in control for notifications.
 *
 * Deliberately a button rather than a prompt on mount. Browsers require a user
 * gesture for a permission request to be trustworthy, Chrome downranks origins
 * that ask on load, and -- most practically -- a driver who dismisses the
 * dialog once can never be asked again by that origin. It is worth one tap to
 * ask at a moment the person understands why.
 *
 * Renders nothing when there is nothing useful to offer: already granted, no
 * VAPID key configured yet, or a browser without web push (iOS Safari in a tab
 * rather than installed to the Home Screen).
 */
export default function EnablePushButton({
  onToken,
  label = 'فعّل تنبيهات الطلبات',
}: {
  onToken: (token: string) => void
  label?: string
}) {
  const [support, setSupport] = useState(() => pushSupport())
  const [permission, setPermission] = useState(() => pushPermission())
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [reason, setReason] = useState('')

  useEffect(() => {
    const s = pushSupport()
    const p = pushPermission()
    setSupport(s)
    setPermission(p)

    // Granted permission is NOT the same as a working registration, and
    // treating them as the same is why push_tokens sat at zero rows while
    // every page reported "notifications on". askNotificationPermission()
    // runs on mount and flips permission to 'granted' immediately; this
    // component then hid itself, and the separate registerPush() call that
    // actually mints the token failed silently into console.error. Nothing on
    // screen ever said the phone was unreachable.
    //
    // So when permission is already granted, register here and hold the
    // result. Success hides the component, which is the same end state as
    // before. Failure shows the reason, which is new.
    if (p !== 'granted') return
    let cancelled = false
    registerPush(onToken).then(ok => {
      if (cancelled || ok) return
      setReason(lastPushError || 'التسجيل فشل من غير رسالة')
      setFailed(true)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The failure message comes FIRST. Registration grants permission and then
  // fails at getToken, which flipped permission to 'granted' and made this
  // component return null -- so the button vanished mid-tap and the error it
  // had just recorded was never rendered. Three attempts, no information.
  if (failed) {
    return (
      <div className="mb-3 text-xs bg-red-500/10 rounded-xl p-3 space-y-2">
        <p className="text-red-700 font-semibold">التنبيهات مافعّلتش</p>
        <p className="text-mist break-all" dir="ltr">{reason || 'سبب غير معروف'}</p>
        <button className="btn-ghost !py-1.5 !px-3 text-xs"
          onClick={async () => {
            setBusy(true); setFailed(false)
            const ok = await enablePush(onToken)
            setBusy(false); setPermission(pushPermission())
            if (!ok) { setReason(lastPushError); setFailed(true) }
          }}>جرب تاني</button>
      </div>
    )
  }

  if (support === 'unsupported' || support === 'unconfigured') return null
  if (permission === 'granted') return null

  // Denied is a dead end until the person changes it in browser settings, so
  // say that plainly instead of showing a button that can no longer do
  // anything -- a second click would not even produce a dialog.
  if (permission === 'denied') {
    return (
      <p className="text-xs text-sandink bg-sand/10 rounded-xl p-3 mb-3">
        التنبيهات متمنوعة من إعدادات المتصفح. لازم تسمح بيها من إعدادات الموقع عشان توصلك الطلبات وانت مقفل الشاشة.
      </p>
    )
  }

  return (
    <div className="mb-3">
      <button
        className="btn-sea w-full !py-3"
        disabled={busy}
        onClick={async () => {
          setBusy(true); setFailed(false)
          const ok = await enablePush(onToken)
          setBusy(false)
          setPermission(pushPermission())
          if (!ok) { setReason(lastPushError); setFailed(true) }
        }}>
        {busy ? 'جاري التفعيل…' : `🔔 ${label}`}
      </button>
      <p className="text-xs text-mist mt-1.5 text-center">
        من غير التنبيهات لازم تسيب الصفحة مفتوحة عشان تعرف إن في طلب جديد
      </p>
      {failed && (
        <p className="text-xs text-red-600 bg-red-500/10 rounded-xl p-2.5 mt-2">
          مش قادرين نفعّل التنبيهات دلوقتي — جرب تاني، ولو المشكلة اتكررت افتح الموقع من المتصفح مباشرة
        </p>
      )}
    </div>
  )
}
