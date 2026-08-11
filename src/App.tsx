import { lazy, Suspense, useEffect, useRef } from 'react'
import Icon from './components/Icon'
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, homeFor, useAuth } from './lib/auth'
import { CartProvider, useCart } from './lib/cart'
import Protected from './components/Protected'
import Home from './pages/Home'
import InstallPrompt from './components/InstallPrompt'
import CustomerLogin from './components/CustomerLogin'
import { CustomerAuthProvider, useCustomerAuth } from './lib/customerAuth'
import { useScrollRestoration } from './lib/useScrollRestoration'
import { isInAppBrowser } from './lib/inAppBrowser'
import { trackOnce } from './lib/analytics'
import { lastStaffHome, promoteCurrentSessionToRole } from './lib/supabase'

// Staff-only pages: not needed in the customer bundle, so they're loaded
// on demand instead of shipping ~1500 lines of admin/vendor/driver code to
// every customer who opens the app.
const Admin = lazy(() => import('./pages/Admin'))
const DriverPage = lazy(() => import('./pages/Driver'))
const Vendor = lazy(() => import('./pages/Vendor'))
const Catalog = lazy(() => import('./pages/Catalog'))
const Supervisor = lazy(() => import('./pages/Supervisor'))

// Home is the landing route for every customer, so it stays a static import
// -- lazy-loading it would only add a network round trip to the page nobody
// can skip. Everything reachable FROM Home is fair game: none of these are
// needed for first paint, and shipping them eagerly meant every customer's
// entry bundle carried checkout, tracking, and account-management code they
// might never touch in that visit. This was the actual weight behind the
// single 788KB entry chunk the build warned about, not the staff routes
// above (already split) or Home itself.
const RestaurantDetail = lazy(() => import('./pages/RestaurantDetail'))
const CartPage = lazy(() => import('./pages/CartPage'))
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'))
const CustomOrder = lazy(() => import('./pages/CustomOrder'))
const Track = lazy(() => import('./pages/Track'))
const Login = lazy(() => import('./pages/Login'))
const MyOrders = lazy(() => import('./pages/MyOrders'))
const Profile = lazy(() => import('./pages/Profile'))
const Offers = lazy(() => import('./pages/Offers'))
const Terms = lazy(() => import('./pages/Terms'))
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
  const nav = useNavigate()
  const isStaff = isStaffWorkspace(pathname)

  // The logo used to be a plain <Link to="/">, which threw a driver or a vendor
  // out of the workspace they were working in and into the customer storefront
  // -- mid-shift, mid-order, with no address bar to get back and no bottom nav
  // on staff routes to find the way in again. The only route home was the
  // once-per-launch redirect below, which had already fired.
  //
  // A logo in a workspace header is not a way out of the workspace; it is the
  // thing you tap when a screen looks stale. So for signed-in staff it goes to
  // their OWN dashboard: already there, and it is a refresh; anywhere else in
  // the workspace, it is the way back to the board. Customers keep the plain
  // link home, which is what they expect.
  const staffHome = profile ? homeFor(profile.role) : null
  const logoTarget = staffHome && isStaff ? staffHome : '/'

  function onLogo(e: React.MouseEvent) {
    if (!staffHome || !isStaff) return           // customer: let the Link work
    e.preventDefault()
    if (pathname.startsWith(staffHome)) {
      // Already on the board. Re-fetch rather than navigate to where we are --
      // React Router treats that as a no-op and nothing would happen, which
      // reads as a broken logo.
      window.location.reload()
      return
    }
    nav(staffHome)
  }

  return (
    <header className="sticky top-0 z-40 bg-night/90 backdrop-blur border-b border-line" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link to={logoTarget} onClick={onLogo} className="flex items-center gap-2">
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
  // All five draw from the same Font Awesome set now. This tab used to be an
  // emoji because the icon set had no trolley -- so on a five-tab bar, four
  // icons were monochrome vector and one was a full-colour glyph rendered in
  // the system emoji font, a different weight and a couple of pixels low.
  //
  // "صيدلية وماركت" was also twice the length of every other label and had to
  // wrap onto two lines in a ~70px slot. One word instead: الضروريات covers
  // both a pharmacy and a supermarket without naming either, and the screen
  // behind it has room to say which is which.
  //
  // Icon set chosen by Wael, path data taken from
  // @fortawesome/free-solid-svg-icons rather than redrawn. The two that changed
  // meaning are worth noting: the trolley now belongs to عربتي, where a trolley
  // actually means a basket, and الضروريات took the truck -- a pharmacy and a
  // supermarket run is an errand being delivered, not a shop you browse.
  const items = [
    { to: '/', label: 'الرئيسية', icon: 'house' as const },
    { to: '/custom-order', label: 'الضروريات', icon: 'truck' as const },
    // Gold in both states, not just when selected: this is the one tab worth
    // pulling an eye towards, which is what Wael asked for. `sandink` and not
    // `sand` -- sand is 2.69:1 on this background and fails the 3:1 that a
    // meaningful graphic needs, so it is a tint colour only. See the palette
    // notes in tailwind.config.js.
    { to: '/offers', label: 'العروض', icon: 'tag' as const, accent: true },
    { to: '/cart', label: 'عربتي', icon: 'cartShopping' as const, badge: cart.count },
    { to: '/profile', label: 'حسابي', icon: 'circleUser' as const },
  ]

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 bg-shell/95 backdrop-blur border-t border-line" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="max-w-5xl mx-auto grid grid-cols-5">
        {items.map(it => {
          const active = it.to === '/' ? pathname === '/' : pathname.startsWith(it.to)
          return (
            <Link key={it.to} to={it.to}
              className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold ${
                it.accent
                  ? (active ? 'text-sandink' : 'text-sandink/70')
                  : (active ? 'text-sea' : 'text-mist')
              }`}>
              <span className="relative leading-none">
                <Icon name={it.icon} className="w-5 h-5" />
                {!!it.badge && (
                  <span className="absolute -top-1.5 -left-2.5 bg-sea text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 grid place-items-center px-1">
                    {it.badge}
                  </span>
                )}
              </span>
              {/* Every label is now one word, so nothing wraps in the ~70px a
                  five-column bar leaves on a 360px phone. */}
              <span className="block text-center leading-tight px-0.5 whitespace-nowrap">{it.label}</span>
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
  const launchRedirectDone = useRef(false)
  useEffect(() => {
    if (launchRedirectDone.current || staffLoading) return
    launchRedirectDone.current = true
    if (pathname !== '/') return

    // A legacy staff session may have been discovered while the app started on
    // the customer URL. Move it before crossing the auth boundary. A later app
    // launch has no shared session to inspect, so the remembered staff board
    // restores the old installed-app behaviour without sharing refresh tokens.
    if (profile && (profile.role === 'driver' || profile.role === 'vendor' || profile.role === 'supervisor' || profile.role === 'admin' || profile.role === 'catalog')) {
      window.location.replace(promoteCurrentSessionToRole(profile.role))
      return
    }
    const remembered = lastStaffHome()
    if (!profile && remembered) window.location.replace(remembered)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffLoading, profile?.role])
  useScrollRestoration()

  // Funnel step 1, and the denominator for every rate below it. Fired once per
  // browser session, not per mount: StrictMode double-mounts effects in dev,
  // and a remount here would inflate arrivals and understate every conversion.
  // The fbclid and in-app-browser flags ride along inside track().
  useEffect(() => { trackOnce('arrival') }, [])

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
  //
  // And not inside a Facebook/Instagram in-app browser. That is where every ad
  // click lands, and this card's first and largest button is «المتابعة بجوجل» --
  // which Google hard-blocks in an embedded WebView with a full-page
  // `403: disallowed_useragent`. So the traffic we pay the most for was the
  // traffic guaranteed to hit a dead end, and the other two doors do not save
  // it: phone OTP is hidden until SMS Misr approves the sender, and the email
  // link opens in Safari and orphans the WebView session.
  //
  // Ordering has never required an account, so not showing the card here costs
  // nothing it was actually delivering. The ask moves to <InAppLoginPrompt> on
  // the tracking screen, after an order exists -- at which point the customer
  // has a real reason to want one.
  const hasPlace = getCompoundId() !== null
  const showOnboarding = !isStaff && !loading && !customer && !skipped && hasPlace
    && !isInAppBrowser()

  return (
    <div className="min-h-screen font-arabic">
      {isStaff && <Header />}
      {/* The install prompt no longer lives here. It rendered on EVERY route
          from the first second of the first visit -- including /checkout, where
          it took 15% of the viewport above a customer who had already decided to
          buy. It now renders once, from Track's delivered state, when the food
          has actually arrived. See components/InstallPrompt.tsx. */}
      {showOnboarding && (
        <CustomerLogin
          onDone={() => { localStorage.setItem('salka_onboarded', '1'); setSkipped(true) }}
          // TEMPORARY: skippable until SMS OTP delivery is configured and verified end-to-end.
          // Once that's done, remove onSkip entirely to make verification mandatory as intended.
          onSkip={() => { localStorage.setItem('salka_onboarded', '1'); setSkipped(true) }}
        />
      )}
      {/* A signed-in customer without a phone can still browse and check out as
          a guest. Phone ownership now requires SMS verification, so never trap
          the whole app behind that flow (especially while SMS is unavailable). */}
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
      {/* The terms footer used to render on EVERY customer page. It is legal
          furniture, not content: it sat under the restaurant list, under the
          cart, under an order the customer was tracking, adding a line of grey
          text and 44px of dead space to screens that had nothing to do with it.
          A terms link belongs at the moment of agreement, and there is exactly
          one -- the confirm button on checkout, which already carries "بضغطك
          على تأكيد الطلب إنت موافق على الشروط والأحكام" with the same link.
          The sign-in sheet keeps its own line for the same reason.
          /terms itself is untouched and still reachable from both. */}
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
