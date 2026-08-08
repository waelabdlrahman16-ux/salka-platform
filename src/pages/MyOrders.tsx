import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import CustomerLogin from '../components/CustomerLogin'
import { getSessionToken, useCustomerAuth } from '../lib/customerAuth'
import { rpc } from '../lib/rpc'
import { orderStatusLabel } from '../lib/statusLabels'

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
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showLogin, setShowLogin] = useState(false)

  async function loadOrders() {
    if (!customer?.phone) return
    setBusy(true)
    setError('')
    const res = await rpc<Row[]>('my_orders', {
      // Kept for RPC signature compatibility. The server deliberately ignores
      // this typed value and derives the number from the verified identity.
      p_phone: customer.phone,
      p_session_token: getSessionToken(),
    })
    setBusy(false)
    if (!res.ok) {
      setRows(null)
      setError(res.error)
      return
    }
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
          <p className="text-xs text-mist mt-3">
            الطلب اللي لسه عامله تقدر تتابعه من رابط التتبع اللي ظهر بعد التأكيد.
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
          <button className="btn-ghost mt-3 text-sm" disabled={busy} onClick={loadOrders}>
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
