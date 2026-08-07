import { artFor } from '../lib/categoryArt'
import Icon from './Icon'
import type { MenuItem } from '../lib/types'

/**
 * A menu item card.
 *
 * Rebuilt 2026-08-05 against three screenshots and the rows behind them.
 *
 * EQUAL HEIGHTS, by construction. Wael's constraint, and the reason the layout
 * is a flex column: the tile stretches to the tallest card in its row, the
 * description block reserves exactly two lines whether or not there is text,
 * and the action sits on `mt-auto` so it lands on the same baseline in every
 * card. A grid of food where the buttons zig-zag looks broken in a way no
 * single card does.
 *
 * NAME FIRST, also Wael's call and the right one. The in-cart marker used to be
 * a badge floating over the photograph, which put a piece of app state above
 * the one thing identifying the item. It is now a small chip beside the price,
 * next to the control it relates to.
 */
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

  return (
    <div className="card p-2 flex flex-col h-full">
      {/* The photo is its own clickable region rather than part of the text
          button, because the add control now sits ON it and a <button> inside a
          <button> is invalid and unreachable by keyboard. */}
      <div className="relative mb-1.5">
      <button className="text-right flex flex-col w-full" onClick={onOpenDetail} aria-label={item.name}>
        {/* 4:3 rather than square. Food is photographed landscape, and the
            quarter of the height this returns is what pays for the description
            below without making the card taller. */}
        {/* Concentric radii would give 12px card - 10px padding = 2px, which
            reads as square. 6px keeps the corners visibly soft while still
            being tighter than the card that contains them, which is the part
            that was actually wrong before. `rounded` (4px) if this is still a
            touch too round. */}
        {/* The tint is the backdrop for the EMOJI placeholder. Painting it
            behind a real photo put a coloured band around any image whose own
            background differs -- a cola can shot on pale blue sitting on a peach
            tile. A photo brings its own background; ours only competes with it. */}
        <div className="relative rounded-md aspect-[4/3] grid place-items-center text-3xl overflow-hidden"
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
        </div>
      </button>

      {/* The action lives on the photograph. Below the card it was a full-width
          solid bar on every tile, so a grid of twelve items was twelve identical
          shouts and the food -- the thing that actually sells -- competed with a
          button on every card. Up here it also buys back ~40px of height per
          card, which is another row of food on screen. */}
      <div className="absolute bottom-1.5 left-1.5">
        {hasOptions ? (
          // Same visual weight as the plain add now. It used to be the quiet
          // variant, which meant the item with sizes -- usually the pricier one
          // -- wore the button that reads as switched off.
          <button
            className="h-11 px-3.5 rounded-full bg-shell text-sea border-2 border-sea font-bold text-[11px] shadow-md hover:bg-shellup transition-colors disabled:opacity-40 disabled:pointer-events-none"
            disabled={disabled} onClick={onCustomize}>
            {optionCount && optionCount > 1 && optionLabel ? `${optionCount} ${optionLabel}` : 'اختار'}
          </button>
        ) : qty === 0 ? (
          <button
            className="w-11 h-11 rounded-full bg-sea text-white shadow-md grid place-items-center hover:bg-seadeep transition-colors disabled:opacity-40 disabled:pointer-events-none"
            disabled={disabled} onClick={onAdd} aria-label={`إضافة ${item.name}`}>
            <Icon name="plus" className="w-4 h-4" />
          </button>
        ) : (
          <div className="h-11 rounded-full bg-sea text-white shadow-md flex items-center gap-0.5 px-0.5">
            <button className="w-10 h-10 rounded-full grid place-items-center hover:bg-white/15 transition-colors"
              onClick={onRemove} aria-label={`تقليل ${item.name}`}><Icon name="minus" className="w-3.5 h-3.5" /></button>
            <span className="font-bold text-sm min-w-[1.1rem] text-center">{qty}</span>
            <button className="w-10 h-10 rounded-full grid place-items-center hover:bg-white/15 transition-colors"
              onClick={onAdd} aria-label={`زيادة ${item.name}`}><Icon name="plus" className="w-3.5 h-3.5" /></button>
          </div>
        )}
      </div>
      </div>

      <button className="text-right flex flex-col w-full" onClick={onOpenDetail}>
        {/* One line, truncated. Two lines made the cards uneven -- a long name
            pushed its price and button down while a short one left a gap -- and
            the second line was carrying nothing a customer decides on. Names
            are curated, so the fix is short names plus this guard, not a
            taller card. */}
        <h3 className="font-semibold text-sm leading-snug truncate" title={item.name}>{item.name}</h3>

        {/* Two lines, always reserved, always clamped -- this is what keeps the
            grid even. Every item in this catalogue has a written description and
            none of them were ever shown: "هابي فاميلي 700" and "هابي كابل 450"
            differ by 250 ج.م and the cards said nothing about why, while the
            answer ("٩ قطع + بطاطس فاميلي..." vs "٦ قطع + ٢ بطاطس...") sat in the
            database on both rows. */}
        <p className="text-[11px] text-mist leading-snug line-clamp-2 min-h-[2.2em]">
          {item.description || ' '}
        </p>

        <p className="mt-1 flex items-center gap-2 flex-wrap">
          {originalPrice != null && <span className="text-mist text-xs line-through">{originalPrice}</span>}
          {/* foam, not sea. Teal is the app's "do something" colour; when the
              price wore it too, the price competed with the control beside it
              and neither read as the primary thing. */}
          <span className="text-foam font-bold">
            {/* "من" whenever the final figure is decided in the options sheet.
                Without it, an item sold only in sizes quotes a price it cannot
                be bought at -- 6 وينجز reads 190 on the column and costs 300. */}
            {isFromPrice && <span className="text-[10px] text-mist font-semibold">من </span>}
            {displayPrice} ج.م
          </span>
          {/* Beside the price, not over the photo, and identical for an options
              item and a plain one -- the same fact should not appear in two
              different places in two different shapes. */}
          {/* Only for options items. A plain item's stepper already shows the
              quantity on the photo, and the same fact twice on one card is
              noise. */}
          {qty > 0 && hasOptions && (
            <span className="bg-sea/10 text-sea text-[10px] font-bold rounded-full px-2 py-0.5">
              {qty} في العربة
            </span>
          )}
        </p>
      </button>
    </div>
  )
}
