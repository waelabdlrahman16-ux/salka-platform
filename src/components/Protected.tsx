import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export default function Protected({ role, children }: { role: 'admin' | 'driver'; children: ReactNode }) {
  const { session, profile, loading } = useAuth()

  if (loading) return <p className="text-mist text-center py-10">جاري التحقق…</p>
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return (
    <div className="card p-6 text-center max-w-sm mx-auto">
      <p className="font-semibold">الحساب غير مفعّل</p>
      <p className="text-sm text-mist mt-2">تواصل مع الإدارة لتفعيل صلاحياتك.</p>
    </div>
  )
  if (profile.role !== role) return <Navigate to={profile.role === 'admin' ? '/admin' : '/driver'} replace />
  return <>{children}</>
}
