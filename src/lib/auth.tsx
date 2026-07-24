import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { Session } from '@supabase/supabase-js'

export interface Profile {
  id: string
  role: 'admin' | 'driver'
  driver_id: number | null
  name: string
}

interface AuthCtx {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthCtx>({
  session: null, profile: null, loading: true,
  signIn: async () => null, signOut: async () => {}
})

export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) { setProfile(null); setLoading(false) }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    setLoading(true)
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setProfile((data as Profile) ?? null)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [session])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    return error ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : null
  }

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
  }

  return <Ctx.Provider value={{ session, profile, loading, signIn, signOut }}>{children}</Ctx.Provider>
}
