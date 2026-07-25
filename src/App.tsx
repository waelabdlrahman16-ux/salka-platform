import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import Protected from './components/Protected'
import Home from './pages/Home'
import RestaurantDetail from './pages/RestaurantDetail'
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

        {isStaff && session ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-mist hidden sm:inline">{profile?.name}</span>
            <button className="tab" onClick={signOut}>خروج</button>
          </div>
        ) : !isStaff && (
          <nav className="flex items-center gap-1">
            <Link className={`tab ${pathname === '/' ? 'tab-active' : ''}`} to="/">المطاعم</Link>
            <Link className={`tab ${pathname.startsWith('/my-orders') ? 'tab-active' : ''}`} to="/my-orders">طلباتي</Link>
          </nav>
        )}
      </div>
    </header>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen font-arabic">
        <Header />
        <main className="max-w-5xl mx-auto px-4 py-6 pb-24">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/restaurant/:id" element={<RestaurantDetail />} />
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
      </div>
    </AuthProvider>
  )
}
