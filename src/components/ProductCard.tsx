import { artFor } from '../lib/categoryArt'
import Icon from './Icon'
import type { MenuItem } from '../lib/types'

/**
 * A menu item card.
 *
 * Rebuilt 2026-08-07 from a rendered before/after Wael approved. The previous
 * version put the add control ON the photograph, which bought back ~40px of
 * height per card but covered the middle of the food -- and the food is the
 * thing that sells. His words: "feeling like a draft for developer". Both are
 * fixable at once: the control moves down onto the same line as the price,
 * which costs no extra height because that line already existed.
 *
 * EQUAL HEIGHTS, by construction, still Wael's constraint. The tile is a flex
 * column and the price/action row sits on `mt-auto`, so it lands on the same
 * baseline in every card in the row regardless of how long the name is. A grid
 * of food where the buttons zig-zag looks broken in a way no single card does.
 */

/**
 * 157 items in this catalogue carry a description that is character-for-
 * character their own name -- 83 of 85 in أرابياتا, 51 of 71 in ديڤادو. The
 * card used to reserve two lines for it unconditionally, so on those items a
 * third of the card's height was spent printing the title a second time. That
 * is most of what made the grid read as unfinished.
 *
 * Guarded here rather than cleaned in the database because the next item
 * someone types will do it again -- the vendor import tools fill `description`
 * with the name when the source has no separate blurb.
 */
function usefulDescription(item: MenuItem): string | null {
  const desc = (item.description ?? '').trim()
  if (!desc) return null
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
  if (norm(desc) === norm(item.name)) return null
  return desc
}

