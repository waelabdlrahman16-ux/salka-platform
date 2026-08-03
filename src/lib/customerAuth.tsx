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

  async function requestOtp(phone: string) {
    const { data, error } = await supabase.functions.invoke('customer-otp', { body: { action: 'request', phone } })
    if (error || data?.error) return { ok: false, error: data?.error ?? 'send_failed' }
    return { ok: true }
  }

  async function verifyOtp(phone: string, code: string, name?: string) {
    const { data, error } = await supabase.functions.invoke('customer-otp', { body: { action: 'verify', phone, code, name } })
    if (error || data?.error || !data?.token) return { ok: false, error: data?.error ?? 'verify_failed' }
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
      customer, loading, requestOtp, verifyOtp, signInWithGoogle, requestEmailLink, updatePhone, logout
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
