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
 * THE TAP TARGET IS ALWAYS 44px. The disc is the visible affordance, not the
 * touch area, so the small variant does not become a small target: min-w/h
 * hold 44 while the tinted disc inside is 24 or 32.
 *
 * The disc is a fill, not a stroke. --shell (#F4EEE3) was too close to the
 * page ground (1.06:1) to carry a fill on its own, which is why this used to
 * be a hairline chip; slate-200 clears both the cream page and a white modal
 * panel, so the fill can do the work and the outline can go.
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
  const disc = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8'
  const skin =
    variant === 'onPhoto' ? 'bg-white/90 text-slate-800 shadow-sm'
    : variant === 'filled' ? 'bg-sea text-white hover:bg-seadeep'
    : variant === 'danger' ? 'bg-dangerbg text-danger hover:bg-dangerline/30'
    : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={`grid place-items-center shrink-0 min-w-[44px] min-h-[44px] ${className}`}>
      <span className={`${disc} rounded-full grid place-items-center transition-colors ${skin}`}>
        <Icon name={icon} size={size === 'sm' ? 'xs' : 'sm'} />
      </span>
      {children}
    </button>
  )
}