export default function ProductCard({
  item, qty, disabled, onAdd, onRemove, hasOptions, onCustomize, onOpenDetail,
  displayPrice, originalPrice, isFromPrice, optionLabel, optionCount,
}: {
  item: MenuItem
  qty: number
  disabled?: boolean
  onAdd: () => void
  onRemove: () => void
  hasOptions?: boolean
  onCustomize?: () => void
  onOpenDetail: () => void
  displayPrice: number
  originalPrice?: number
  isFromPrice?: boolean
  /**
   * What the options sheet will actually ask, taken from the item's own option
   * group -- "بيف أو تشيكن", "الحجم". Null falls back to a generic label.
   */
  optionLabel?: string | null
  /**
   * How many choices that group actually offers, so the pill can say «3 أحجام»
   * instead of a bare «اختار». The customer then knows why they are being sent
   * to a sheet before they tap it.
   */
  optionCount?: number
}) {
  const art = artFor(item.category)
  const desc = usefulDescription(item)
  const optionsChip = optionCount && optionCount > 1 && optionLabel
    ? `${optionCount} ${optionLabel}`
    : null

  return (
    <div className="card p-2 flex flex-col h-full">
      <button className="text-right flex flex-col w-full" onClick={onOpenDetail} aria-label={item.name}>
        {/* Square, not 4:3. The landscape crop was taking the top and bottom off
            a plated dish shot from above, which is how most of this catalogue is
            photographed. Square also makes the tiles the same height without
            the layout having to force it. */}
        <div className="relative rounded-md aspect-square grid place-items-center text-3xl overflow-hidden"
          style={{ background: item.image_url ? '#fff' : art.tint }}>
          {item.image_url
            // contain, not cover: half this catalogue is packaged goods shot
            // upright on white, and cover crops the top off a can. A food photo
            // loses a little edge; a product loses its lid.
            ? <img src={item.image_url} alt={item.name} loading="lazy" decoding="async"
                className="w-full h-full object-contain" />
            : art.emoji}
          {item.requires_prescription && (
            <span className="absolute top-1.5 right-1.5 bg-white/90 rounded-full px-2 py-0.5 text-[10px] font-bold text-seadeep">
              💊 روشتة
            </span>
          )}
          {originalPrice != null && (
            // bg-sand carried white text at 2.87:1, against the palette file's
            // own rule that sand "must never carry text". sandink is the same
            // hue at 6.4:1. And since we are here: say how much, not just that
            // there is one -- «خصم» tells the customer nothing they can weigh.
            <span className="absolute top-1.5 left-1.5 bg-sandink text-white rounded-full px-2 py-0.5 text-[10px] font-bold">
              خصم <bdi dir="ltr">{Math.round((1 - displayPrice / originalPrice) * 100)}%</bdi>
            </span>
          )}
          {/* On the photo, but small and in a corner, because it is a FACT about
              the item rather than a control -- it tells you a sheet is coming
              before you tap, instead of ambushing you after. The button itself
              is down with the price with everything else. */}
          {optionsChip && !originalPrice && (
            <span className="absolute bottom-1.5 right-1.5 bg-white/92 text-seadeep rounded-full px-2 py-0.5 text-[10px] font-bold">
              {optionsChip}
            </span>
          )}
        </div>

        {/* Two lines, clamped, with the height reserved. One truncated line was
            cutting real names in half -- «فرخة كاملة مجمدة (1100-1200 جم)» has
            nothing droppable in it -- and reserving the second keeps the price
            row on one baseline across the row. */}
        <h3 className="font-semibold text-sm leading-snug line-clamp-2 min-h-[2.6em] mt-1.5"
          title={item.name}>{item.name}</h3>

        {/* No reserved height any more. When there is nothing worth saying the
            line simply does not exist, and `mt-auto` on the row below absorbs
            the difference. */}
        {desc && (
          <p className="text-[11px] text-mist leading-snug line-clamp-1">{desc}</p>
        )}
      </button>

      {/* PRICE AND ACTION, ONE LINE, PINNED TO THE BOTTOM.
          The eye reads "how much" and "add it" together instead of hopping
          between a button on the photograph and a number two lines below it. */}
      <div className="mt-auto pt-2 flex items-center justify-between gap-2">
        <span className="min-w-0">
          {originalPrice != null && (
            <span className="text-mist text-[11px] line-through ml-1.5">{originalPrice}</span>
          )}
          {/* foam, not sea. Teal is the app's "do something" colour; when the
              price wore it too, the price competed with the control beside it
              and neither read as the primary thing. */}
          <span className="text-foam font-bold whitespace-nowrap">
            {/* "من" whenever the final figure is decided in the options sheet.
                Without it, an item sold only in sizes quotes a price it cannot
                be bought at -- 6 وينجز reads 190 on the column and costs 300. */}
            {isFromPrice && <span className="text-[10px] text-mist font-semibold">من </span>}
            {displayPrice} <span className="text-[11px] font-medium text-mist">ج.م</span>
          </span>
        </span>

        {hasOptions ? (
          <button
            className="h-9 px-3 rounded-full bg-sea text-white font-bold text-[12px] shrink-0 hover:bg-seadeep transition-colors disabled:opacity-40 disabled:pointer-events-none"
            disabled={disabled} onClick={onCustomize}
            aria-label={`اختيارات ${item.name}`}>
            {qty > 0 ? `${qty} ✓` : 'اختار'}
          </button>
        ) : qty === 0 ? (
          <button
            className="w-9 h-9 rounded-full bg-sea text-white grid place-items-center shrink-0 hover:bg-seadeep transition-colors disabled:opacity-40 disabled:pointer-events-none"
            disabled={disabled} onClick={onAdd} aria-label={`إضافة ${item.name}`}>
            <Icon name="plus" className="w-4 h-4" />
          </button>
        ) : (
          // 36px tall rather than 44. The whole row is a touch target 36px high
          // and the two halves are 30px wide each, which clears the 24px CSS-px
          // floor WCAG 2.2 asks for at AA and keeps two cards per row on a
          // 360px phone. The 44px version forced the price to wrap.
          <div className="h-9 rounded-full bg-sea text-white flex items-center shrink-0 px-0.5">
            <button className="w-[30px] h-8 rounded-full grid place-items-center hover:bg-white/15 transition-colors"
              onClick={onRemove} aria-label={`تقليل ${item.name}`}><Icon name="minus" className="w-3.5 h-3.5" /></button>
            <span className="font-bold text-sm min-w-[1.1rem] text-center">{qty}</span>
            <button className="w-[30px] h-8 rounded-full grid place-items-center hover:bg-white/15 transition-colors"
              onClick={onAdd} aria-label={`زيادة ${item.name}`}><Icon name="plus" className="w-3.5 h-3.5" /></button>
          </div>
        )}
      </div>
    </div>
  )
}
