import type { ReactNode } from 'react'
import Icon, { type IconName } from './Icon'

/**
 * One control for close, back and icon-only actions.
 *
 * There were FIVE close buttons on customer screens and they were four
 * different things: a bare icon, a text «×» at 21px, a bg-white/80 circle, and
 * a plain grey glyph. Nobody chose that -- each was written where it was
 * needed. This is the smallest possible design system and we did not have one.
 *
 * THE TAP TARGET IS ALWAYS 44px. The circle is the visible affordance, not the
 * touch area, so the small variant does not become a small target: min-w/h
 * hold 44 while the tinted disc inside is 24 or 36.
 *
 * The chip carries a hairline border rather than relying on its fill. --shell
 * (#F4EEE3) against the page ground (#FBF7F1) is 1.06:1 -- effectively
 * invisible -- so a fill-only chip would have needed a rule about which
 * background you are allowed to place it on. A rule like that is exactly how
 * four close buttons happened.
 */
export default function IconButton({
  icon, label, onClick, variant = 'default', size = 'md', className = '', children,
}: {
  icon: IconName
  /** Required: these are icon-only, so this is the accessible name. */
  label: string
  onClick?: () => void
  variant?: 'default' | 'onPhoto' | 'filled' | 'danger'
  size?: 'sm' | 'md'
  className?: string
  children?: ReactNode
}) {
  const disc = size === 'sm' ? 'w-6 h-6' : 'w-9 h-9'
  const skin =
    variant === 'onPhoto' ? 'bg-shell/90 border-line text-foam shadow-sm'
    : variant === 'filled' ? 'bg-sea border-sea text-white hover:bg-seadeep'
    : variant === 'danger' ? 'bg-shell border-dangerline text-danger hover:bg-dangerbg'
    : 'bg-shell border-line text-mist hover:bg-line hover:text-foam'
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={`grid place-items-center shrink-0 min-w-[44px] min-h-[44px] ${className}`}>
      <span className={`${disc} rounded-full border grid place-items-center transition-colors ${skin}`}>
        <Icon name={icon} size={size === 'sm' ? 'xs' : 'sm'} />
      </span>
      {children}
    </button>
  )
}
