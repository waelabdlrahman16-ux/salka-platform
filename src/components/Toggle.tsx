import type { ReactNode } from 'react'

/**
 * THE canonical on/off control. Wael's rule, 2026-08-08: «any open or close,
 * on or off use toggle» -- one switch, everywhere, no exceptions.
 *
 * Before this existed the same boolean wore fourteen different costumes across
 * the app: badge-open/badge-closed pills wired as buttons (~26px tall), buttons
 * that swapped btn-danger/btn-sea so red meant "active", raw checkboxes -- one
 * of them INVERTED (checked = out of stock) two screens away from a toggle
 * where checked = in stock. This component replaces all of them.
 *
 * Colour rule it enforces by existing: green = on/open/healthy, grey = off.
 * Red belongs to destructive ACTIONS only, never to a state.
 *
 * Geometry is the original MenuItemsPanel switch (w-10 h-6, emerald-600 on,
 * bg-line off, 16px white knob) with two fixes:
 *  - the knob moves via translate-x from a single anchored side, so it SLIDES;
 *    the old left-1/right-1 swap could not be transitioned and jumped.
 *  - an invisible -inset-2 hit area lifts the 24px-tall control to a ~40px
 *    target without changing how it looks in a dense row.
 */
export default function Toggle({
  on, onChange, label, labelOff, ariaLabel, disabled = false,
}: {
  on: boolean
  onChange: () => void
  /** Optional text beside the switch. Shown as-is when on; labelOff (or the
      same label) when off. Muted when off, emerald when on. */
  label?: ReactNode
  labelOff?: ReactNode
  /** Required when no visible label carries the meaning. */
  ariaLabel?: string
  disabled?: boolean
}) {
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={onChange}
        className={`relative w-10 h-6 rounded-full shrink-0 transition-colors disabled:opacity-40
          before:content-[''] before:absolute before:-inset-2 ${on ? 'bg-emerald-600' : 'bg-line'}`}
      >
        <span
          className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform
            ${on ? '' : 'translate-x-4'}`}
        />
      </button>
      {label != null && (
        <span className={`text-sm font-semibold min-w-0 truncate ${on ? 'text-emerald-800' : 'text-mist'}`}>
          {on ? label : (labelOff ?? label)}
        </span>
      )}
    </span>
  )
}
