import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export interface Banner {
  id: number
  title: string
  subtitle: string | null
  image_url: string | null
  bg_color: string
  link_url: string | null
  sort: number
}

/**
 * Promotional banners across the top of the home screen.
 *
 * Renders nothing at all when there are none — no skeleton, no empty strip, no
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
export default function BannerRail() {
  const nav = useNavigate()
  const [banners, setBanners] = useState<Banner[]>([])

  useEffect(() => {
    const now = new Date().toISOString()
    supabase.from('banners')
      .select('id,title,subtitle,image_url,bg_color,link_url,sort')
      .eq('active', true)
      .or(`starts_at.is.null,starts_at.lte.${now}`)
      .or(`ends_at.is.null,ends_at.gt.${now}`)
      .order('sort').order('id')
      .then(({ data, error }) => { if (!error) setBanners(data ?? []) })
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
    if (href.startsWith('/')) { nav(href); return }
    if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="mb-4">
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 snap-x snap-mandatory scrollbar-none">
        {banners.map(b => {
          const clickable = !!b.link_url
          const Tag = clickable ? 'button' : 'div'
          return (
            <Tag
              key={b.id}
              {...(clickable ? { onClick: () => open(b), type: 'button' as const } : {})}
              aria-label={clickable ? `${b.title}${b.subtitle ? ` — ${b.subtitle}` : ''}` : undefined}
              className={`relative shrink-0 snap-start w-[86%] sm:w-[420px] h-[124px] rounded-2xl overflow-hidden
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
                <img src={b.image_url} alt={b.title} loading="eager" fetchPriority="high"
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  className="absolute inset-0 w-full h-full object-cover" />
              )}

              {/* Only drawn over an image, and only on the text side. Without it
                  white copy over a light photo is unreadable, which is exactly
                  the sort of thing nobody checks before uploading artwork. */}
              {b.image_url && (
                <span className="absolute inset-0 bg-gradient-to-l from-black/70 via-black/25 to-transparent" />
              )}

              <span className="relative flex flex-col justify-center h-full px-4 py-3">
                <span className="text-white font-bold text-base leading-snug drop-shadow-sm">{b.title}</span>
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
