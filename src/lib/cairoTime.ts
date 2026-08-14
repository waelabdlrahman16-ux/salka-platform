// All calendar-day and datetime-local math for the app happens in Cairo time,
// not the browser's or server's own timezone. Two failure modes this file
// exists to kill:
//
//  1. "Today" derived from the browser's or server's raw UTC clock mislabels
//     anything placed between 00:00-02:00 Cairo as yesterday (or the reverse),
//     because Cairo is ahead of UTC. cairoToday()/cairoDayKey() fix this.
//  2. A <input type="datetime-local"> has no timezone of its own -- it is just
//     six numbers. Slicing a UTC ISO string straight into one (or saving its
//     value straight back as if it were UTC) silently shifts every banner,
//     discount and promo-code schedule by Cairo's offset from UTC.
//     isoToCairoLocalInput()/cairoLocalInputToISO() fix this.

const CAIRO_TZ = 'Africa/Cairo'

/** Which CAIRO day a timestamp belongs to, as YYYY-MM-DD. */
export const cairoDayKey = (iso: string | Date) =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: CAIRO_TZ })

/** Today's Cairo calendar day, as YYYY-MM-DD. */
export const cairoToday = (): string => cairoDayKey(new Date())

/**
 * Move a YYYY-MM-DD key by whole days, in date space rather than by adding
 * 86400000ms. Egypt observes DST, so a 24-hour subtraction lands on the same
 * calendar day twice a year -- which would make "yesterday" show today's
 * orders on exactly the day someone is most likely to be reconciling them.
 */
export function shiftDayKey(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + delta)
  return dt.toISOString().slice(0, 10)
}

function cairoParts(utcMs: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(utcMs))
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00'
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') }
}

/**
 * Format a timestamptz/ISO string for a <input type="datetime-local"> field
 * as the wall-clock time it represents IN CAIRO. A banner stored as 12:00Z is
 * 14:00 in Cairo (winter) or 15:00 (Cairo DST) -- the input must show that,
 * not a naive slice of the UTC string, or an admin editing it will resave
 * whatever they see and silently shift the schedule further.
 */
export function isoToCairoLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const { y, m, d, hh, mm } = cairoParts(new Date(iso).getTime())
  return `${y}-${m}-${d}T${hh}:${mm}`
}

/**
 * Read a <input type="datetime-local"> value back as the UTC ISO instant it
 * represents IN CAIRO. The input's value has no timezone of its own -- "the
 * admin typed 14:00" only means something once we say that is 14:00 Cairo,
 * not 14:00 in whatever timezone the browser happens to be in.
 *
 * Method: treat the typed numbers as a UTC guess, see what that guess renders
 * as in Cairo, and correct by the difference. Cairo's offset is always whole
 * hours, so one correction is exact everywhere except inside a DST-transition
 * gap/overlap itself -- an edge case no admin is scheduling a banner into.
 */
export function cairoLocalInputToISO(value: string): string | null {
  if (!value) return null
  const [datePart, timePart] = value.split('T')
  if (!datePart || !timePart) return null
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  const rendered = cairoParts(guess)
  const renderedMs = Date.UTC(
    Number(rendered.y), Number(rendered.m) - 1, Number(rendered.d), Number(rendered.hh), Number(rendered.mm)
  )
  return new Date(guess + (guess - renderedMs)).toISOString()
}
