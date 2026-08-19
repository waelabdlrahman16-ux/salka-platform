import Icon, { type IconSize } from './Icon'
import type { artFor } from '../lib/categoryArt'

type Art = ReturnType<typeof artFor>

// One place decides how a category tile is drawn, because the two cases are not
// interchangeable: food categories carry an emoji (it stands in for product
// photography, so the colour is the point) and non-food ones carry an icon.
// Spreading that choice across the seven call sites is how they drift apart --
// a pharmacy tile showing a pill on one screen and the emoji on the next.
export default function CategoryArt({ art, size = 'lg', className = '' }: {
  art: Art; size?: IconSize; className?: string
}) {
  if (art.icon) return <Icon name={art.icon} size={size} className={className} />
  return <>{art.emoji}</>
}
