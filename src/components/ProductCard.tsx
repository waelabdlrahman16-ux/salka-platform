import { artFor } from '../lib/categoryArt'
import CategoryArt from './CategoryArt'
import Icon from './Icon'
import type { MenuItem } from '../lib/types'
import { sized, IMG } from '../lib/imageUrl'

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
  displayPrice, originalPrice, isFromPrice,
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
}) {
  const art = artFor(item.category)
  const desc = usefulDescription(item)
  const discountPct = originalPrice != null && originalPrice > 0
    ? (() => { const p = Math.round((1 - displayPrice / originalPrice) * 100); return p >= 1 ? p : null })()
    : null

  return (
    <div className="card p-2 flex flex-col h-full">
      <button className="text-right flex flex-col w-full" onClick={onOpenDetail} aria-label={item.name}>
        {/* 4:3, reverted from square on 2026-08-07 after Wael sent a screenshot.
            Measured at real phone width: the square version made a 278px card
            with a visible void between the name and the price row, because the
            photo box alone was ~165px on a 2-column grid. 4:3 brings the card to
            230px with a genuinely two-line name in it, and the price rows still
            land on one baseline.

            The letterbox is `shellup`, not white. Half this catalogue is
            packaged goods shot square -- أرابياتا has items whose photo is
            effectively a brand tile -- and against a white card a contained
            square image bleeds edge to edge and reads as the product being a
            red rectangle. A warm neutral frames it instead. (The old note here
            warned against a tint behind photos; that was `art.tint`, a
            saturated category colour, not this.) */}
        <div className="relative rounded-md aspect-[4/3] grid place-items-center text-3xl overflow-hidden"
          style={{ background: item.image_url ? '#F4EEE3' : art.tint }}>
          {item.image_url
            // COVER, not contain -- Wael's call on 2026-08-07 and the right one.
            //
            // The old note here argued for `contain` so a can shot upright
            // would not lose its lid. True in isolation, and wrong for a grid:
            // `contain` means every image is a different shape inside an
            // identical frame, so a landscape dish letterboxes, a square brand
            // tile floats, and a portrait bottle leaves bands either side. The
            // grid reads as broken even though each individual photo is intact.
            //
            // `cover` guarantees the frame is always full whatever arrives from
            // a vendor import, which is the failure this catalogue actually
            // has: 85 أرابياتا items, 85 different images, several of them
            // brand tiles rather than food. A mild crop on a 4:3 box is a much
            // smaller price than a grid that never looks finished.
            ? <img src={sized(item.image_url, IMG.photo)} alt={item.name} loading="lazy" decoding="async"
                className="w-full h-full object-cover" />
            : <CategoryArt art={art} size="xl" className="text-mist" />}
          {item.requires_prescription && (
            <span className="absolute top-1.5 right-1.5 bg-white/90 rounded-full px-2 py-0.5 text-[10px] font-bold text-seadeep">
              <Icon name="pill" size="xs" className="inline-block align-[-0.15em] me-0.5" />روشتة
            </span>
          )}
          {discountPct != null && (
            // Carried white text on gold at 2.87:1, against the palette file's own
            // rule that the decorative gold "must never carry text". coral-700 is
            // 5.75:1. And since we are here: say how much, not just that
            // there is one -- «خصم» tells the customer nothing they can weigh.
            //
            // …but only when there is a whole percent to say. originalPrice was
            // guarded with `!= null`, so a 0-priced row divided by zero and
            // rendered «خصم NaN%», and a 1 ج.م fixed discount on a 250 ج.م item
            // rounded to «خصم 0%» -- a badge advertising nothing.
            <span className="absolute top-1.5 left-1.5 bg-coral-700 text-white rounded-full px-2 py-0.5 text-[10px] font-bold">
              خصم <bdi dir="ltr">{discountPct}%</bdi>
            </span>
          )}
          {/* Removed at Wael's call, 2026-08-15: sat directly on the photo and
              read as too prominent regardless of styling (tried a plain
              overlay, then a bordered white pill). The "اختار"/"3 أحجام"-style
              option button down with the price already tells the customer a
              sheet is coming before they tap -- this was a second, louder copy
              of the same fact. */}
        </div>

        {/* No reserved min-height. It was holding two lines open on every card
            whether or not the name needed them, which on a one-line name is
            ~17px of nothing -- and `mt-auto` below then pushed the price row
            away from it, turning that into a visible gap rather than a tighter
            card. The row is still pinned, so baselines still align; there is
            just far less slack for it to absorb. */}
        <h3 className="font-semibold text-[13px] leading-tight line-clamp-2 mt-1.5"
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
      <div className="mt-auto pt-1.5 flex items-center justify-between gap-2">
        {/* flex, not two inline spans in one box.
            Inline, the struck-through original and the live price are adjacent
            European-number runs with no character between them, so the bidi
            algorithm merges them into ONE left-to-right run: «200 150 ج.م» laid
            out in logical order, which an Arabic reader scans as 150 first and
            leaves ج.م stranded past both. As flex items each price is its own
            bidi paragraph and the row lays out right-to-left in source order. */}
        <span className="flex items-baseline gap-1.5 min-w-0">
          {originalPrice != null && (
            <span className="text-mist text-[11px] line-through">{originalPrice}</span>
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
            className="h-8 px-3 rounded-full bg-sea text-white font-bold text-[12px] shrink-0 hover:bg-seadeep transition-colors disabled:opacity-40 disabled:pointer-events-none"
            disabled={disabled} onClick={onCustomize}
            aria-label={`اختيارات ${item.name}`}>
            {qty > 0 ? <>{qty}<Icon name="check" size="xs" className="inline-block align-[-0.15em] ms-1" /></> : 'اختار'}
          </button>
        ) : qty === 0 ? (
          <button
            className="w-8 h-8 rounded-full bg-sea text-white grid place-items-center shrink-0 hover:bg-seadeep transition-colors disabled:opacity-40 disabled:pointer-events-none"
            disabled={disabled} onClick={onAdd} aria-label={`إضافة ${item.name}`}>
            <Icon name="plus" size="sm" />
          </button>
        ) : (
          // 36px tall rather than 44. The whole row is a touch target 36px high
          // and the two halves are 30px wide each, which clears the 24px CSS-px
          // floor WCAG 2.2 asks for at AA and keeps two cards per row on a
          // 360px phone. The 44px version forced the price to wrap.
          <div className="h-8 rounded-full bg-sea text-white flex items-center shrink-0 px-0.5">
            <button className="w-[28px] h-7 rounded-full grid place-items-center hover:bg-white/15 transition-colors"
              onClick={onRemove} aria-label={`تقليل ${item.name}`}><Icon name="minus" size="xs" /></button>
            <span className="font-bold text-sm min-w-[1.1rem] text-center">{qty}</span>
            <button className="w-[28px] h-7 rounded-full grid place-items-center hover:bg-white/15 transition-colors"
              onClick={onAdd} aria-label={`زيادة ${item.name}`}><Icon name="plus" size="xs" /></button>
          </div>
        )}
      </div>
    </div>
  )
}
