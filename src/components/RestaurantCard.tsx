import { Link } from 'react-router-dom'
import { artFor } from '../lib/categoryArt'
import Icon from './Icon'
import type { Restaurant } from '../lib/types'

// Rebuilt 2026-08-05 against a reference Wael supplied, with one deliberate
// departure he asked for: the logo stays at 44px. The reference leads with a
// large food photograph and shrinks the logo to a corner badge — beautiful, and
// wrong for this catalogue. 56 of 259 items have no photo and five vendors have
// none at all, so a photo-led card would have rendered a flat colour tile for
// half the list, right next to McDonald's 76 photographed items. A small logo
// is honest about what we have.
//
// One meta line:   ★ 4.7 (12) · 20–30 دقيقة · 65 ج.م توصيل
// then at most two small badges.
//
// Deliberately gone:
//   - the category ("فاست فود") — the filter chips above already say it
//   - the description — a longer, worse second version of the name
//   - "جديد" and "يفتح بعدين" — an unrated vendor simply shows no score, and a
//     closed one is unmistakably closed already.
//
// The delivery fee moved ONTO this card because it came OFF the home screen.
// It has to be visible before the cart: the reason the old strip existed was a
// customer meeting a 350 ج.م fee for the first time at checkout.

export default function RestaurantCard({
  restaurant: r, etaMinutes, deliveryFee, hasDiscount,
}: {
  restaurant: Restaurant
  /** Prep + travel to the chosen compound. Null when no compound is chosen. */
  etaMinutes: number | null
  /** The compound's fee. Null while unknown — render nothing rather than a guess. */
  deliveryFee: number | null
  hasDiscount?: boolean
}) {
  const art = artFor(r.category)
  const rated = (r.review_count ?? 0) > 0
  const closed = !r.is_open
  const freeDelivery = deliveryFee === 0

  return (
    <Link
      to={`/restaurant/${r.id}`}
      aria-label={`${r.name}${closed ? ' — مغلق' : ''}`}
      className={`flex gap-3 items-center py-3.5 transition-opacity ${closed ? 'opacity-55' : ''}`}
    >
      <div className="relative w-11 h-11 shrink-0 rounded-xl overflow-hidden grid place-items-center text-lg border border-line"
        style={{ background: art.tint }}>
        {r.logo_url
          ? <img src={r.logo_url} alt="" loading="eager" className="w-full h-full object-cover" />
          : art.emoji}
        {closed && <span className="absolute inset-0 bg-foam/55" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="font-bold text-[15px] truncate leading-tight">{r.name}</h2>
          {closed && (
            <span className="shrink-0 text-[10px] font-bold text-mist bg-shellup rounded px-1.5 py-0.5">
              مغلق
            </span>
          )}
        </div>

        {/* One line, dot-separated, in the reference's order. */}
        <div className="flex items-center gap-1.5 mt-1 text-[13px] text-mist flex-wrap">
          {rated && (
            <>
              <span className="flex items-center gap-1">
                <Icon name="star" className="w-3.5 h-3.5 text-sand" />
                <span className="font-bold text-foam">{r.rating}</span>
                <span>({r.review_count})</span>
              </span>
              <span aria-hidden="true">·</span>
            </>
          )}

          {etaMinutes !== null && !closed && (
            <>
              {/* A range, not a single number. A single number is a promise;
                  a range is an estimate, which is what this actually is. */}
              <span>{etaMinutes}–{etaMinutes + 10} دقيقة</span>
              {deliveryFee !== null && <span aria-hidden="true">·</span>}
            </>
          )}

          {deliveryFee !== null && (
            freeDelivery
              ? <span className="line-through">التوصيل</span>
              : <span>{deliveryFee} ج.م توصيل</span>
          )}
        </div>

        {(hasDiscount || freeDelivery) && (
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {hasDiscount && (
              <span className="bg-sand/20 text-sandink text-[11px] font-bold rounded-md px-2 py-0.5">
                عروض وخصومات
              </span>
            )}
            {freeDelivery && (
              <span className="bg-sea/10 text-sea text-[11px] font-bold rounded-md px-2 py-0.5">
                توصيل مجاني
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  )
}
