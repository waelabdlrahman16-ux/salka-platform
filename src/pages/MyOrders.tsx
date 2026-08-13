import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import CustomerLogin from '../components/CustomerLogin'
import { getSessionToken, useCustomerAuth } from '../lib/customerAuth'
import { customerSessionAccess } from '../lib/customerSessionAccess'
import { orderStatusLabel } from '../lib/statusLabels'
import { useAuth } from '../lib/auth'
import { isValidEgyptPhone } from '../lib/validation'
import { customerAccount } from '../lib/customerAccounts'

interface Row {
  id: number
  public_token: string
  total: number
  status: string
  created_at: string
  restaurant_name: string
  pricing_status?: 'n/a' | 'pending_quote' | 'confirmed'
}

export default function MyOrders() {
  const { customer, loading: authLoading, logout } = useCustomerAuth()
  const { session } = useAuth()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showLogin, setShowLogin] = useState(false)
  const [recoveryPhone, setRecoveryPhone] = useState('')
  const [recoveryState, setRecoveryState] = useState<'idle'|'sending'|'sent'|'error'>('idle')

  async function requestRecovery() {
    if (!isValidEgyptPhone(recoveryPhone)) return
    setRecoveryState('sending')
    const res = await customerAccount('requestRecovery', { phone: recoveryPhone })
    setRecoveryState(res.ok ? 'sent' : 'error')
  }

  async function loadOrders(background = false) {
    if (!customer?.phone) return
    if (!background) setBusy(true)
    setError('')
    const res = await customerSessionAccess<Row[]>('orders', {
      // Kept for RPC signature compatibility. The server deliberately ignores
      // this typed value and derives the number from the verified identity.
      phone: customer.phone,
      sessionToken: getSessionToken(),
    })
    if (!background) setBusy(false)
    if (!res.ok) {
      // A background poll failing (e.g. one dropped request) shouldn't wipe
      // an already-loaded list -- only the initial, foreground load does that.
      if (!background) setRows(null)
      setError(res.error)
      return
    }
    setError('')
    setRows(res.data ?? [])
  }

  async function signOut() {
    setRows(null)
    setError('')
    await logout()
  }

  useEffect(() => {
    if (authLoading) return
    if (!customer?.phone) {
      setRows(null)
      return
    }
    loadOrders()
    // A supervisor pricing a custom order, or any other status change, used
    // to only reach this list on the next mount -- a customer already sitting
    // here would see a stale "قيد التسعير" indefinitely. Poll like Track.tsx
    // does, but skip the busy flag so it doesn't flash the loading text over
    // an already-populated list every 10s.
    const t = setInterval(() => loadOrders(true), 10000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, customer?.id, customer?.phone])

  if (authLoading) {
    return <p className="text-center text-mist text-sm mt-8">جاري التحميل…</p>
  }

  return (
    <div className="max-w-sm mx-auto">
      {showLogin && (
        <CustomerLogin
          onDone={() => setShowLogin(false)}
          onSkip={() => setShowLogin(false)}
        />
      )}

      {session && !customer && (
        <div className="card p-5 mt-5 text-center">
          <p className="font-semibold">عندك طلبات قديمة؟</p>
          <p className="text-sm text-mist mt-1.5">اكتب رقمك القديم. هنراجع الطلب ونتصل بيك قبل ما نربط الحساب.</p>
          {recoveryState === 'sent' ? <p className="text-sm text-sea mt-3">تم إرسال طلبك — هنراجع ونتصل بيك.</p> : <>
            <input className="field text-center mt-4" dir="ltr" value={recoveryPhone} onChange={e => setRecoveryPhone(e.target.value)} placeholder="010xxxxxxxx" />
            <button className="btn-sea w-full mt-2" disabled={recoveryState==='sending'||!isValidEgyptPhone(recoveryPhone)} onClick={requestRecovery}>اربط طلباتي القديمة</button>
            {recoveryState === 'error' && <p className="text-xs text-red-700 mt-2">مش قادرين نسجل الطلب دلوقتي. جرّب تاني.</p>}
          </>}
        </div>
      )}

      {customer ? (
        <div className="card p-4 mt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{customer.name || 'حسابك'}</p>
              {customer.phone && (
                <p className="text-xs text-mist mt-0.5" dir="ltr">{customer.phone}</p>
              )}
            </div>
            <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={signOut}>
              خروج
            </button>
          </div>
          <Link
            to="/profile"
            className="btn-ghost w-full mt-3 text-sm !flex items-center justify-center"
          >
            📍 عناويني ومحفظتي
          </Link>
        </div>
      ) : (
        <div className="card p-6 mt-4 text-center">
          <h1 className="text-xl font-bold">طلباتك خاصة</h1>
          <p className="text-sm text-mist mt-2">
            سجّل دخولك عشان تشوف طلباتك السابقة وتتبعها بأمان.
          </p>
          <button className="btn-sea w-full mt-4" onClick={() => setShowLogin(true)}>
            تسجيل الدخول
          </button>
          {/* Phone/OTP login is currently hidden (SMS Misr not live yet), so
              "سجّل دخولك" without more detail can read as a dead end if the
              tracking tab/link is already gone -- Google or email are the
              methods that actually work today, and are worth naming
              explicitly rather than leaving the guest to discover that by
              tapping through the login sheet themselves. */}
          <p className="text-xs text-mist mt-3">
            الطلب اللي لسه عامله تقدر تتابعه من رابط التتبع اللي ظهر بعد التأكيد —
            يفضّل تحفظه أو تاخد له سكرين شوت. لو قفلت الرابط، سجّل دخولك بجوجل أو
            بالإيميل عشان تربط طلباتك بحسابك وتقدر تلاقيها تاني في أي وقت.
          </p>
        </div>
      )}

      {customer && !customer.phone && (
        <div className="card p-5 mt-5 text-center">
          <p className="font-semibold">ضيف رقم موبايلك الأول</p>
          <p className="text-sm text-mist mt-1.5">
            الرقم بيربط طلباتك القديمة بحسابك من غير ما يكشفها لأي حد تاني.
          </p>
          <Link to="/profile" className="btn-sea mt-4 inline-flex">
            إضافة رقم الموبايل
          </Link>
        </div>
      )}

      {customer?.phone && busy && (
        <p className="text-center text-mist text-sm mt-6">جاري تحميل طلباتك…</p>
      )}

      {customer?.phone && error && (
        <div className="card p-4 mt-5 text-center">
          <p className="text-sm text-red-600">{error}</p>
          <button className="btn-ghost mt-3 text-sm" disabled={busy} onClick={() => loadOrders()}>
            جرب تاني
          </button>
        </div>
      )}

      {customer?.phone && !busy && !error && rows?.length === 0 && (
        <p className="text-center text-mist text-sm mt-5">مفيش طلبات على حسابك لسه</p>
      )}

      {customer?.phone && !error && (
        <div className="space-y-3 mt-5">
          {(rows ?? []).map(order => (
            <Link
              key={order.id}
              to={`/track/${order.public_token}`}
              className="card p-4 block hover:border-sea/50"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">#{order.id} — {order.restaurant_name}</p>
                  <p className="text-xs text-mist mt-0.5">
                    {new Date(order.created_at).toLocaleDateString('ar-EG-u-nu-latn', {
                      timeZone: 'Africa/Cairo',
                    })} · {orderStatusLabel(order.status)}
                  </p>
                </div>
                <span className={`font-bold shrink-0 ${
                  order.pricing_status === 'pending_quote' ? 'text-mist text-xs' : 'text-sea'
                }`}>
                  {order.pricing_status === 'pending_quote' ? 'قيد التسعير' : `${order.total} ج.م`}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
