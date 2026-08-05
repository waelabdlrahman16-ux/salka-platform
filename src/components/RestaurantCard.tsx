import { Link } from 'react-router-dom'
import { artFor } from '../lib/categoryArt'
import Icon from './Icon'
import type { Restaurant } from '../lib/types'

// This was 28 lines of inline JSX inside Home's map, and a second, different
// vendor card existed in Offers.tsx with none of the same information. One
// component now, so the two lists cannot drift again.
//
// Three things it deliberately does differently from what it replaces:
//
// 1. It does not print a rating for a vendor nobody has rated. `restaurants.rating`
//    defaults to 5.0, so every new vendor claimed a perfect score and outranked
//    a real 4.7. `review_count` comes from restaurants_for_compound(); when it is
//    zero the card says جديد rather than inventing a number.
// 2. The visual is the category tile, not a 44px logo or a letter in a box.
//    74 of 189 items have no photograph and five vendors have none at all, so a
//    letter tile is what most of this list actually rendered.
// 3. A closed vendor is visibly closed — dimmed, with its "opens later" line in
//    place of the ETA — instead of looking identical to an open one except for a
//    small badge.

export default function RestaurantCard({
  restaurant: r, etaMinutes, hasDiscount,
}: {
  restaurant: Restaurant
  /** Prep time + travel time to the chosen compound. Null when no compound yet. */
  etaMinutes: number | null
  hasDiscount?: boolean
}) {
  const art = artFor(r.category)
  const rated = (r.review_count ?? 0) > 0
  const closed = !r.is_open

  return (
    <Link
      to={`/restaurant/${r.id}`}
      aria-label={`${r.name}${closed ? ' — مغلق' : ''}`}
      className={`card p-3 flex gap-3 items-stretch transition-colors hover:border-sea/50 ${
        closed ? 'opacity-60' : ''}`}
    >
      <div
        className="w-20 h-20 shrink-0 rounded-xl overflow-hidden grid place-items-center text-3xl relative"
        style={{ background: art.tint }}
      >
        {r.logo_url
          ? <img src={r.logo_url} alt="" className="w-full h-full object-cover" />
          : art.emoji}
        {closed && (
          <span className="absolute inset-0 bg-foam/55 grid place-items-center text-[11px] font-bold text-white">
            مغلق
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1 flex flex-col justify-center">
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-bold truncate">{r.name}</h2>
          {hasDiscount && (
            <span className="shrink-0 bg-sand/15 text-sandink text-[11px] font-bold rounded-full px-2 py-0.5">
              🏷️ عروض
            </span>
          )}
        </div>

        <p className="text-xs text-mist truncate mt-0.5">{r.category}</p>

        {r.description && (
          <p className="text-xs text-mist mt-1 truncate leading-relaxed">{r.description}</p>
        )}

        <div className="flex items-center gap-3 mt-1.5 text-xs text-mist flex-wrap">
          {rated ? (
            <span className="flex items-center gap-1">
              <Icon name="star" className="w-3.5 h-3.5 text-sand" />
              <span className="font-semibold text-foam">{r.rating}</span>
              <span>({r.review_count})</span>
            </span>
          ) : (
            <span className="text-mist">جديد</span>
          )}

          {closed ? (
            <span>يفتح بعدين</span>
          ) : r.order_mode === 'pickup_request' ? (
            <span>🛵 اطلب مندوب توصيل</span>
          ) : etaMinutes !== null ? (
            <span className="flex items-center gap-1">
              <Icon name="clock" className="w-3.5 h-3.5" />
              {etaMinutes} دقيقة
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  )
}
