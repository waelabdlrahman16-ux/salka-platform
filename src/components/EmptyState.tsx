import type { ReactNode } from 'react'
import Icon, { type IconName } from './Icon'

/**
 * One shape for every "there is nothing here" screen.
 *
 * They were each written separately and drifted: the cart used py-16 with a
 * primary button, Offers used py-10 with no icon at all, Profile used py-6 and
 * plain text. Same message, four different weights, so an empty screen looked
 * like a different product depending on which tab you were on.
 *
 * The rules, per Wael:
 *   - always an icon, muted
 *   - the whole block muted, not just the subtitle
 *   - centred in the PAGE, not merely centred horizontally at the top
 *   - the action is SECONDARY. An empty state is a dead end, not a task: a
 *     primary button here competes with the real primary action on every other
 *     screen and overstates a suggestion.
 *
 * `minHeight` uses svh rather than vh so mobile browser chrome does not push
 * the block below the fold as the address bar collapses.
 */
export default function EmptyState({
  icon, title, body, action, notice, compact = false,
}: {
  icon: IconName
  title: string
  body?: ReactNode
  action?: { label: string; onClick: () => void }
  /** Anything that must be said before the empty message -- e.g. why the cart emptied. */
  notice?: ReactNode
  /**
   * For an empty SECTION rather than an empty screen. Same icon and same muting,
   * but it does not claim the viewport: Home's vendor list has a closed-vendors
   * block under it, and Profile's addresses sit inside a longer form. Centring
   * those in the page would push real content off it.
   */
  compact?: boolean
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center px-6 ${compact ? 'py-10' : ''}`}
      style={compact ? undefined : { minHeight: 'calc(100svh - 190px)' }}>
      {notice}
      <Icon name={icon} size={compact ? 'lg' : 'xl'} className="text-line mb-3" />
      <p className={`font-bold text-mist mb-1 ${compact ? 'text-[15px]' : 'text-lg'}`}>{title}</p>
      {body && <p className="text-mist text-sm mb-5 max-w-[30ch]">{body}</p>}
      {action && (
        <button className="btn-ghost" onClick={action.onClick}>{action.label}</button>
      )}
    </div>
  )
}
