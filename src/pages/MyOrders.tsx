import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCustomerAuth, getSessionToken } from '../lib/customerAuth'
import { orderStatusLabel } from '../lib/statusLabels'
import CustomerLogin from '../components/CustomerLogin'

interface Row {
  id: number; public_token: string; total: number
  status: string; created_at: string; restaurant_name: string
}

export default function MyOrders() {
  const { customer, logout } = useCustomerAuth()
  const [phone, setPhone] = useState(() => customer?.phone ?? localStorage.getItem('salka_phone') ?? '')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [showLogin, setShowLogin] = useState(false)

  async function search() {
    setBusy(true)
    const { data } = await supabase.rpc('my_orders', { p_phone: phone.trim(), p_session_token: getSessionToken() })
    setRows((data as Row[]) ?? [])
    setBusy(false)
  }

  useEffect(() => {
    if (phone.trim()) search()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="max-w-sm mx-auto">
      {showLogin && <CustomerLogin onDone={() => setShowLogin(false)} />}
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
        </div>
      ) : (
        <div className="card p-6 mt-4">
          <h1 className="text-xl font-bold">طلباتي</h1>
          <p className="text-sm text-mist mt-1.5">اكتب رقم الموبايل اللي طلبت بيه</p>
          <input className="field mt-4" dir="ltr" value={phone} placeholder="01xxxxxxxxx"
            onChange={e => setPhone(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()} />
          <button className="btn-sea w-full mt-3" disabled={!phone.trim() || busy} onClick={search}>
            {busy ? 'جاري البحث…' : 'بحث'}
          </button>
          <button className="text-sea text-sm font-semibold w-full text-center mt-3" onClick={() => setShowLogin(true)}>
            أو سجّل دخولك بجوجل/الإيميل عشان تتابع طلباتك وتوصلك الفاتورة
          </button>
        </div>
      )}

      {rows && rows.length === 0 && (
        <p className="text-center text-mist text-sm mt-5">لا توجد طلبات بهذا الرقم</p>
      )}

      <div className="space-y-3 mt-5">
        {(rows ?? []).map(r => (
          <Link key={r.id} to={`/track/${r.public_token}`} className="card p-4 block hover:border-sea/50">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">#{r.id} — {r.restaurant_name}</p>
                <p className="text-xs text-mist mt-0.5">
                  {new Date(r.created_at).toLocaleDateString('ar-EG')} · {orderStatusLabel(r.status)}
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
