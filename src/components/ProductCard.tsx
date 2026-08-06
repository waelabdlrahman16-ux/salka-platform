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
  displayPrice, originalPrice, isFromPrice, optionLabel,
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
}) {
  const art = artFor(item.category)

  return (
    <div className="card p-2.5 flex flex-col h-full">
      <button className="text-right flex flex-col" onClick={onOpenDetail}>
        {/* 4:3 rather than square. Food is photographed landscape, and the
            quarter of the height this returns is what pays for the description
            below without making the card taller. */}
        {/* Concentric radii: the card is rounded-xl (12px) and the padding is
            p-2.5 (10px), so the image's radius is 12 - 10 = 2px. Matching the
            card's own 12px made the image's corners look tighter than the
            card's, because they were being cut at a smaller effective radius by
            the padding between them. */}
        <div className="relative rounded-sm aspect-[4/3] grid place-items-center text-3xl mb-2 overflow-hidden"
          style={{ background: art.tint }}>
          {item.image_url
            ? <img src={item.image_url} alt={item.name} loading="lazy" decoding="async"
                className="w-full h-full object-cover" />
            : art.emoji}
          {item.requires_prescription && (
            <span className="absolute top-1.5 right-1.5 bg-white/90 rounded-full px-2 py-0.5 text-[10px] font-bold text-seadeep">
              💊 روشتة
            </span>
          )}
          {originalPrice != null && (
            <span className="absolute top-1.5 left-1.5 bg-sand text-white rounded-full px-2 py-0.5 text-[10px] font-bold">
              خصم
            </span>
          )}
        </div>

        <h3 className="font-semibold text-sm leading-snug line-clamp-2">{item.name}</h3>

        {/* Two lines, always reserved, always clamped -- this is what keeps the
            grid even. Every item in this catalogue has a written description and
            none of them were ever shown: "هابي فاميلي 700" and "هابي كابل 450"
            differ by 250 ج.م and the cards said nothing about why, while the
            answer ("٩ قطع + بطاطس فاميلي..." vs "٦ قطع + ٢ بطاطس...") sat in the
            database on both rows. */}
        <p className="text-[11px] text-mist leading-snug mt-0.5 line-clamp-2 min-h-[2.2em]">
          {item.description || ' '}
        </p>

        <p className="mt-1.5 flex items-center gap-2 flex-wrap">
          {originalPrice != null && <span className="text-mist text-xs line-through">{originalPrice}</span>}
          <span className="text-sea font-bold">
            {/* "من" whenever the final figure is decided in the options sheet.
                Without it, an item sold only in sizes quotes a price it cannot
                be bought at -- 6 وينجز reads 190 on the column and costs 300. */}
            {isFromPrice && <span className="text-[10px] text-mist font-semibold">من </span>}
            {displayPrice} ج.م
          </span>
          {/* Beside the price, not over the photo, and identical for an options
              item and a plain one -- the same fact should not appear in two
              different places in two different shapes. */}
          {qty > 0 && (
            <span className="bg-sea/10 text-sea text-[10px] font-bold rounded-full px-2 py-0.5">
              {qty} في العربة
            </span>
          )}
        </p>
      </button>

      {/* mt-auto: whatever the name and description did above, every action in
          the row starts at the same height. */}
      <div className="mt-auto pt-2">
        {hasOptions ? (
          // Deliberately the quiet variant. "إضافة" adds immediately and
          // "اختيار" opens a sheet -- two different outcomes that were wearing
          // the same solid button, so nothing on the card said which was which.
          // The label now states the actual question, taken from the item's own
          // option group: "اختار: بيف أو تشيكن", "اختار الحجم".
          <button
            className="w-full h-10 rounded-lg bg-shellup text-foam font-bold text-sm grid place-items-center hover:bg-line transition-colors disabled:opacity-40 disabled:pointer-events-none px-2"
            disabled={disabled}
            onClick={onCustomize}>
            <span className="truncate">{optionLabel ? `اختار: ${optionLabel}` : 'اختار'}</span>
          </button>
        ) : qty === 0 ? (
          <button
            className="w-full h-10 rounded-lg bg-sea text-white font-bold text-sm grid place-items-center hover:bg-seadeep transition-colors disabled:opacity-40 disabled:pointer-events-none"
            disabled={disabled}
            onClick={onAdd}><span className="flex items-center gap-1.5"><Icon name="plus" className="w-3 h-3" /> إضافة</span></button>
        ) : (
          <div className="w-full h-10 rounded-lg bg-shellup flex items-center justify-between px-1">
            <button className="w-9 h-9 rounded-md grid place-items-center text-foam hover:bg-white transition-colors"
              onClick={onRemove} aria-label="تقليل"><Icon name="minus" className="w-3.5 h-3.5" /></button>
            <span className="font-bold text-sm">{qty}</span>
            <button className="w-9 h-9 rounded-md grid place-items-center text-white bg-sea hover:bg-seadeep transition-colors"
              onClick={onAdd} aria-label="زيادة"><Icon name="plus" className="w-3.5 h-3.5" /></button>
          </div>
        )}
      </div>
    </div>
  )
}
