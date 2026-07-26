import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { CartProvider, useCart } from './lib/cart'
import Protected from './components/Protected'
import Home from './pages/Home'
import RestaurantDetail from './pages/RestaurantDetail'
import CartPage from './pages/CartPage'
import CheckoutPage from './pages/CheckoutPage'
import CustomOrder from './pages/CustomOrder'
import Chalets from './pages/Chalets'
import Track from './pages/Track'
import Admin from './pages/Admin'
import DriverPage from './pages/Driver'
import Login from './pages/Login'
import Vendor from './pages/Vendor'
import MyOrders from './pages/MyOrders'
import Terms from './pages/Terms'

function Header() {
  const { pathname } = useLocation()
  const { session, profile, signOut } = useAuth()
  const isStaff = ['/admin', '/driver', '/vendor'].some(p => pathname.startsWith(p))

  return (
    <header className="sticky top-0 z-40 bg-night/90 backdrop-blur border-b border-line">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-sea/15 text-sea grid place-items-center font-bold">س</span>
          <span className="font-bold text-lg">سالكة</span>
        </Link>

        {isStaff && session && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-mist hidden sm:inline">{profile?.name}</span>
            <button className="tab" onClick={signOut}>خروج</button>
          </div>
        )}
      </div>
    </header>
  )
}

function BottomNav() {
  const { pathname } = useLocation()
  const cart = useCart()
  const isStaff = ['/admin', '/driver', '/vendor', '/login'].some(p => pathname.startsWith(p))
  if (isStaff) return null

  const items = [
    { to: '/', label: 'المطاعم', icon: '🍽️' },
    { to: '/custom-order', label: 'طلب خاص', icon: '🧾' },
    { to: '/cart', label: 'عربتي', icon: '🛒', badge: cart.count },
    { to: '/my-orders', label: 'طلباتي', icon: '📋' },
  ]

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 bg-shell/95 backdrop-blur border-t border-line">
      <div className="max-w-5xl mx-auto grid grid-cols-4">
        {items.map(it => {
          const active = it.to === '/' ? pathname === '/' : pathname.startsWith(it.to)
          return (
            <Link key={it.to} to={it.to}
              className={`relative flex flex-col items-center gap-0.5 py-2.5 text-xs font-semibold ${active ? 'text-sea' : 'text-mist'}`}>
              <span className="relative text-xl leading-none">
                {it.icon}
                {!!it.badge && (
                  <span className="absolute -top-1.5 -left-2.5 bg-sea text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 grid place-items-center px-1">
                    {it.badge}
                  </span>
                )}
              </span>
              {it.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <div className="min-h-screen font-arabic">
          <Header />
          <main className="max-w-5xl mx-auto px-4 py-6 pb-28">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/restaurant/:id" element={<RestaurantDetail />} />
              <Route path="/cart" element={<CartPage />} />
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/custom-order" element={<CustomOrder />} />
              <Route path="/chalets" element={<Chalets />} />
              <Route path="/my-orders" element={<MyOrders />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/track/:token" element={<Track />} />
              <Route path="/login" element={<Login />} />
              <Route path="/admin" element={<Protected role="admin"><Admin /></Protected>} />
              <Route path="/driver" element={<Protected role="driver"><DriverPage /></Protected>} />
              <Route path="/vendor" element={<Protected role="vendor"><Vendor /></Protected>} />
            </Routes>
          </main>
          <footer className="max-w-5xl mx-auto px-4 pb-8 text-center">
            <Link to="/terms" className="text-xs text-mist hover:text-foam">الشروط وسياسة الخصوصية</Link>
          </footer>
          <BottomNav />
        </div>
      </CartProvider>
    </AuthProvider>
  )
}
