import { lazy, Suspense } from 'react'
import Icon from './components/Icon'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { CartProvider, useCart } from './lib/cart'
import Protected from './components/Protected'
import Home from './pages/Home'
import RestaurantDetail from './pages/RestaurantDetail'
import CartPage from './pages/CartPage'
import CheckoutPage from './pages/CheckoutPage'
import CustomOrder from './pages/CustomOrder'
import Track from './pages/Track'
import Login from './pages/Login'
import MyOrders from './pages/MyOrders'
import Profile from './pages/Profile'
import Offers from './pages/Offers'
import Terms from './pages/Terms'
import InstallPrompt from './components/InstallPrompt'
import CustomerLogin from './components/CustomerLogin'
import PhonePrompt from './components/PhonePrompt'
import { CustomerAuthProvider, useCustomerAuth } from './lib/customerAuth'

// Staff-only pages: not needed in the customer bundle, so they're loaded
// on demand instead of shipping ~1500 lines of admin/vendor/driver code to
// every customer who opens the app.
const Admin = lazy(() => import('./pages/Admin'))
const DriverPage = lazy(() => import('./pages/Driver'))
const Vendor = lazy(() => import('./pages/Vendor'))
import { useState } from 'react'

function Header() {
  const { pathname } = useLocation()
  const { session, profile, signOut } = useAuth()
  const isStaff = ['/admin', '/driver', '/vendor'].some(p => pathname.startsWith(p))

  return (
    <header className="sticky top-0 z-40 bg-night/90 backdrop-blur border-b border-line" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <img src="/icon-192.png" alt="سالكة" className="w-8 h-8 rounded-xl" />
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
    { to: '/', label: 'الرئيسية', icon: 'house' as const },
    { to: '/offers', label: 'العروض', icon: 'moneyBill' as const },
    { to: '/cart', label: 'عربتي', icon: 'bagShopping' as const, badge: cart.count },
    { to: '/profile', label: 'حسابي', icon: 'rectangleList' as const },
  ]

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 bg-shell/95 backdrop-blur border-t border-line" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="max-w-5xl mx-auto grid grid-cols-4">
        {items.map(it => {
          const active = it.to === '/' ? pathname === '/' : pathname.startsWith(it.to)
          return (
            <Link key={it.to} to={it.to}
              className={`relative flex flex-col items-center gap-0.5 py-2.5 text-xs font-semibold ${active ? 'text-sea' : 'text-mist'}`}>
              <span className="relative leading-none">
                <Icon name={it.icon} className="w-5 h-5" />
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

function AppShell() {
  const { pathname } = useLocation()
  const isStaff = ['/admin', '/driver', '/vendor', '/login'].some(p => pathname.startsWith(p))
  const { customer, loading } = useCustomerAuth()
  const [skipped, setSkipped] = useState(() => !!localStorage.getItem('salka_onboarded'))

  // Wait for the initial auth check to resolve before deciding whether to
  // show onboarding -- otherwise a customer returning from a Google OAuth
  // redirect (or with an existing session) would flash the login screen
  // again for a moment, or worse, be shown it a second time since the
  // 'salka_onboarded' flag was never set before the full-page redirect away.
  const showOnboarding = !isStaff && !loading && !customer && !skipped

  return (
    <div className="min-h-screen font-arabic">
      {isStaff && <Header />}
      {!isStaff && <InstallPrompt />}
      {showOnboarding && (
        <CustomerLogin
          onDone={() => { localStorage.setItem('salka_onboarded', '1'); setSkipped(true) }}
          // TEMPORARY: skippable until SMS OTP delivery is configured and verified end-to-end.
          // Once that's done, remove onSkip entirely to make verification mandatory as intended.
          onSkip={() => { localStorage.setItem('salka_onboarded', '1'); setSkipped(true) }}
        />
      )}
      {!isStaff && !loading && customer && !customer.phone && <PhonePrompt />}
      {(isStaff || loading || customer || skipped) && (
        <main
          className="max-w-5xl mx-auto px-4 pb-28"
          style={{ paddingTop: isStaff ? '1.5rem' : 'max(1.5rem, calc(env(safe-area-inset-top) + 0.75rem))' }}
        >
          <Suspense fallback={<div className="text-center py-16 text-mist">جاري التحميل…</div>}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/restaurant/:id" element={<RestaurantDetail />} />
              <Route path="/cart" element={<CartPage />} />
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/custom-order" element={<CustomOrder />} />
              <Route path="/my-orders" element={<MyOrders />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/offers" element={<Offers />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/track/:token" element={<Track />} />
              <Route path="/login" element={<Login />} />
              <Route path="/admin" element={<Protected role="admin"><Admin /></Protected>} />
              <Route path="/driver" element={<Protected role="driver"><DriverPage /></Protected>} />
              <Route path="/vendor" element={<Protected role="vendor"><Vendor /></Protected>} />
            </Routes>
          </Suspense>
        </main>
      )}
      {!isStaff && (
        <footer className="max-w-5xl mx-auto px-4 pb-8 text-center">
          <Link to="/terms" className="text-xs text-mist hover:text-foam">الشروط وسياسة الخصوصية</Link>
        </footer>
      )}
      <BottomNav />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <CustomerAuthProvider>
        <CartProvider>
          <AppShell />
        </CartProvider>
      </CustomerAuthProvider>
    </AuthProvider>
  )
}
