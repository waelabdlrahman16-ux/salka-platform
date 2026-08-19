import { Link } from 'react-router-dom'
import CategoryArt from './CategoryArt'
import { artFor } from '../lib/categoryArt'
import { openLabel } from '../lib/vendorHours'
import Icon from './Icon'
import type { Restaurant } from '../lib/types'
import { sized, IMG } from '../lib/imageUrl'

// PHOTO-LED, as of 2026-08-05 -- and this reverses yesterday's decision on
// purpose, because the fact it rested on changed.
//
// On 4 August this was built as a 44px logo and a line of text, with the
// reasoning recorded in-file: 56 of 259 menu items had no photograph and five
// vendors had none at all, so a photo-led card would have rendered a flat
// colour tile for half the list. That was correct at the time.
//
// Measured again today, counting only the vendors a customer can actually
// order from: 203 of 216 items across the four OPEN restaurants carry a photo.
// أرابياتا 85/85, سينابون 13/13, هارت أتاك 41/42, ماكدونالدز 64/76 -- 94%.
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
  restaurant: r, etaMinutes, discountLabel,
}: {
  restaurant: Restaurant
  /** Prep + travel to the chosen compound, as a real range -- not prep + a
   *  single travel figure with a hardcoded +10 tacked on. Null when no
   *  compound is chosen. */
  etaMinutes: { min: number; max: number } | null
  /**
   * «خصم ٢٠٪» when the vendor's best live offer is a percentage, «عروض» when it
   * is a fixed amount off (a pound figure means nothing without knowing the
   * price it comes off). Undefined when there is no offer.
   *
   * Was a bare `hasDiscount` boolean rendering «عروض». ProductCard has said
   * «خصم N٪» since 2026-08-07, so the same fact wore two different shapes on
   * one screen -- and «عروض» on its own does not let anyone decide anything.
   */
  discountLabel?: string
}) {
  const art = artFor(r.category)
  // The COUNT is no longer printed, but it still decides whether a score is
  // printed at all. That guard is the important half: «★ 3.0» on a vendor
  // nobody has rated is a false signal, not a weak one.
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
            <Icon name="star" size="xs" className="text-coral-600" />
            <span className="font-bold text-foam">{r.rating}</span>
          </span>
          <span aria-hidden="true">·</span>
        </>
      )}
      {/* The delivery TIME is the only thing on this card that separates one
          vendor from another -- the delivery fee is per-compound, so it is the
          same number on every card in the list and putting it here would be
          noise. It was rendering in `mist`, the same weight as the category
          beside it. */}
      {etaMinutes !== null && !closed ? (
        <>
          <span className="font-semibold text-seadeep">يوصلك {etaMinutes.min}–{etaMinutes.max} د</span>
          {r.category && <><span aria-hidden="true">·</span><span className="truncate">{r.category}</span></>}
        </>
      ) : (
        <span className="truncate">{r.category}</span>
      )}
    </div>
  )

  // No photo: the original compact row, unchanged.
  if (!cover) {
    return (
      <Link
        to={`/restaurant/${r.id}`}
        aria-label={`${r.name}${closed ? '، مغلق' : ''}`}
        className={`flex gap-3 items-center py-3.5 transition-opacity ${closed ? 'opacity-60' : ''}`}
      >
        <div className="relative w-11 h-11 shrink-0 rounded-xl overflow-hidden grid place-items-center text-lg border border-line"
          style={{ background: art.tint }}>
          {r.logo_url
            ? <img src={sized(r.logo_url, IMG.icon)} alt="" loading="eager" className="w-full h-full object-cover" />
            : <CategoryArt art={art} size="lg" className="text-mist" />}
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
      aria-label={`${r.name}${closed ? '، مغلق' : ''}`}
      // The scrim over the whole photo AND 60% opacity on the card was saying
      // "closed" twice, on a vendor that since 2026-08-07 already sinks to the
      // bottom of the list on its own. Greyscale plus the reopening time beside
      // the name says it once and still lets someone see the food and decide to
      // come back at nine.
      className="block card overflow-hidden !rounded-2xl"
    >
      {/* 5:2, trimmed again on 2026-08-07 at Wael's request after seeing it
          rendered at real phone width. On a 390px screen (minus the app's 16px
          page padding) that is 143px of cover against 179px at 2:1, and 202px
          of card against 247 -- 2.5 restaurants visible before scrolling
          becomes 3.1.
          NOT shorter than this. Past 5:2 the cover stops reading as food and
          starts reading as a banner, which is the exact complaint that got the
          item grid rebuilt the same day. */}
      <div className={`relative aspect-[5/2] bg-shellup ${closed ? 'grayscale' : ''}`}>
        {/* loading="lazy" here, unlike the ad banner: that one is a single
            image above the fold and lazy actively broke it, while this is a
            list that can run to nine cards. */}
        <img src={sized(cover, IMG.wide)} alt="" loading="lazy" decoding="async"
          className="absolute inset-0 w-full h-full object-cover"
          // A broken cover must not leave a grey rectangle where the food
          // should be. Hiding the <img> reveals the tinted background, which
          // reads as a plain card rather than a failure.
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />

        {discountLabel && !closed && (
          // This badge is the one element whose whole job is to be legible at a
          // glance, in sunlight, on a coast, in August. It carried white text on
          // gold at 2.87:1, against the palette file's own rule that the
          // decorative gold "must never carry text". It is coral-700 now:
          // 5.75:1 on white, and the same warm family as the accent.
          <span className="absolute top-2 right-2 bg-coral-700 text-white text-[11px] font-bold rounded-md px-2 py-0.5 shadow-sm">
            {discountLabel}
          </span>
        )}
      </div>

      {/* Tightened from p-3 and a 36px logo. ~15px of padding that was not
          carrying any information, which is most of what the shorter cover
          would otherwise have handed straight back. */}
      <div className="flex items-center gap-2.5 px-2.5 py-2.5">
        <span className="w-8 h-8 rounded-lg overflow-hidden grid place-items-center text-base shrink-0 border border-line"
          style={{ background: art.tint }}>
          {r.logo_url
            ? <img src={sized(r.logo_url, IMG.icon)} alt="" loading="eager" className="w-full h-full object-cover" />
            : <CategoryArt art={art} size="lg" className="text-mist" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <h2 className={`font-bold text-[15px] truncate leading-tight ${closed ? 'text-mist' : ''}`}>{r.name}</h2>
            {closed && (
              <span className="shrink-0 text-[10px] font-bold text-mist bg-shellup rounded px-1.5 py-0.5">
                {status.text}
              </span>
            )}
          </div>
          <div className="mt-0.5">{meta}</div>
        </div>
      </div>
    </Link>
  )
}
