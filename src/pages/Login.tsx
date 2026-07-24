import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth, homeFor } from '../lib/auth'

export default function Login() {
  const { signIn, session, profile, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!loading && session && profile) {
    return <Navigate to={homeFor(profile.role)} replace />
  }

  async function submit() {
    setBusy(true); setError(null)
    const err = await signIn(email, password)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <div className="max-w-sm mx-auto">
      <div className="card p-6 mt-6">
        <h1 className="text-xl font-bold">تسجيل الدخول</h1>
        <p className="text-sm text-mist mt-1.5">للمندوبين والإدارة فقط</p>

        <div className="space-y-3.5 mt-5">
          <div>
            <label className="label">البريد الإلكتروني</label>
            <input className="field" dir="ltr" type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()} placeholder="you@talah.app" />
          </div>
          <div>
            <label className="label">كلمة المرور</label>
            <input className="field" dir="ltr" type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()} placeholder="••••••••" />
          </div>
        </div>

        {error && <p className="text-red-300 text-sm mt-3">{error}</p>}

        <button className="btn-sea w-full mt-5" disabled={busy || !email || !password} onClick={submit}>
          {busy ? 'جاري الدخول…' : 'دخول'}
        </button>
      </div>
      <p className="text-center text-sm text-mist mt-4">
        عميل؟ <a className="text-sea" href="/">اطلب من هنا</a>
      </p>
    </div>
  )
}
