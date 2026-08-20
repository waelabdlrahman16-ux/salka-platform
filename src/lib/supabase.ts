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

/** PostgREST's db-max-rows for this project. See lib/selectAll.ts. */
const ROW_CEILING = 1000

/**
 * The 1000-row cap is silent by design: PostgREST truncates and returns 200 OK
 * with no indication that anything was dropped. That silence is what let the
 * admin portal hide fifteen menu items for weeks -- the screen looked fine, the
 * data was simply incomplete, and nothing anywhere said so.
 *
 * It cannot be silent twice. Every response carries a `content-range` header
 * saying which rows came back, so a read that returns exactly the ceiling is
 * either already truncated or one row away from it. Both are worth shouting
 * about, and shouting costs nothing: this reads a header that is already there.
 *
 * The fix for anything this catches is `selectAll()` from lib/selectAll.ts.
 */
function truncationAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Both `.limit()` and `.range()` compile to a `limit=` query parameter, so a
  // request carrying one asked for a bounded window on purpose -- that is every
  // page selectAll() fetches. Those come back full of rows by design and must
  // stay quiet, or the fix for this bug would bury the console in warnings
  // about itself.
  //
  // A request with no `limit=` asked for everything there is. If THAT one comes
  // back holding precisely the ceiling, rows were dropped.
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const isDeliberatelyBounded = /[?&]limit=/.test(target)

  return fetch(input, init).then(response => {
    if (isDeliberatelyBounded) return response
    try {
      const range = response.headers.get('content-range')
      // "0-999/*" -- first row, last row, then the total (often unknown).
      if (range) {
        const [from, to] = range.split('/')[0].split('-').map(Number)
        if (Number.isFinite(from) && Number.isFinite(to) && to - from + 1 >= ROW_CEILING) {
          console.error(
            `[salka] TRUNCATED READ: ${to - from + 1} rows came back, which is PostgREST's ceiling. ` +
            `Rows are missing and nothing else will tell you. Page this query with selectAll(). URL: ${target}`,
          )
        }
      }
    } catch {
      // A diagnostic must never be able to break a request.
    }
    return response
  })
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
  global: { fetch: truncationAwareFetch },
})
