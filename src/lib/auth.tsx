import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { Session } from '@supabase/supabase-js'

export interface Profile {
  id: string
  role: 'admin' | 'driver' | 'vendor' | 'catalog' | 'supervisor' | 'observer'
  driver_id: number | null
  restaurant_id: number | null
  name: string
}

interface AuthCtx {
  session: Session | null
  profile: Profile | null
  loading: boolean
  /**
   * True when we could not READ the profile, as distinct from having read it
   * and found nothing. Without this the two are indistinguishable downstream --
   * both are `profile === null` -- and Protected told a driver on bad signal
   * that his account had been deactivated.
   */
  profileError: boolean
  retryProfile: () => void
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthCtx>({
  session: null, profile: null, loading: true,
  profileError: false, retryProfile: () => {},
  signIn: async () => null, signOut: async () => {}
})

export const useAuth = () => useContext(Ctx)

export const homeFor = (role: Profile['role']) =>
  role === 'admin' ? '/admin'
  : role === 'vendor' ? '/vendor'
  : role === 'catalog' ? '/catalog'
  : role === 'supervisor' ? '/supervisor'
  : role === 'observer' ? '/observer'
  : '/driver'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState(false)
  const [attempt, setAttempt] = useState(0)

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
    setProfileError(false)
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        // A failed READ is not an answer about the account. Discarding the
        // error and setting profile to null made Protected render
        // «الحساب غير مفعّل -- تواصل مع الإدارة», so one dropped request at a
        // compound gate told a driver he had been deactivated. Retry once
        // before believing it, and never overwrite a profile we already hold.
        if (error) {
          setTimeout(() => {
            if (cancelled) return
            supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
              .then(({ data: retry, error: retryErr }) => {
                if (cancelled) return
                // Two consecutive failures is what a bad link at a compound gate
                // looks like. The retry alone was not enough: falling through
                // with profile still null rendered «الحساب غير مفعّل» two
                // seconds later -- the original bug, delayed. Say we could not
                // check, and offer to try again.
                if (retryErr) { setProfileError(true); setLoading(false); return }
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
    // TOKEN_REFRESHED event (which produces a new session object for the same
    // user) -- plus `attempt`, which the retry button bumps.
  }, [session?.user.id, attempt])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    return error ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : null
  }

  async function signOut() {
    // Default scope is 'global': it revokes the refresh token server-side for
    // this auth.users row, not just this tab's session. Staff and customer
    // sessions already live under separate localStorage keys/BroadcastChannels
    // (see supabase.ts), so a global sign-out here isn't needed to clear this
    // tab -- and if the same person is signed into both a staff portal and the
    // customer store as the same account, it silently logs the OTHER tab out
    // too on its next token refresh.
    await supabase.auth.signOut({ scope: 'local' })
    setProfile(null)
  }

  return <Ctx.Provider value={{
    session, profile, loading, profileError,
    retryProfile: () => setAttempt(a => a + 1),
    signIn, signOut
  }}>{children}</Ctx.Provider>
}
