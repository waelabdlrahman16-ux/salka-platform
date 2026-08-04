import { useEffect, useRef } from 'react'

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableWithin(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(el => el.offsetParent !== null || el === document.activeElement)
}

/**
 * Keyboard behaviour for a full-screen overlay: Escape to dismiss, Tab confined
 * to the overlay, and focus returned to whatever opened it.
 *
 * Nine of the ten overlays in this app had none of it. On desktop admin work
 * that means reaching for the mouse to close every dialog, and for anyone
 * navigating by keyboard it means Tab silently walks off into the page behind
 * the overlay -- which is still fully interactive, just invisible.
 *
 * Pass `onDismiss: null` for an overlay that is deliberately mandatory. It still
 * gets the focus trap and focus restoration, but Escape will not close it --
 * PhonePrompt is the case that matters: it exists precisely because an order
 * cannot proceed without a phone number.
 *
 * Attach the returned ref to the overlay's outermost element.
 */
export function useDismissable<T extends HTMLElement = HTMLDivElement>(
  onDismiss: (() => void) | null,
  active = true,
) {
  const containerRef = useRef<T>(null)

  // Callers pass an inline arrow function, so onDismiss has a new identity every
  // render. Reading it through a ref keeps it out of the effect's dependencies --
  // otherwise the listener is torn down and rebuilt on every keystroke typed
  // into the overlay, and the focus-restore cleanup fires with it.
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  useEffect(() => {
    if (!active) return
    const previouslyFocused = document.activeElement as HTMLElement | null

    // Focus the container, not its first field. Focusing an input here would
    // raise the on-screen keyboard the instant any sheet opens, which on a
    // phone hides most of the sheet the user was trying to read.
    const node = containerRef.current
    if (node && !node.contains(document.activeElement)) {
      if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1')
      node.focus({ preventScroll: true })
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const dismiss = onDismissRef.current
        if (!dismiss) return
        e.preventDefault()
        // Stop here rather than letting it bubble: with a sheet open above a
        // modal, Escape should close one layer, not both.
        e.stopPropagation()
        dismiss()
        return
      }
      if (e.key !== 'Tab') return
      const root = containerRef.current
      if (!root) return
      const items = focusableWithin(root)
      if (items.length === 0) { e.preventDefault(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      const outside = !root.contains(current)
      if (e.shiftKey && (current === first || outside)) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && (current === last || outside)) {
        e.preventDefault(); first.focus()
      }
    }

    // Capture phase, so the trap runs before any field's own key handling.
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      // The opener is often unmounted along with the overlay (a row that was
      // filtered away by the refresh the dialog triggered), in which case
      // focus() is a no-op and the browser falls back to <body>.
      previouslyFocused?.focus?.()
    }
  }, [active])

  return containerRef
}
