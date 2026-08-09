import { useEffect, useState, useId } from 'react'
import { useAuth } from '../lib/auth'
import { forgetLastStaffHome, promoteCurrentSessionToRole } from '../lib/supabase'

export default function Login() {
  const fid = useId()
  const { signIn, session, profile, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (loading || !session || !profile) return
    // The login page uses a neutral temporary namespace because the role is
    // unknown until the protected profile is read. Move the session, then do a
    // real navigation so every module starts against the role-specific client.
    window.location.replace(promoteCurrentSessionToRole(profile.role))
  }, [loading, session, profile])

  async function submit() {
    setBusy(true); setError(null)
    const err = await signIn(email, password)
    setBusy(false)
    if (err) setError(err)
  }

  if (!loading && session && profile) {
    return <p className="text-mist text-center py-10">جاري فتح شاشة الشغل…</p>
  }

  return (
    <div className="max-w-sm mx-auto">
      <div className="card p-6 mt-6">
        <h1 className="text-xl font-bold">تسجيل الدخول</h1>
        <p className="text-sm text-mist mt-1.5">للمندوبين والمطاعم والإدارة</p>

        <div className="space-y-3 mt-5">
          <div>
            <label className="label" htmlFor={`${fid}-1`}>البريد الإلكتروني</label>
            <input id={`${fid}-1`} className="field" dir="ltr" type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()} placeholder="you@salka.app" />
          </div>
          <div>
            <label className="label" htmlFor={`${fid}-2`}>كلمة المرور</label>
            <input id={`${fid}-2`} className="field" dir="ltr" type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()} placeholder="••••••••" />
          </div>
        </div>

        {error && <p className="text-red-600 text-sm mt-3">{error}</p>}

        <button className="btn-sea w-full mt-5" disabled={busy || !email || !password} onClick={submit}>
          {busy ? 'جاري الدخول…' : 'دخول'}
        </button>
      </div>
      <p className="text-center text-sm text-mist mt-4">
        عميل؟ <a className="text-sea" href="/" onClick={forgetLastStaffHome}>اطلب من هنا</a>
      </p>
    </div>
  )
}
