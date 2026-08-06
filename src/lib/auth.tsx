import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { Session } from '@supabase/supabase-js'

export interface Profile {
  id: string
  role: 'admin' | 'driver' | 'vendor' | 'catalog' | 'supervisor'
  driver_id: number | null
  restaurant_id: number | null
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

export const homeFor = (role: Profile['role']) =>
  role === 'admin' ? '/admin'
  : role === 'vendor' ? '/vendor'
  : role === 'catalog' ? '/catalog'
  : role === 'supervisor' ? '/supervisor'
  : '/driver'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // Only an explicit sign-out should clear the session. TOKEN_REFRESHED fires
      // routinely (e.g. when a backgrounded tab regains focus) and must not be
      // treated as a logout.
      if (event === 'SIGNED_OUT') {
        setSession(null)
        setProfile(null)
        setLoading(false)
        return
      }
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    setLoading(true)
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        // The error was discarded and profile set to null, which Protected
        // renders as «الحساب غير مفعّل — تواصل مع الإدارة». One dropped request
        // at a compound gate told a driver his account was deactivated. A
        // failed read is not an answer about the account: keep loading and let
        // the next attempt decide.
        // A failed READ is not an answer about the account. Discarding the
        // error and setting profile to null made Protected render
        // «الحساب غير مفعّل — تواصل مع الإدارة», so one dropped request at a
        // compound gate told a driver he had been deactivated. Retry once
        // before believing it, and never overwrite a profile we already hold.
        if (error) {
          setTimeout(() => {
            if (cancelled) return
            supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
              .then(({ data: retry, error: retryErr }) => {
                if (cancelled) return
                // Two consecutive failures is what a bad link at a compound gate
                // looks like. Dropping this error would render «الحساب غير مفعّل»
                // two seconds later -- the original bug, delayed.
                if (retryErr) { setLoading(false); return }
                setProfile((retry as Profile) ?? null)
                setLoading(false)
              })
          }, 2000)
          return
        }
        setProfile((data as Profile) ?? null)
        setLoading(false)
      })
    return () => { cancelled = true }
    // Re-fetch only when the logged-in user actually changes, not on every
    // TOKEN_REFRESHED event (which produces a new session object for the same user).
  }, [session?.user.id])

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
