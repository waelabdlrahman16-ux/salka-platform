// Platform checks that more than one component needs.
//
// isIOS/isStandalone were written inside InstallPrompt.tsx and then needed
// again by EnablePushButton, which is exactly how this codebase has ended up
// with five copies of the same sum before. One home.

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as any).standalone === true   // iOS Safari
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const classic = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream
  // iPadOS 13+ reports as a Mac in the user agent, but has touch support.
  const modernIpad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return classic || modernIpad
}

/**
 * Chrome (and Firefox, and Edge) on iOS are all Safari underneath -- Apple
 * requires WebKit. None of them can receive web push at all, at any iOS
 * version, because the Push API is only exposed to an installed Home Screen
 * app in Safari's own engine.
 *
 * This matters because "notifications don't work in Chrome on my iPhone" has a
 * definite answer -- they cannot -- and the app was showing nothing at all rather
 * than saying so.
 */
export function isIOSNonSafari(): boolean {
  if (!isIOS()) return false
  return /CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent)
}

/**
 * Why push is unavailable on this iOS device, or null when it should work.
 *
 * iOS 16.4+ supports web push, but ONLY for a site added to the Home Screen.
 * In a Safari tab the Push API is absent, so the app can do nothing except
 * explain the one step that fixes it.
 */
export function iosPushBlocker(): 'not-safari' | 'not-installed' | null {
  if (!isIOS()) return null
  if (isIOSNonSafari()) return 'not-safari'
  if (!isStandalone()) return 'not-installed'
  return null
}
