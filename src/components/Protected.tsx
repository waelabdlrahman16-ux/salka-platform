import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth, homeFor } from '../lib/auth'

export default function Protected({ role, children }: {
  role: 'admin' | 'driver' | 'vendor' | 'catalog'
  children: ReactNode
}) {
  const { session, profile, loading } = useAuth()

  if (loading) return <p className="text-mist text-center py-10">جاري التحقق…</p>
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return (
    <div className="card p-6 text-center max-w-sm mx-auto">
      <p className="font-semibold">الحساب غير مفعّل</p>
      <p className="text-sm text-mist mt-2">تواصل مع الإدارة لتفعيل صلاحياتك.</p>
    </div>
  )
  // Admin is a superset of catalog, so let them through rather than bouncing.
  const allowed = profile.role === role || (role === 'catalog' && profile.role === 'admin')
  if (!allowed) return <Navigate to={homeFor(profile.role)} replace />
  return <>{children}</>
}
