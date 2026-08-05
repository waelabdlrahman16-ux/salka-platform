import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { rpc } from '../lib/rpc'
import { useCustomerAuth, getSessionToken } from '../lib/customerAuth'
import { orderStatusLabel } from '../lib/statusLabels'
import CustomerLogin from '../components/CustomerLogin'

interface Row {
  id: number; public_token: string; total: number
  status: string; created_at: string; restaurant_name: string
  pricing_status?: 'n/a' | 'pending_quote' | 'confirmed'
}

/** Where an unverified result is parked so re-opening the tab costs nothing. */
const CACHE_KEY = 'salka_my_orders_cache'

function readCache(phone: string): Row[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { phone: string; rows: Row[] }
    return parsed.phone === phone ? parsed.rows : null
  } catch { return null }
}

function writeCache(phone: string, rows: Row[]) {
  // Never cache a VERIFIED result. Verified rows carry public_token, which is a
  // live tracking link to someone's order -- their address, their driver, their
  // phone. logout() clears the session but cannot reach into sessionStorage, so
  // a cached verified list would outlive "خروج" and hand the next person on a
  // shared phone working links into the previous account. Unverified rows have
  // public_token withheld by the server, so they are safe to park.
  if (rows.some(r => r.public_token)) return
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ phone, rows })) } catch { /* quota */ }
}

export function clearOrdersCache() {
  try { sessionStorage.removeItem(CACHE_KEY) } catch { /* nothing to do */ }
}

export default function MyOrders() {
  const { customer, loading: authLoading, logout } = useCustomerAuth()
  const [phone, setPhone] = useState(() => customer?.phone ?? localStorage.getItem('salka_phone') ?? '')
  const [rows, setRows] = useState<Row[] | null>(null)
  /** Which number `rows` belongs to, so a new search cannot show the old one's. */
  const [rowsPhone, setRowsPhone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [limited, setLimited] = useState(false)
  const [showLogin, setShowLogin] = useState(false)

  async function search(overridePhone?: string) {
    const target = (overridePhone ?? phone).trim()
    if (!target) return

    // Drop results belonging to a DIFFERENT number before searching. Without
    // this, typing a new number and failing (rate limit, network) left the
    // previous number's orders on screen underneath the red error -- the list
    // is not gated on `error` -- so the customer read someone else's history as
    // the answer to their own question. Same number: keep them, so a transient
    // failure does not blank a list that is still correct.
    if (rowsPhone !== null && rowsPhone !== target) { setRows(null); setRowsPhone(null) }

    setBusy(true); setError(''); setLimited(false)
    const res = await rpc<Row[]>('my_orders', { p_phone: target, p_session_token: getSessionToken() })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      setLimited(res.code === 'rate_limited')
      return
    }
    const data = res.data ?? []
    setRows(data)
    setRowsPhone(target)
    writeCache(target, data)
  }

  function signOut() {
    // Clearing the session is not enough on a shared phone: the remembered
    // number, the rendered list and the sessionStorage cache all had to go too,
    // or the next person sees the previous account's orders.
    clearOrdersCache()
    setRows(null); setRowsPhone(null); setPhone(''); setError(''); setLimited(false)
    try { localStorage.removeItem('salka_phone') } catch { /* nothing to do */ }
    logout()
  }

  // This effect used to auto-search on EVERY mount using whatever phone was in
  // localStorage, and that is what produced the "حاولت كتير" wall in the
  // screenshot -- reached without the customer typing anything or tapping
  // anything.
  //
  // An unverified phone lookup is capped at 5 per number per 10 minutes,
  // deliberately: my_orders() returns a stranger's order history (ids, totals,
  // dates, which restaurants) to anyone who knows their number, and this is a
  // small resort community where people know each other's numbers. The cap is
  // right. Spending it on page views was not. Opening the tab three times --
  // home, back, cart, back -- burned most of a real customer's quota before
  // they had asked a single question, and the "جرب تاني" button underneath
  // could then only burn the next attempt and fail identically. That is the loop.
  //
  // So now:
  //   verified session  -> auto-search freely; check_rate_limit is skipped
  //                        entirely for a session token, so it costs nothing.
  //   remembered phone  -> prefill the box, show the cached result if we have
  //                        one for that number, and wait for a deliberate tap.
  //
  // The cache is sessionStorage, not localStorage: an order list should not
  // outlive the browsing session on a shared phone.
  useEffect(() => {
    if (authLoading) return

    if (customer?.phone) {
      if (!phone.trim()) setPhone(customer.phone)
      search(customer.phone)
      return
    }

    const remembered = phone.trim()
    if (!remembered) return
    const cached = readCache(remembered)
    if (cached) { setRows(cached); setRowsPhone(remembered) }
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
            <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={signOut}>خروج</button>
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

      {/* A "جرب تاني" button under a rate-limit message is a trap: the limit is
          still in force, so the only thing the button can do is spend the next
          attempt and reprint the same red text. When we know that is the cause,
          offer the way OUT of the limit -- signing in skips the check entirely
          because the session token proves the phone is theirs -- and say plainly
          that waiting is the alternative. Every other error keeps the retry,
          because for those retrying is genuinely the right move. */}
      {error && (
        <div className="card p-4 mt-5 text-center">
          <p className="text-sm text-red-600">{error}</p>
          {limited && !customer ? (
            <>
              <button className="btn-sea w-full mt-3 text-sm" onClick={() => setShowLogin(true)}>
                سجّل دخولك وشوف طلباتك على طول
              </button>
              <p className="text-xs text-mist mt-2">
                أو استنى 10 دقايق. لما تسجل دخولك مافيش أي حد على البحث.
              </p>
            </>
          ) : (
            <button className="btn-ghost mt-3 text-sm" disabled={busy} onClick={() => search()}>جرب تاني</button>
          )}
        </div>
      )}

      {!error && rows && rows.length === 0 && (
        <p className="text-center text-mist text-sm mt-5">لا توجد طلبات بهذا الرقم</p>
      )}

      <div className="space-y-3 mt-5">
        {(rows ?? []).map(r => {
          // my_orders() withholds public_token from an UNVERIFIED phone lookup --
          // deliberately, since otherwise typing a stranger's number would hand
          // over their live tracking link. But the card linked to
          // `/track/${undefined}` regardless, so every result led to
          // "الطلب غير موجود". A card with no token is not a link.
          const Card: any = r.public_token ? Link : 'div'
          const props = r.public_token
            ? { to: `/track/${r.public_token}`, className: 'card p-4 block hover:border-sea/50' }
            : { className: 'card p-4 block' }
          return (
          <Card key={r.id} {...props}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">#{r.id} — {r.restaurant_name}</p>
                <p className="text-xs text-mist mt-0.5">
                  {new Date(r.created_at).toLocaleDateString('ar-EG-u-nu-latn')} · {orderStatusLabel(r.status)}
                </p>
              </div>
              {/* An unquoted pharmacy order has total = the delivery fee, so
                  this printed "65 ج.م" as if that were the price. */}
              <span className={`font-bold shrink-0 ${r.pricing_status === 'pending_quote' ? 'text-mist text-xs' : 'text-sea'}`}>
                {r.pricing_status === 'pending_quote' ? 'قيد التسعير' : `${r.total} ج.م`}
              </span>
            </div>
            {!r.public_token && (
              <p className="text-xs text-mist mt-2">
                🔒 سجّل دخولك بجوجل أو الإيميل عشان تفتح تتبع الطلب
              </p>
            )}
          </Card>
          )
        })}
      </div>
    </div>
  )
}
