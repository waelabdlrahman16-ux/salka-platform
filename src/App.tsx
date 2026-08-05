import { lazy, Suspense, useEffect, useRef } from 'react'
import Icon from './components/Icon'
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, homeFor, useAuth } from './lib/auth'
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
import { useScrollRestoration } from './lib/useScrollRestoration'

// Staff-only pages: not needed in the customer bundle, so they're loaded
// on demand instead of shipping ~1500 lines of admin/vendor/driver code to
// every customer who opens the app.
const Admin = lazy(() => import('./pages/Admin'))
const DriverPage = lazy(() => import('./pages/Driver'))
const Vendor = lazy(() => import('./pages/Vendor'))
const Catalog = lazy(() => import('./pages/Catalog'))
const Supervisor = lazy(() => import('./pages/Supervisor'))
import { useState } from 'react'
import { getCompoundId } from './lib/place'

// Every staff workspace, in one place. This list used to be inlined in three
// separate components with two different contents, and /catalog was added to
// none of them: the app therefore classified the catalogue workspace as a
// customer page, so a catalogue employee logging in got the customer signup
// sheet, the customer bottom nav, and -- if they signed in with Google rather
// than skipping -- an undismissable PhonePrompt covering the whole screen.
// The route itself never mounted. Add new staff routes here and only here.
const STAFF_PATHS = ['/admin', '/driver', '/vendor', '/catalog', '/supervisor']

/** A staff workspace: shows the staff header, hides customer chrome. */
function isStaffWorkspace(pathname: string): boolean {
  return STAFF_PATHS.some(p => pathname.startsWith(p))
}

/** Staff workspaces plus the staff login screen. /login is not a workspace,
 *  but it must also skip customer onboarding and the customer bottom nav. */
function isStaffRoute(pathname: string): boolean {
  return isStaffWorkspace(pathname) || pathname.startsWith('/login')
}

