/**
 * Catches `beforeinstallprompt` at app start and holds it.
 *
 * WHY THIS MODULE EXISTS. Chrome fires `beforeinstallprompt` ONCE, early in the
 * page lifecycle, and does not replay it for listeners that attach afterwards.
 * InstallPrompt used to be mounted in AppShell, so its own listener was up in
 * time. On 2026-08-07 the component was moved to Track's delivered state -- the
 * right call for when to ask -- which meant it now mounts minutes after load, or
 * after an SPA navigation where the event never fires again. Its listener was
 * attached to an event that had already gone, so `deferredPrompt` stayed null
 * forever and the Android install path became unreachable. The iOS branch kept
 * working because it needs no event, so the regression was invisible on the
 * phone it was tested on.
 *
 * Listening here, from main.tsx, decouples CATCHING the event from CHOOSING
 * when to offer it.
 */

type PromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: PromptEvent | null = null
const listeners = new Set<(e: PromptEvent | null) => void>()

export function listenForInstallPrompt(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', e => {
    // Without preventDefault Chrome shows its own mini-infobar and the event is
    // spent; we want to ask at a moment the customer understands.
    e.preventDefault()
    deferred = e as PromptEvent
    for (const fn of listeners) fn(deferred)
  })
  // Once installed the offer is meaningless and must not reappear.
  window.addEventListener('appinstalled', () => {
    deferred = null
    for (const fn of listeners) fn(null)
  })
}

/** The captured event, or null if Chrome has not offered one. */
export function getInstallPrompt(): PromptEvent | null {
  return deferred
}

/** Subscribe; fires immediately with the current value. Returns an unsubscribe. */
export function onInstallPrompt(fn: (e: PromptEvent | null) => void): () => void {
  listeners.add(fn)
  fn(deferred)
  return () => { listeners.delete(fn) }
}

export function clearInstallPrompt(): void {
  deferred = null
}
