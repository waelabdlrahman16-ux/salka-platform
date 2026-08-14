import { useNavigate } from 'react-router-dom'

export interface FeedAdCardData {
  id: number
  title: string
  subtitle: string | null
  image_url: string | null
  bg_color: string
  link_url: string | null
}

/**
 * One ad block dropped between restaurant cards on Home -- a second,
 * separate rotation from BannerRail's rail at the top of the page. Same
 * link-safety rules as BannerRail: an in-app path routes client-side, an
 * external URL opens in a new tab with noopener so the destination cannot
 * reach back into window.opener, and a protocol-relative `//host` is
 * rejected (it satisfies a naive `startsWith('/')` check but is a full
 * off-origin navigation).
 */
export default function FeedAdCard({ ad }: { ad: FeedAdCardData }) {
  const nav = useNavigate()
  const clickable = !!ad.link_url

  function open() {
    const href = ad.link_url
    if (!href) return
    if (/^\/(?!\/)/.test(href)) { nav(href); return }
    if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer')
  }

  const Tag = clickable ? 'button' : 'div'
  return (
    <Tag
      {...(clickable ? { onClick: open, type: 'button' as const } : {})}
      aria-label={clickable ? `${ad.title}${ad.subtitle ? ` — ${ad.subtitle}` : ''}` : undefined}
      className={`relative w-full h-[140px] rounded-2xl overflow-hidden text-right mb-3 ${clickable ? 'cursor-pointer' : ''}`}
      style={{ background: ad.bg_color }}>
      {ad.image_url && (
        <img src={ad.image_url} alt={ad.title} loading="lazy"
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          className="absolute inset-0 w-full h-full object-cover" />
      )}
      {ad.image_url && (
        <span className="absolute inset-0 bg-gradient-to-l from-black/70 via-black/25 to-transparent" />
      )}
      <span className="relative flex flex-col justify-center h-full px-4">
        <span className="text-white font-bold text-base leading-snug drop-shadow-sm">{ad.title}</span>
        {ad.subtitle && <span className="text-white/90 text-xs mt-1 drop-shadow-sm">{ad.subtitle}</span>}
      </span>
    </Tag>
  )
}
