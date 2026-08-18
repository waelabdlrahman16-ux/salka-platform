import { createClient } from '@supabase/supabase-js'
import type { Profile } from './auth'

// The publishable (anon) key is designed to be public -- it ships in the browser
// bundle either way. Data is protected by row-level security policies, not by
// hiding this key. See supabase/auth.sql.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://pqpnwxyevrsipklzmwex.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_rI0HsZAc1WSRXAFce0BXBA_3Fiuz3Cj'

type AuthScope = 'customer' | Profile['role'] | 'staff-login'

const STAFF_SCOPES: Profile['role'][] = ['admin', 'driver', 'vendor', 'catalog', 'supervisor', 'observer']
const LAST_STAFF_HOME_KEY = 'salka_last_staff_home'

export function authScopeForPathname(pathname: string): AuthScope {
  const staff = STAFF_SCOPES.find(scope => pathname.startsWith(`/${scope}`))
  if (staff) return staff
  if (pathname.startsWith('/login')) return 'staff-login'
  return 'customer'
}

function storageKey(scope: AuthScope): string {
  return `salka-${scope}-auth-token`
}

function copySession(from: string, to: string, overwrite: boolean): boolean {
  try {
    if (from === to) return false
    const session = localStorage.getItem(from)
    if (!session || (!overwrite && localStorage.getItem(to))) return false

    // Supabase may also persist these adjacent values. Move them with the
    // session so an OAuth callback or split user storage cannot be orphaned.
    for (const suffix of ['', '-code-verifier', '-user']) {
      const value = localStorage.getItem(from + suffix)
      if (value !== null) localStorage.setItem(to + suffix, value)
      localStorage.removeItem(from + suffix)
    }
    return true
  } catch {
    // Private browsing can make storage unavailable. Supabase will fall back
    // to its normal in-memory warning; never stop the app from opening.
    return false
  }
}

function removeSession(key: string): void {
  try {
    for (const suffix of ['', '-code-verifier', '-user']) localStorage.removeItem(key + suffix)
  } catch { /* private mode */ }
}

function hasSession(key: string): boolean {
  try { return localStorage.getItem(key) !== null } catch { return false }
}

const initialScope = authScopeForPathname(typeof window === 'undefined' ? '/' : window.location.pathname)
const activeStorageKey = storageKey(initialScope)

// Preserve the session that predates isolation. The default key is derived
// from the configured hostname, so include both the custom auth domain and the
// project URL used by older builds. Removing the source is important: leaving
// two clients refreshing the same rotating token recreates the race this fix
// is meant to remove.
if (typeof window !== 'undefined') {
  const configuredLegacyKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
  for (const legacyKey of new Set([configuredLegacyKey, 'sb-pqpnwxyevrsipklzmwex-auth-token'])) {
    if (copySession(legacyKey, activeStorageKey, false)) break
    // A newer isolated session wins. Still retire the shared copy so a tab on
    // the previous build cannot race this one with the same refresh token.
    if (hasSession(activeStorageKey)) removeSession(legacyKey)
  }
  if (STAFF_SCOPES.includes(initialScope as Profile['role'])) {
    try { localStorage.setItem(LAST_STAFF_HOME_KEY, `/${initialScope}`) } catch { /* private mode */ }
  }
}

/**
 * /login has no role yet. Once the profile arrives, move that freshly-issued
 * session into the role's namespace before loading the workspace.
 */
export function promoteCurrentSessionToRole(role: Profile['role']): string {
  const home = `/${role}`
  copySession(activeStorageKey, storageKey(role), true)
  try { localStorage.setItem(LAST_STAFF_HOME_KEY, home) } catch { /* private mode */ }
  return home
}

/** The installed app starts at /. Remember which staff board it should reopen. */
export function lastStaffHome(): string | null {
  try {
    const home = localStorage.getItem(LAST_STAFF_HOME_KEY)
    return STAFF_SCOPES.some(scope => home === `/${scope}`) ? home : null
  } catch {
    return null
  }
}

/** An explicit “customer” action wins over the installed-app staff shortcut. */
export function forgetLastStaffHome(): void {
  try { localStorage.removeItem(LAST_STAFF_HOME_KEY) } catch { /* private mode */ }
}

export const supabase = createClient(url, key, {
  auth: {
    storageKey: activeStorageKey,
    persistSession: true,
    autoRefreshToken: true,
    // Staff authentication is password-only. Only customer routes should
    // consume Google/email OAuth parameters from the URL.
    detectSessionInUrl: initialScope === 'customer',
  },
})
