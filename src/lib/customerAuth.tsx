import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from './supabase'
import { customerSessionAccess } from './customerSessionAccess'
import { customerAccount } from './customerAccounts'

interface Customer { id: number; name: string | null; phone: string | null; email?: string | null }
interface CustomerAuthState {
  customer: Customer | null
  loading: boolean
  requestOtp: (phone: string) => Promise<{ ok: boolean; error?: string }>
  verifyOtp: (phone: string, code: string, name?: string) => Promise<{ ok: boolean; error?: string }>
  signInWithGoogle: () => Promise<void>
  requestEmailLink: (email: string) => Promise<{ ok: boolean; error?: string }>
  requestPhoneChange: (phone: string) => Promise<{ ok: boolean; error?: string }>
  verifyPhoneChange: (phone: string, code: string) => Promise<{ ok: boolean; error?: string }>
  updateName: (name: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
}

const CustomerAuthContext = createContext<CustomerAuthState | null>(null)

const TOKEN_KEY = 'salka_session_token'

export function CustomerAuthProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loading, setLoading] = useState(true)

  async function refreshFromAuthSession(): Promise<boolean> {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return false
    const res = await customerAccount<Customer | null>('myProfile')
    // Returning false on a failed READ makes the caller fall through to the
    // legacy-token path and, on a Google/email customer who has no legacy row,
    // ends with customer === null -- i.e. a signed-in person shown the signed-out
    // app. Returning true keeps them in their existing session; the profile
    // simply refreshes on the next call.
    if (!res.ok) return true
    if (res.data) { setCustomer(res.data); return true }
    return false
  }

  async function refreshFromLegacyToken() {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) return
    const result = await customerSessionAccess<{
      customer_id: number; name: string | null; phone: string | null
    } | null>('whoami', { token })

    // This one was not merely a silent read -- it was destructive.
    //
    // The error was discarded, so `data` was null for BOTH "the server says
    // this session is not valid" and "the request never reached the server".
    // The else branch then deleted the login token. One dropped request on a
    // patchy Sokhna connection permanently signed the customer out, and because
    // the token is the only copy, there was nothing to recover: they had to log
    // in again, and the app looked like it had forgotten them for no reason.
    //
    // Delete ONLY on a clean answer of "no". A transport failure keeps the
    // token and simply leaves them signed out for this load; the next
    // successful call restores them.
    if (!result.ok) return
    if (result.data) {
      setCustomer({ id: result.data.customer_id, name: result.data.name, phone: result.data.phone })
    } else {
      localStorage.removeItem(TOKEN_KEY)
    }
  }

  useEffect(() => {
    (async () => {
      const viaAuth = await refreshFromAuthSession()
      if (!viaAuth) await refreshFromLegacyToken()
      setLoading(false)
    })()

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        const res = await customerAccount<Customer | null>('myProfile')
        if (res.ok && res.data) setCustomer(res.data)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // supabase-js returns { data: null, error } for ANY non-2xx response, and its
  // error.message is a fixed generic wrapper. So `data?.error` was always
  // undefined on failure and every error collapsed to the literal 'send_failed'
  // -- which made the rate_limited and sms_not_configured branches in
  // CustomerLogin dead code, and told a rate-limited user to retry immediately
  // on a screen with no cooldown. The real code is in the response body.
  // Admin.tsx has used this pattern for admin-accounts all along.
  async function edgeErrorCode(error: unknown, fallback: string): Promise<string> {
    try {
      const body = await (error as { context?: { json?: () => Promise<{ error?: string }> } })?.context?.json?.()
      if (body?.error) return body.error
    } catch { /* body wasn't JSON, or was already consumed */ }
    return fallback
  }

  async function requestOtp(phone: string) {
    const { data, error } = await supabase.functions.invoke('customer-otp', { body: { action: 'request', phone } })
    if (error) return { ok: false, error: await edgeErrorCode(error, 'send_failed') }
    if (data?.error) return { ok: false, error: data.error }
    return { ok: true }
  }

  async function verifyOtp(phone: string, code: string, name?: string) {
    const { data, error } = await supabase.functions.invoke('customer-otp', { body: { action: 'verify', phone, code, name } })
    if (error) return { ok: false, error: await edgeErrorCode(error, 'verify_failed') }
    if (data?.error || !data?.token) return { ok: false, error: data?.error ?? 'verify_failed' }
    localStorage.setItem(TOKEN_KEY, data.token)
    setCustomer(data.customer)
    return { ok: true }
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname }
    })
  }

  async function requestEmailLink(email: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname }
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  async function requestPhoneChange(phone: string) {
    const { data, error } = await supabase.functions.invoke('customer-otp', {
      body: { action: 'request_change', phone }
    })
    if (error) return { ok: false, error: await edgeErrorCode(error, 'send_failed') }
    if (data?.error) return { ok: false, error: data.error }
    return { ok: true }
  }

  async function verifyPhoneChange(phone: string, code: string) {
    const { data, error } = await supabase.functions.invoke('customer-otp', {
      body: { action: 'verify_change', phone, code }
    })
    if (error) return { ok: false, error: await edgeErrorCode(error, 'verify_failed') }
    if (data?.error || !data?.phone) return { ok: false, error: data?.error ?? 'verify_failed' }
    setCustomer(c => c ? { ...c, phone: data.phone } : c)
    return { ok: true }
  }

  async function updateName(name: string) {
    const res = await customerAccount('updateName', { name })
    if (!res.ok) return { ok: false, error: res.error }
    setCustomer(c => c ? { ...c, name } : c)
    return { ok: true }
  }

  /**
   * Every trace of the person, not just their session.
   *
   * Keep logout as the one place that clears account-derived local state. The
   * order-history endpoint now requires proof of identity, but a shared device
   * still must not retain the previous customer's phone or wallet hints.
   */
  async function logout() {
    const { data: { session } } = await supabase.auth.getSession()
    // scope: 'local' only invalidates this tab's session -- the shared-device
    // concern this function exists for (not retaining the previous customer's
    // phone/wallet hints) is handled by the localStorage cleanup below, not by
    // a server-side global revoke. A global sign-out here would also revoke
    // this same auth.users row's refresh token everywhere, which -- since
    // staff and customer sessions live under separate localStorage keys but
    // the SAME underlying account if someone is signed into both as
    // themselves -- can silently log a staff portal tab out too.
    if (session) await supabase.auth.signOut({ scope: 'local' })
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) await customerSessionAccess('logout', { token })
    try {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem('salka_phone')
      // One key per phone number ever typed on this device, each holding that
      // number AND its last known wallet balance. Nothing ever removed them, so
      // a shared device accumulated a list of everyone who had checked out on it.
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('salka_wallet_seen_')) localStorage.removeItem(k)
      }
    } catch { /* private mode: nothing to clear */ }
    setCustomer(null)
  }

  return (
    <CustomerAuthContext.Provider value={{
      customer, loading, requestOtp, verifyOtp, signInWithGoogle, requestEmailLink,
      requestPhoneChange, verifyPhoneChange, updateName, logout
    }}>
      {children}
    </CustomerAuthContext.Provider>
  )
}

export function useCustomerAuth() {
  const ctx = useContext(CustomerAuthContext)
  if (!ctx) throw new Error('useCustomerAuth must be used within CustomerAuthProvider')
  return ctx
}

export function getSessionToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
