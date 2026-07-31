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
