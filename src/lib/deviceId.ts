// A stable per-browser identifier, used to bind a driver account to one phone.
//
// Deliberately NOT a security token. Anyone who wants to defeat this can read
// localStorage and copy the value to a second phone. It exists to stop casual
// account sharing -- handing a login to a friend so two people work one
// account -- which is the actual problem, and to make deliberate sharing show
// up in driver_device_log. Treat it as a device *label*, never as proof of who
// is calling.
//
// localStorage, not sessionStorage: it has to survive closing the app, which is
// the whole point. The cost is that clearing browser data looks like a new
// phone and needs an admin reset -- accepted knowingly when the "first phone
// wins" rule was chosen.

const KEY = 'salka_device_id'

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(KEY)
    if (existing) return existing
    const id = newId()
    localStorage.setItem(KEY, id)
    return id
  } catch {
    // Private mode or storage disabled. Returning a fresh id every call would
    // lock the driver out on their second page load, so return a per-session
    // constant instead and let it fail on the NEXT app open rather than
    // mid-shift. There is nothing better available without storage.
    return sessionFallback()
  }
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  } catch { /* fall through */ }
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

let cachedFallback = ''
function sessionFallback(): string {
  if (!cachedFallback) cachedFallback = newId()
  return cachedFallback
}

/**
 * Something an admin can read in the drivers tab and match against a phone in
 * front of them: "iPhone • Safari". Not parsed by anything, never trusted --
 * userAgent is trivially spoofed and increasingly reduced by browsers.
 */
export function getDeviceLabel(): string {
  if (typeof navigator === 'undefined') return ''
  const ua = navigator.userAgent || ''

  const os =
    /iPhone/i.test(ua) ? 'iPhone' :
    /iPad/i.test(ua) ? 'iPad' :
    /Android/i.test(ua) ? 'Android' :
    /Windows/i.test(ua) ? 'Windows' :
    /Mac OS X/i.test(ua) ? 'Mac' : 'جهاز'

  const browser =
    // Order matters: Edge and Chrome both contain "Chrome", and every iOS
    // browser contains "Safari".
    /Edg\//i.test(ua) ? 'Edge' :
    /OPR\//i.test(ua) ? 'Opera' :
    /Chrome\//i.test(ua) ? 'Chrome' :
    /Firefox\//i.test(ua) ? 'Firefox' :
    /Safari\//i.test(ua) ? 'Safari' : ''

  return browser ? `${os} • ${browser}` : os
}
