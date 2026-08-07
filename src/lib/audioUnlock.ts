let sharedCtx: AudioContext | null = null
let unlockAttached = false

function tryResume() {
  if (sharedCtx && sharedCtx.state === 'suspended') {
    sharedCtx.resume().catch(() => { /* still locked, will retry on next gesture */ })
  }
}

function attachUnlockListener() {
  if (unlockAttached) return
  unlockAttached = true
  const events = ['pointerdown', 'touchstart', 'keydown']
  const handler = () => {
    tryResume()
  }
  for (const e of events) document.addEventListener(e, handler, { passive: true })
}

// Returns a shared AudioContext, created lazily, and attempts to resume it
// immediately (works if we're already inside a user-gesture call stack) --
// also arms a one-time listener so the very next tap/touch/keypress anywhere
// on the page unlocks it if this call wasn't itself triggered by a gesture
// (which is the normal case here: ring/ping fire from a polling timer, not
// a click).
export function getAudioContext(): AudioContext {
  if (!sharedCtx) {
    sharedCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
  }
  tryResume()
  attachUnlockListener()
  return sharedCtx
}

/**
 * True when a beep would be inaudible because the browser has not been given a
 * user gesture yet.
 *
 * This is not a corner case, it is the NORMAL state of an admin tab. The page
 * is opened, left on screen, and never clicked; every alert fires from a
 * polling timer, so nothing ever unlocks audio. On 2026-08-07 a stalled-order
 * banner appeared at 18:10 with no sound at all and read as "the notification
 * came silently" -- the banner is drawn by the service worker and does not care
 * about audio, so the two halves fail independently and only one of them is
 * visible.
 *
 * Exposed so a screen can offer one tap to fix it, because there is no way to
 * unlock audio without one.
 */
export function audioBlocked(): boolean {
  if (typeof window === 'undefined') return false
  if (!sharedCtx) return true
  return sharedCtx.state === 'suspended'
}

/** Call from a real click. Creates the context if needed and resumes it. */
export function unlockAudio(): void {
  try { getAudioContext() } catch { /* unsupported */ }
}
