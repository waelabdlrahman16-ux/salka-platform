import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { rpc } from '../lib/rpc'
import { useCustomerAuth, getSessionToken } from '../lib/customerAuth'
import { orderStatusLabel } from '../lib/statusLabels'
import CustomerLogin from '../components/CustomerLogin'

interface Row {
  id: number; public_token: string; total: number
  status: string; created_at: string; restaurant_name: string
}

export default function MyOrders() {
  const { customer, loading: authLoading, logout } = useCustomerAuth()
  const [phone, setPhone] = useState(() => customer?.phone ?? localStorage.getItem('salka_phone') ?? '')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showLogin, setShowLogin] = useState(false)

  async function search(overridePhone?: string) {
    const target = (overridePhone ?? phone).trim()
    if (!target) return
    setBusy(true); setError('')
    const res = await rpc<Row[]>('my_orders', { p_phone: target, p_session_token: getSessionToken() })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    setRows(res.data ?? [])
  }

  // `customer` is null on first render while auth resolves asynchronously, so a
  // Google-signed-in user on a fresh device had no phone, this effect never
  // ran, and the account branch below has no phone input and no retry -- the
  // list stayed permanently empty with no way out. Re-run once auth settles.
  useEffect(() => {
    if (authLoading) return
    const known = customer?.phone ?? phone
    if (known?.trim()) {
      if (!phone.trim() && customer?.phone) setPhone(customer.phone)
      search(known)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, customer?.phone])

  return (
    <div className="max-w-sm mx-auto">
      {/* onSkip was omitted, so CustomerLogin's skip button never rendered. The
          sheet is an opaque full-screen overlay above the nav with no close, no
          back and no Escape handler -- tapping "sign in" trapped the user until
          they completed a login or reloaded the page. */}
      {showLogin && <CustomerLogin onDone={() => setShowLogin(false)} onSkip={() => setShowLogin(false)} />}
      {customer ? (
        <div className="card p-4 mt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{customer.name || 'حسابك'}</p>
              <p className="text-xs text-mist mt-0.5" dir="ltr">{customer.phone}</p>
            </div>
            <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={logout}>خروج</button>
          </div>
          <Link to="/profile" className="btn-ghost w-full mt-3 text-sm !flex items-center justify-center">📍 عناويني ومحفظتي</Link>
          {/* A signed-in account with no phone on file has nothing to look up.
              Give it an input rather than an eternally empty list. */}
          {!customer.phone && (
            <div className="mt-3 pt-3 border-t border-line">
              <p className="text-sm text-mist mb-2">ضيف رقم موبايلك عشان نجيب طلباتك السابقة</p>
              <input className="field" dir="ltr" value={phone} placeholder="01xxxxxxxxx"
                onChange={e => setPhone(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()} />
              <button className="btn-sea w-full mt-2 text-sm" disabled={!phone.trim() || busy} onClick={() => search()}>
                {busy ? 'جاري البحث…' : 'دوّر على طلباتي'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="card p-6 mt-4">
          <h1 className="text-xl font-bold">طلباتي</h1>
          <p className="text-sm text-mist mt-1.5">اكتب رقم الموبايل اللي طلبت بيه</p>
          <input className="field mt-4" dir="ltr" value={phone} placeholder="01xxxxxxxxx"
            onChange={e => setPhone(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()} />
          <button className="btn-sea w-full mt-3" disabled={!phone.trim() || busy} onClick={() => search()}>
            {busy ? 'جاري البحث…' : 'بحث'}
          </button>
          <button className="text-sea text-sm font-semibold w-full text-center mt-3" onClick={() => setShowLogin(true)}>
            أو سجّل دخولك بجوجل/الإيميل عشان تتابع طلباتك وتوصلك الفاتورة
          </button>
        </div>
      )}

      {error && (
        <div className="card p-4 mt-5 text-center">
          <p className="text-sm text-red-600">{error}</p>
          <button className="btn-ghost mt-3 text-sm" disabled={busy} onClick={() => search()}>جرب تاني</button>
        </div>
      )}

      {!error && rows && rows.length === 0 && (
        <p className="text-center text-mist text-sm mt-5">لا توجد طلبات بهذا الرقم</p>
      )}

      <div className="space-y-3 mt-5">
        {(rows ?? []).map(r => (
          <Link key={r.id} to={`/track/${r.public_token}`} className="card p-4 block hover:border-sea/50">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">#{r.id} — {r.restaurant_name}</p>
                <p className="text-xs text-mist mt-0.5">
                  {new Date(r.created_at).toLocaleDateString('ar-EG-u-nu-latn')} · {orderStatusLabel(r.status)}
                </p>
              </div>
              <span className="font-bold text-sea">{r.total} ج.م</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
