import { Link } from 'react-router-dom'
import { artFor } from '../lib/categoryArt'
import { openLabel } from '../lib/vendorHours'
import Icon from './Icon'
import type { Restaurant } from '../lib/types'

// PHOTO-LED, as of 2026-08-05 — and this reverses yesterday's decision on
// purpose, because the fact it rested on changed.
//
// On 4 August this was built as a 44px logo and a line of text, with the
// reasoning recorded in-file: 56 of 259 menu items had no photograph and five
// vendors had none at all, so a photo-led card would have rendered a flat
// colour tile for half the list. That was correct at the time.
//
// Measured again today, counting only the vendors a customer can actually
// order from: 203 of 216 items across the four OPEN restaurants carry a photo.
// أرابياتا 85/85, سينابون 13/13, هارت أتاك 41/42, ماكدونالدز 64/76 — 94%.
// The objection is gone, so the card leads with the food.
//
// The logo did not disappear, it moved next to the name -- Wael's call, and the
// right one. The photo sells the dish; the logo is how someone recognises the
// brand while scrolling. Different jobs, and the card needs both.
//
// A vendor with no usable photo keeps the old compact row rather than showing
// an empty frame: a flat coloured rectangle where food should be looks broken
// in a way a small logo never does.

export default function RestaurantCard({
  restaurant: r, etaMinutes, hasDiscount,
}: {
  restaurant: Restaurant
  /** Prep + travel to the chosen compound. Null when no compound is chosen. */
  etaMinutes: number | null
  hasDiscount?: boolean
}) {
  const art = artFor(r.category)
  const rated = (r.review_count ?? 0) > 0
  const closed = !r.is_open
  // «مقفول دلوقتي» on its own gives the customer nothing to act on -- there is
  // no reason to come back if you do not know whether it is an hour or tomorrow.
  // openLabel prefers the server's computed next_open_at and falls back to the
  // raw columns. See lib/vendorHours.ts.
  const status = openLabel({
    is_open: r.is_open, next_open_at: r.next_open_at, closed_until: r.closed_until,
  })
  // Server-chosen: the vendor's own cover_image_url when set, otherwise the
  // best-ranked photographed item (most ordered, then priciest, then id). The
  // old rule was "lowest id", i.e. whatever was typed in first, which gave
  // أرابياتا a plain foul sandwich as its cover.
  const cover = r.hero_image_url

  const meta = (
    <div className="flex items-center gap-1.5 text-[13px] text-mist flex-wrap">
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
      {etaMinutes !== null && !closed
        ? <span>يوصلك {etaMinutes}–{etaMinutes + 10} دقيقة</span>
        : <span className="truncate">{r.category}</span>}
    </div>
  )

  // No photo: the original compact row, unchanged.
  if (!cover) {
    return (
      <Link
        to={`/restaurant/${r.id}`}
        aria-label={`${r.name}${closed ? ' — مغلق' : ''}`}
        className={`flex gap-3 items-center py-3.5 transition-opacity ${closed ? 'opacity-60' : ''}`}
      >
        <div className="relative w-11 h-11 shrink-0 rounded-xl overflow-hidden grid place-items-center text-lg border border-line"
          style={{ background: art.tint }}>
          {r.logo_url
            ? <img src={r.logo_url} alt="" loading="eager" className="w-full h-full object-cover" />
            : art.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-[15px] truncate leading-tight">{r.name}</h2>
            {closed && (
              <span className="shrink-0 text-[10px] font-bold text-mist bg-shellup rounded px-1.5 py-0.5">{status.text}</span>
            )}
          </div>
          <div className="mt-1">{meta}</div>
        </div>
      </Link>
    )
  }

  return (
    <Link
      to={`/restaurant/${r.id}`}
      aria-label={`${r.name}${closed ? ' — مغلق' : ''}`}
      className={`block card overflow-hidden !rounded-2xl transition-opacity ${closed ? 'opacity-60' : ''}`}
    >
      <div className="relative aspect-[16/9] bg-shellup">
        {/* loading="lazy" here, unlike the ad banner: that one is a single
            image above the fold and lazy actively broke it, while this is a
            list that can run to nine cards. */}
        <img src={cover} alt="" loading="lazy" decoding="async"
          className="absolute inset-0 w-full h-full object-cover"
          // A broken cover must not leave a grey rectangle where the food
          // should be. Hiding the <img> reveals the tinted background, which
          // reads as a plain card rather than a failure.
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />

        {hasDiscount && (
          <span className="absolute top-2 right-2 bg-sand text-white text-[11px] font-bold rounded-md px-2 py-0.5 shadow-sm">
            عروض
          </span>
        )}
        {closed && (
          // Over the photo, not beside the name. On a card this size a small
          // grey chip next to the title is easy to scroll past, and "closed" is
          // the one fact that changes what the customer does next.
          <span className="absolute inset-0 bg-foam/45 grid place-items-center">
            <span className="bg-shell/95 text-foam text-xs font-bold rounded-lg px-3 py-1.5">{status.text}</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2.5 p-3">
        <span className="w-9 h-9 rounded-lg overflow-hidden grid place-items-center text-base shrink-0 border border-line"
          style={{ background: art.tint }}>
          {r.logo_url
            ? <img src={r.logo_url} alt="" loading="eager" className="w-full h-full object-cover" />
            : art.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-[15px] truncate leading-tight">{r.name}</h2>
          <div className="mt-0.5">{meta}</div>
        </div>
      </div>
    </Link>
  )
}
