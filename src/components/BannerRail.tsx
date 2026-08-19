import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { sized, IMG } from '../lib/imageUrl'

export interface Banner {
  id: number
  title: string | null
  subtitle: string | null
  image_url: string | null
  bg_color: string
  link_url: string | null
  sort: number
  starts_at?: string | null
  ends_at?: string | null
}

/**
 * Promotional banners across the top of the home screen.
 *
 * Renders nothing at all when there are none -- no skeleton, no empty strip, no
 * reserved space. An ad rail is the one piece of furniture that should never
 * push the actual product down the page to advertise its own absence.
 *
 * Visibility is filtered HERE as well as by RLS, and it has to be.
 *
 * The original version leaned entirely on the `banners_public_read` policy,
 * which does check `active` and the starts_at/ends_at window. That is correct
 * for a customer. It is wrong for an admin, because Postgres RLS policies are
 * PERMISSIVE and therefore OR'd together: `banners_admin_read` grants
 * `is_admin()` with no conditions at all, so a logged-in admin on the home
 * screen sees every banner in the table -- switched off, expired, not started
 * yet, all of them.
 *
 * That is the whole of the "I stopped the banner and it still shows" bug.
 * Banner #5 really was `active = false`, and RLS really was doing what it was
 * told. Wael was simply the one person on the platform allowed to see it, and
 * he is also the only person who ever checks.
 *
 * A dashboard toggle that visibly does nothing is worse than no toggle at all,
 * so the query now states the conditions itself and an admin sees what a
 * customer sees. Nothing is lost: previewing banners happens in the banners
 * tab, not on the customer home screen.
 */
export default function BannerRail({ onBanners }: { onBanners?: (has: boolean) => void }) {
  const nav = useNavigate()
  const [banners, setBanners] = useState<Banner[]>([])

  useEffect(() => {
    // The window is checked in JS, not with two chained .or() calls.
    //
    // Those serialise to two separate `or=(...)` query parameters, and while
    // PostgREST does AND repeated filters, I could not reach the REST endpoint
    // from here to prove it -- and the failure mode is silent and total: this
    // component swallows `error` and renders nothing, so a 400 means no banner
    // ever appears again and nothing says why. Not a risk worth carrying on a
    // go-live day to save filtering a handful of rows on the client.
    //
    // `active` stays server-side because that is the switch Wael actually uses
    // and it is unambiguous. Row count here is single digits.
    supabase.from('banners')
      .select('id,title,subtitle,image_url,bg_color,link_url,sort,starts_at,ends_at')
      .eq('active', true)
      .order('sort').order('id')
      .then(({ data, error }) => {
        if (error) return
        const now = Date.now()
        const visible = (data ?? []).filter(b =>
          (!b.starts_at || new Date(b.starts_at).getTime() <= now) &&
          (!b.ends_at   || new Date(b.ends_at).getTime()   >  now)
        )
        setBanners(visible)
        onBanners?.(visible.length > 0)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (banners.length === 0) return null

  // link_url is constrained at the database to an in-app path or an http(s)
  // URL, so javascript: and data: cannot be stored. This is the second gate:
  // an internal path goes through the router (no reload, history preserved),
  // an external one opens in a new tab with noopener so the destination cannot
  // reach back into window.opener.
  function open(b: Banner) {
    const href = b.link_url
    if (!href) return
    // `//evil.com` is protocol-relative, not an in-app path -- and it satisfies
    // both the old `startsWith('/')` test AND the database CHECK, whose
    // character class contains `/` and `.`. react-router's pushState throws
    // SecurityError on a cross-origin URL and its own catch falls back to
    // window.location.assign(), so this became a full off-origin navigation
    // from the home screen, with none of the noopener/noreferrer below. Require
    // a single leading slash not followed by another.
    if (/^\/(?!\/)/.test(href)) { nav(href); return }
    if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="mb-4">
      {/* snap-center, not snap-start: start-aligned in RTL rests each card
          against the right edge, so the NEXT banner peeked in on the left but
          the PREVIOUS one was already fully scrolled past -- a peek on only
          one side. Centering a card narrower than the viewport leaves a
          sliver of the neighbour on both edges at once, in either direction,
          which is what "coming next" is supposed to look like. */}
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 snap-x snap-mandatory scrollbar-none">
        {banners.map(b => {
          const clickable = !!b.link_url
          const Tag = clickable ? 'button' : 'div'
          return (
            <Tag
              key={b.id}
              {...(clickable ? { onClick: () => open(b), type: 'button' as const } : {})}
              // A banner is allowed to carry no title and no subtitle -- the
              // artwork often says everything (20260814144254_banners_optional_
              // title_required_window). When that happens this used to fall
              // through to `undefined`, leaving a tappable control a screen
              // reader announces as just "button". Lighthouse caught exactly
              // this on production, two instances, and it was the whole of the
              // accessibility drop from 96 to 93.
              aria-label={clickable
                ? [b.title, b.subtitle].filter(Boolean).join('، ') || 'إعلان. اضغط للتفاصيل'
                : undefined}
              className={`relative shrink-0 snap-center w-[96%] sm:w-[358px] h-[140px] rounded-2xl overflow-hidden
                          text-right ${clickable ? 'cursor-pointer' : ''}`}
              style={{ background: b.bg_color }}>

              {b.image_url && (
                // object-cover so any upload fills the frame at the same shape.
                // The title still renders underneath as the alt text, which is
                // what a screen reader reads and what shows if the image 404s.
                // NOT loading="lazy". This is the first thing on the home
                // screen, so there is nothing to defer -- and lazy actively
                // broke it: the rail is a horizontal snap-scroller that mounts
                // behind the place-picker modal, and Chrome's lazy heuristics
                // never fired for it. Measured on production: the <img> sat at
                // complete=false, naturalWidth=0 forever, while `new Image()`
                // on the exact same URL loaded it at 704x704 immediately. The
                // customer saw a flat colour block where the advert should be.
                // fetchpriority lowercase, spread past the typings: React 18 does
                // not know the camelCase form and warns on every home-screen
                // render, then drops the attribute -- so the hint never reached
                // the browser anyway. React 19 accepts fetchPriority; until then
                // this is the spelling that actually works.
                <img src={sized(b.image_url, IMG.wide)} alt={b.title ?? ''} loading="eager"
                  {...({ fetchpriority: 'high' } as Record<string, string>)}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  className="absolute inset-0 w-full h-full object-cover" />
              )}

              <span className="relative flex flex-col justify-center h-full px-4 py-3">
                {b.title && (
                  <span className="text-white font-bold text-base leading-snug drop-shadow-sm">{b.title}</span>
                )}
                {b.subtitle && (
                  <span className="text-white/90 text-xs mt-1 drop-shadow-sm">{b.subtitle}</span>
                )}
              </span>
            </Tag>
          )
        })}
      </div>
    </div>
  )
}
