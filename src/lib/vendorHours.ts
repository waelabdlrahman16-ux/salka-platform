// Display helpers for vendor opening hours.
//
// The AUTHORITY is the database. vendor_is_open_now() decides whether an order
// is accepted, and restaurants_for_compound / restaurant_public /
// vendor_open_states all return a computed `is_open` and `next_open_at`.
// Nothing here is trusted for an ordering decision -- this file turns those
// values into Arabic, and gives the admin editor a local preview.
//
// dayWindowCovers() mirrors day_window_covers() in the database exactly and is
// covered by the same test cases. If one changes, change both.

/** 0 = Sunday .. 6 = Saturday, matching Postgres extract(dow). */
export type DayHours = {
  day_of_week: number
  opens_at: string | null   // 'HH:MM:SS', Cairo
  closes_at: string | null
  closed: boolean
}

export type OpenState = {
  is_open?: boolean
  next_open_at?: string | null
  closed_until?: string | null
}

/** Saturday first, the way an Egyptian week reads. */
export const WEEK: { dow: number; label: string }[] = [
  { dow: 6, label: 'السبت' },
  { dow: 0, label: 'الأحد' },
  { dow: 1, label: 'الاثنين' },
  { dow: 2, label: 'الثلاثاء' },
  { dow: 3, label: 'الأربعاء' },
  { dow: 4, label: 'الخميس' },
  { dow: 5, label: 'الجمعة' },
]

export function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/**
 * Mirrors day_window_covers() in the database.
 *
 * `isPrevDay` asks a different question of the same row: not "does this window
 * contain now", but "does this window's overnight TAIL contain now". A window
 * that crosses midnight belongs to the day it STARTED on -- Thursday 10:00→03:00
 * is why 01:00 on Friday is open. Without that distinction every late-night
 * vendor shuts at midnight, which in Sokhna is most of them, and it reads like a
 * timezone bug rather than a modelling one.
 */
export function dayWindowCovers(
  nowMin: number, opensMin: number | null, closesMin: number | null, isPrevDay: boolean,
): boolean {
  if (opensMin === null || closesMin === null) return false
  if (isPrevDay) return closesMin < opensMin && nowMin < closesMin
  if (opensMin === closesMin) return true                       // 24 hours
  if (opensMin < closesMin) return nowMin >= opensMin && nowMin < closesMin
  return nowMin >= opensMin                                     // overnight, today's head
}

function cairoParts(now: Date): { dow: number; minutes: number } {
  const hhmm = now.toLocaleTimeString('en-GB', {
    timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  // 'sv-SE' gives an ISO-ish date we can parse back for the weekday.
  const day = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })
  const [y, m, d] = day.split('-').map(Number)
  return { dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay(), minutes: toMinutes(hhmm) }
}

/** Local preview for the admin editor. The server still decides. */
export function isOpenNow(hours: DayHours[], closedUntil?: string | null, now: Date = new Date()): boolean {
  if (closedUntil && new Date(closedUntil).getTime() > now.getTime()) return false
  // No hours configured is OPEN, matching the database. This is what stops the
  // feature darkening every vendor before anyone has set a single time.
  if (!hours.length) return true

  const { dow, minutes } = cairoParts(now)
  const today = hours.find(h => h.day_of_week === dow)
  if (today && !today.closed &&
      dayWindowCovers(minutes, min(today.opens_at), min(today.closes_at), false)) return true

  const prev = hours.find(h => h.day_of_week === (dow + 6) % 7)
  if (prev && !prev.closed &&
      dayWindowCovers(minutes, min(prev.opens_at), min(prev.closes_at), true)) return true

  return false
}

const min = (t: string | null) => (t ? toMinutes(t) : null)

/** «١٠:٠٠ ص» */
export function formatTime(t: string | null | undefined): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString('ar-EG', {
    timeZone: 'UTC', hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

/**
 * The line under a vendor's name.
 *
 * «مغلق» alone tells a customer nothing and costs the visit -- there is no
 * reason to come back if you do not know whether it is an hour or tomorrow.
 */
export function openLabel(v: OpenState, now: Date = new Date()): { open: boolean; text: string } {
  const open = v.is_open !== false
  if (open) return { open: true, text: 'مفتوح' }

  const temporarily = !!(v.closed_until && new Date(v.closed_until).getTime() > now.getTime())
  const next = v.next_open_at ? new Date(v.next_open_at) : null
  if (!next) return { open: false, text: temporarily ? 'مقفول مؤقتاً' : 'مقفول' }

  const dayOf = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })
  const atParts = next.toLocaleTimeString('en-US', {
    timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit', hour12: true,
  })
  const at = atParts.replace(/^(.*)\s(AM|PM)$/, '$2 $1')

  const tomorrow = new Date(now.getTime() + 86400000)
  const when =
    dayOf(next) === dayOf(now)      ? ''
    : dayOf(next) === dayOf(tomorrow) ? 'بكرة '
    : `${next.toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'long' })} `

  return { open: false, text: `${temporarily ? 'مقفول مؤقتاً' : 'مقفول'} • بيفتح ${when}${at}` }
}
