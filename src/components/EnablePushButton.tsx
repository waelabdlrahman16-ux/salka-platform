import { useEffect, useState } from 'react'
import Icon from './Icon'
import { enablePush, lastPushError, pushDiag, pushPermission, pushSupport, registerPush, resetPushDiag } from '../lib/push'
import type { PushTokenSink } from '../lib/push'
import { iosPushBlocker, isIOS } from '../lib/platform'

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
// diag-v3 -- if this block never appears after a tap, the phone is running an
// older bundle and the problem is caching, not push.
function Trail({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null
  const text = lines.join('\n')
  return (
    <div className="mt-2 rounded-xl bg-night border border-line p-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-mist">تشخيص (diag-v3)</span>
        <button className="text-[10px] text-sea underline"
          onClick={() => { try { navigator.clipboard?.writeText(text) } catch { /* selectable below either way */ } }}>
          نسخ
        </button>
      </div>
      <pre dir="ltr" className="text-[10px] leading-4 text-mist whitespace-pre-wrap break-all select-all">{text}</pre>
    </div>
  )
}

export default function EnablePushButton({
  onToken,
  label = 'فعّل تنبيهات الطلبات',
  required = false,
}: {
  onToken: PushTokenSink
  label?: string
  required?: boolean
}) {
  const [support, setSupport] = useState(() => pushSupport())
  const [permission, setPermission] = useState(() => pushPermission())
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [reason, setReason] = useState('')
  // Tracked separately from `permission`, which reads Notification.permission --
  // an API that does not exist in an Android WebView, so on the native app it
  // answers 'unavailable' forever and this component could never learn that
  // registration had succeeded. The button stayed on screen after a successful
  // tap, which is indistinguishable from the button not working.
  const [granted, setGranted] = useState(false)
  const [checking, setChecking] = useState(false)
  // Rendered on screen because the release APK has no console and no remote
  // debugging. Without this, "the button does nothing" is the entire bug report
  // available from a phone.
  const [trail, setTrail] = useState<string[]>([])

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
    // On native, permission lives in the OS, not in Notification.permission --
    // so gating this on 'granted' meant the app never refreshed its FCM token
    // on load. registerPush() does not prompt on either platform.
    if (s !== 'native' && p !== 'granted') return
    let cancelled = false
    setChecking(true)
    registerPush(onToken).then(ok => {
      if (cancelled) return
      if (ok) { setGranted(true); return }
      // On native this is the ordinary "has not opted in yet" path, and the
      // whole point of the button. Only a browser that reported 'granted' and
      // then failed has something to confess.
      if (s === 'native') return
      setReason(lastPushError || 'التسجيل فشل من غير رسالة')
      setFailed(true)
    }).finally(() => { if (!cancelled) setChecking(false) })
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
        <Trail lines={trail} />
        <button className="btn-ghost !py-1.5 !px-3 text-xs"
          onClick={async () => {
            setBusy(true); setFailed(false); resetPushDiag()
            const ok = await enablePush(onToken)
            setBusy(false); setPermission(pushPermission()); setTrail([...pushDiag])
            if (ok) setGranted(true)
            else { setReason(lastPushError); setFailed(true) }
          }}>جرب تاني</button>
      </div>
    )
  }

  // iOS SAYS SOMETHING NOW INSTEAD OF NOTHING.
  //
  // This used to `return null` for every browser without the Push API, which on
  // an iPhone is most of them -- so the answer to "why don't notifications work
  // on my iPhone?" was a blank space. iOS 16.4+ can do web push, but ONLY for a
  // site added to the Home Screen, and only in Safari: Chrome/Firefox/Edge on
  // iOS are WebKit underneath and the Push API is simply not exposed to them.
  // Neither fact is discoverable by pressing anything, so the app has to say it.
  const iosBlock = iosPushBlocker()
  if (support !== 'native' && iosBlock) {
    return (
      <p className="text-xs text-sandink bg-sand/10 rounded-xl p-3 mb-3 leading-relaxed">
        {iosBlock === 'not-safari'
          ? <>التنبيهات على الآيفون بتشتغل من <b>سفاري</b> بس. افتح سالكة في سفاري، وبعدين
              اضغط <b>زر المشاركة ⬆️</b> واختار <b>«إضافة إلى الشاشة الرئيسية»</b>. وافتحها
              من الأيقونة دي بعد كده.</>
          : <>عشان التنبيهات تشتغل على الآيفون، لازم تضيف سالكة على الشاشة الرئيسية:
              اضغط <b>زر المشاركة ⬆️</b> تحت، وبعدين <b>«إضافة إلى الشاشة الرئيسية»</b>،
              وافتحها من الأيقونة.</>}
      </p>
    )
  }

  // An installed iPhone app on iOS older than 16.4 has no Push API. Returning
  // nothing here makes an unavailable device look like a successfully enrolled
  // one, which is worse than a clear limitation.
  if (support === 'unsupported' && isIOS()) {
    return (
      <p className="text-xs text-sandink bg-sand/10 rounded-xl p-3 mb-3 leading-relaxed">
        التنبيهات محتاجة iOS 16.4 أو أحدث. حدّث الآيفون، وبعدها افتح سالكة من أيقونة الشاشة الرئيسية وفعّل التنبيهات.
      </p>
    )
  }
  if (support === 'unsupported' || support === 'unconfigured') return null
  if (checking) return (
    <div className={`mb-3 rounded-xl p-3 text-sm ${required ? 'border border-sand/50 bg-sand/10' : 'bg-shellup/60'}`}>
      <p className="font-semibold">جاري التأكد إن الجهاز مسجل للتنبيهات…</p>
    </div>
  )
  if (granted || permission === 'granted') return null

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
    <div className={`mb-3 ${required ? 'rounded-xl border border-sand/50 bg-sand/10 p-3' : ''}`}>
      {required && (
        <div className="mb-2">
          <p className="text-sm font-bold text-sandink">لازم تفعّل التنبيهات قبل ما تعتمد على الشاشة دي</p>
          <p className="text-xs text-mist mt-0.5">من غيرها ممكن طلب جديد يوصل للنظام من غير ما جهازك ينبهك.</p>
        </div>
      )}
      <button
        className="btn-sea w-full !py-3"
        disabled={busy}
        onClick={async () => {
          setBusy(true); setFailed(false); resetPushDiag()
          const ok = await enablePush(onToken)
          setBusy(false)
          setPermission(pushPermission()); setTrail([...pushDiag])
          if (ok) setGranted(true)
          else { setReason(lastPushError); setFailed(true) }
        }}>
        {busy ? 'جاري التفعيل…' : <><Icon name="bell" size="sm" className="inline-block align-[-0.15em] me-1" />{label}</>}
      </button>
      <p className="text-xs text-mist mt-1.5 text-center">
        من غير التنبيهات لازم تسيب الصفحة مفتوحة عشان تعرف إن في طلب جديد
      </p>
      <Trail lines={trail} />
      {failed && (
        <p className="text-xs text-red-600 bg-red-500/10 rounded-xl p-2.5 mt-2">
          مش قادرين نفعّل التنبيهات دلوقتي. جرب تاني، ولو المشكلة اتكررت افتح الموقع من المتصفح مباشرة
        </p>
      )}
    </div>
  )
}
