import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from './supabase'

interface Customer { id: number; name: string | null; phone: string | null; email?: string | null }
interface CustomerAuthState {
  customer: Customer | null
  loading: boolean
  requestOtp: (phone: string) => Promise<{ ok: boolean; error?: string }>
  verifyOtp: (phone: string, code: string, name?: string) => Promise<{ ok: boolean; error?: string }>
  signInWithGoogle: () => Promise<void>
  requestEmailLink: (email: string) => Promise<{ ok: boolean; error?: string }>
  updatePhone: (phone: string) => Promise<{ ok: boolean; error?: string }>
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
    const { data } = await supabase.rpc('my_customer_profile')
    if (data) { setCustomer(data); return true }
    return false
  }

  async function refreshFromLegacyToken() {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) return
    const { data } = await supabase.rpc('session_whoami', { p_token: token })
    if (data) {
      setCustomer({ id: data.customer_id, name: data.name, phone: data.phone })
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
        const { data } = await supabase.rpc('my_customer_profile')
        if (data) setCustomer(data)
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

  async function updatePhone(phone: string) {
    const { error } = await supabase.rpc('update_my_customer_phone', { p_phone: phone })
    if (error) return { ok: false, error: error.message }
    setCustomer(c => c ? { ...c, phone } : c)
    return { ok: true }
  }

  async function updateName(name: string) {
    const { error } = await supabase.rpc('update_my_customer_name', { p_name: name })
    if (error) return { ok: false, error: error.message }
    setCustomer(c => c ? { ...c, name } : c)
    return { ok: true }
  }

  async function logout() {
    const { data: { session } } = await supabase.auth.getSession()
    if (session) await supabase.auth.signOut()
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) await supabase.rpc('session_logout', { p_token: token })
    localStorage.removeItem(TOKEN_KEY)
    setCustomer(null)
  }

  return (
    <CustomerAuthContext.Provider value={{
      customer, loading, requestOtp, verifyOtp, signInWithGoogle, requestEmailLink, updatePhone, updateName, logout
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
