import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from './supabase'

interface Customer { id: number; name: string | null; phone: string }
interface CustomerAuthState {
  customer: Customer | null
  loading: boolean
  requestOtp: (phone: string) => Promise<{ ok: boolean; error?: string }>
  verifyOtp: (phone: string, code: string, name?: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
}

const CustomerAuthContext = createContext<CustomerAuthState | null>(null)

const TOKEN_KEY = 'salka_session_token'

export function CustomerAuthProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) { setLoading(false); return }
    const { data } = await supabase.rpc('session_whoami', { p_token: token })
    if (data) {
      setCustomer({ id: data.customer_id, name: data.name, phone: data.phone })
    } else {
      localStorage.removeItem(TOKEN_KEY)
    }
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

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

  async function logout() {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) await supabase.rpc('session_logout', { p_token: token })
    localStorage.removeItem(TOKEN_KEY)
    setCustomer(null)
  }

  return (
    <CustomerAuthContext.Provider value={{ customer, loading, requestOtp, verifyOtp, logout }}>
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