function Header() {
  const { pathname } = useLocation()
  const { session, profile, signOut } = useAuth()
  const isStaff = isStaffWorkspace(pathname)

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
  const isStaff = isStaffRoute(pathname)
  if (isStaff) return null

  // Pharmacy and supermarket live here rather than as cards on the home
  // screen. As cards they sat below the restaurants competing with them, and
  // they shared that block with a third card, "طلب خاص", whose entire function
  // was to offer a choice between... the pharmacy and the supermarket. Three
  // cards, two destinations, one of them reachable two ways.
  //
  // ONE tab, not two. They were briefly split into صيدلية and ماركت, which put
  // six items in a bar that is about 60px per slot on a phone -- and two of
  // those items led to the same route, differing only by a query string, so the
  // highlight had to parse the URL to tell them apart. They are one errand
  // ("something that isn't a restaurant"), so they are one destination, and the
  // choice between them happens on the screen where there is room to label it.
  //
  // `emoji` rather than an Icon because there is no trolley in the icon set.
  const items = [
    { to: '/', label: 'الرئيسية', icon: 'house' as const },
    { to: '/custom-order', label: 'صيدلية وماركت', emoji: '🛒' },
    { to: '/offers', label: 'العروض', icon: 'moneyBill' as const },
    { to: '/cart', label: 'عربتي', icon: 'bagShopping' as const, badge: cart.count },
    { to: '/profile', label: 'حسابي', icon: 'rectangleList' as const },
  ]

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 bg-shell/95 backdrop-blur border-t border-line" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="max-w-5xl mx-auto grid grid-cols-5">
        {items.map(it => {
          const active = it.to === '/' ? pathname === '/' : pathname.startsWith(it.to)
          return (
            <Link key={it.to} to={it.to}
              className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold ${active ? 'text-sea' : 'text-mist'}`}>
              <span className="relative leading-none">
                {it.icon
                  ? <Icon name={it.icon} className="w-5 h-5" />
                  : <span className="block text-[18px] leading-5" aria-hidden="true">{it.emoji}</span>}
                {!!it.badge && (
                  <span className="absolute -top-1.5 -left-2.5 bg-sea text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 grid place-items-center px-1">
                    {it.badge}
                  </span>
                )}
              </span>
              {/* Wraps rather than overflows: "صيدلية وماركت" is twice the
                  length of the other four labels and a 5-column bar on a 360px
                  phone gives each slot about 70px. */}
              <span className="block text-center leading-tight px-0.5">{it.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

function AppShell() {
  const { pathname } = useLocation()
  const isStaff = isStaffRoute(pathname)
  const { customer, loading } = useCustomerAuth()
  // A signed-in driver or vendor opening the app lands in their workspace, not
  // on the customer home. In a browser they could type /driver; in the installed
  // app there is no address bar, so without this a driver who had already signed
  // in still had to go through حسابي -> دخول فريق سالكة on every single launch.
  //
  // ONCE, on launch -- not on every visit to "/".
  //
  // As a render-time redirect this was a trap: BottomNav is hidden on staff
  // routes, so the only way off /driver is the header logo, which links to "/"
  // and bounced straight back. A signed-in driver could not reach the cart, the
  // pharmacy, their profile or the restaurant list at all, in an app with no
  // address bar -- and the same change had just added a door IN to /login with
  // no door back out.
  //
  // Now it fires once per mount, so opening the app lands a driver in their
  // workspace and tapping the logo afterwards actually goes home.
  const { profile, loading: staffLoading } = useAuth()
  const nav = useNavigate()
  const launchRedirectDone = useRef(false)
  useEffect(() => {
    if (launchRedirectDone.current || staffLoading) return
    if (!profile) return
    launchRedirectDone.current = true
    if (pathname === '/' && (profile.role === 'driver' || profile.role === 'vendor' || profile.role === 'supervisor')) {
      nav(homeFor(profile.role), { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffLoading, profile?.role])
  useScrollRestoration()
  const [skipped, setSkipped] = useState(() => !!localStorage.getItem('salka_onboarded'))

  // Wait for the initial auth check to resolve before deciding whether to
  // show onboarding -- otherwise a customer returning from a Google OAuth
  // redirect (or with an existing session) would flash the login screen
  // again for a moment, or worse, be shown it a second time since the
  // 'salka_onboarded' flag was never set before the full-page redirect away.
  //
  // Also wait until a place has been chosen. Home opens its own "فين مكانك؟"
  // picker whenever no compound is stored, which for a first-time visitor is
  // always -- so with <main> now rendering underneath, the two modals stacked
  // and the very first thing anyone saw was a login card with a location
  // picker on top of it. The picker has to win: nothing in the app works
  // without a compound, whereas signing in is optional. Re-read on navigation
  // rather than subscribing, so the prompt surfaces on the customer's next
  // move after picking instead of interrupting them the instant they choose.
  const hasPlace = getCompoundId() !== null
  const showOnboarding = !isStaff && !loading && !customer && !skipped && hasPlace

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
      {/* The app now always renders. This used to be gated on
          (isStaff || loading || customer || skipped), and CustomerLogin's
          backdrop was an opaque bg-night, so a first-time customer's entire
          first impression was a login card on an empty page -- no restaurants,
          no prices, no evidence the service works. Ordering has never required
          an account (settings.require_customer_login = 'false'), so that gate
          turned an optional prompt into a hard wall in front of a brand nobody
          in Sokhna has heard of yet.

          The prompt still appears over the top, but it is no longer
          load-bearing: the backdrop is translucent over the live app and a tap
          anywhere outside the card dismisses it. */}
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
            <Route path="/catalog" element={<Protected role="catalog"><Catalog /></Protected>} />
            <Route path="/supervisor" element={<Protected role="supervisor"><Supervisor /></Protected>} />
          </Routes>
        </Suspense>
      </main>
      {!isStaff && (
        <footer className="max-w-5xl mx-auto px-4 pb-8 text-center">
          <Link to="/terms" className="inline-flex items-center justify-center min-h-[44px] px-3 text-xs text-mist hover:text-foam">الشروط وسياسة الخصوصية</Link>
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
