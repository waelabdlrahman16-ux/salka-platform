import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth, homeFor } from '../lib/auth'

export default function Protected({ role, children }: {
  role: 'admin' | 'driver' | 'vendor' | 'catalog' | 'supervisor'
  children: ReactNode
}) {
  const { session, profile, loading, profileError, retryProfile } = useAuth()

  if (loading) return <p className="text-mist text-center py-10">جاري التحقق…</p>
  if (!session) return <Navigate to="/login" replace />
  // Checked BEFORE !profile, because a failed read also leaves profile null.
  // Telling a driver standing at a compound gate that his account is
  // deactivated -- when the real problem is one bar of signal -- sends him home
  // and loses the delivery. Say what actually happened, and let him retry.
  if (profileError) return (
    <div className="card p-6 text-center max-w-sm mx-auto">
      <p className="font-semibold">مش قادرين نتأكد من حسابك</p>
      <p className="text-sm text-mist mt-2">النت ضعيف على ما يبدو. حسابك زي ما هو — جرب تاني.</p>
      <button className="btn-sea w-full mt-4" onClick={retryProfile}>جرب تاني</button>
    </div>
  )
  if (!profile) return (
    <div className="card p-6 text-center max-w-sm mx-auto">
      <p className="font-semibold">الحساب غير مفعّل</p>
      <p className="text-sm text-mist mt-2">تواصل مع الإدارة لتفعيل صلاحياتك.</p>
    </div>
  )
  // Admin is a superset of the narrow roles, so let them through rather than
  // bouncing. This mirrors is_catalog_manager() and is_supervisor() on the
  // server, both of which return true for an admin.
  // observer is a read-only subset of admin, not a superset of anything --
  // it only ever gets into /admin itself. Server-side is_admin_read() (not
  // is_admin()) is what actually decides what an observer can fetch; every
  // mutating admin_* function still checks is_admin() alone, so this route
  // check is a UX door, not the security boundary.
  const allowed = profile.role === role
    || ((role === 'catalog' || role === 'supervisor') && profile.role === 'admin')
    || (role === 'admin' && profile.role === 'observer')
  if (!allowed) return <Navigate to={homeFor(profile.role)} replace />
  return <>{children}</>
}
