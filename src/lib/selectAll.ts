import type { PostgrestError } from '@supabase/supabase-js'

/**
 * PostgREST refuses to return more than `db-max-rows` rows in one response --
 * 1000 on this project -- and it does not say so. No error, no warning, no flag
 * on the payload: HTTP 200 and a short array that looks exactly like the whole
 * table. Every consumer then treats it as complete, because there is nothing to
 * suggest otherwise.
 *
 * That is how the admin portal came to hide menu items. menu_items passed 1000
 * rows, Admin.tsx asked for all of them ordered by id, and the fifteen newest --
 * thirteen at Chicken Plus, two at توباستو -- simply stopped existing as far as
 * staff were concerned. They were live in the customer app the whole time, being
 * ordered, while nobody could reprice them or switch them off. The catalog screen
 * had the same bug with a different ORDER BY, so it hid a different fifteen, and
 * the two screens silently disagreed with each other.
 *
 * ASKING FOR MORE DOES NOT WORK. `.range(0, 4999)` is still capped at 1000 --
 * verified against production: the response comes back `content-range: 0-999/*`.
 * The cap is a server setting, it applies to service_role too, and the only way
 * past it is to walk the table one window at a time. That is what this does.
 *
 * Use it for any read that is not bounded by a `.limit()` or by a filter that
 * provably cannot match 1000 rows. "This table is small today" is not a bound;
 * menu_items was small once too.
 */

/** PostgREST's db-max-rows for this project. Pages are exactly this wide. */
const PAGE = 1000

/**
 * 40 pages is 40,000 rows. Nothing this app puts on a screen is that big, so
 * hitting this ceiling means a runaway loop or a query that has no business
 * being unbounded -- stop rather than hammer the database forever.
 */
const MAX_PAGES = 40

type PageResult<T> = { data: T[] | null; error: PostgrestError | null }

/**
 * Read every row, a page at a time.
 *
 * Pass a function that builds the query fresh for each window -- supabase-js
 * builders are single-use, so the same one cannot be re-ranged.
 *
 *   const { data, error } = await selectAll<MenuItem>((from, to) =>
 *     supabase.from('menu_items').select('*').order('id').range(from, to))
 *
 * ALWAYS `.order()` by something stable. Paging an unordered query can repeat
 * or skip rows between windows, because Postgres is free to hand back a
 * different arrangement for each request.
 *
 * Returns supabase's own `{ data, error }` shape so it drops straight into
 * existing call sites, including inside a `withTimeout(...)` race. On the first
 * failed page it gives up and returns that error -- half a table is a worse lie
 * than an honest failure, which the screens already know how to show.
 */
export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<PageResult<T>> {
  const all: T[] = []

  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * PAGE
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) return { data: null, error }

    const rows = data ?? []
    all.push(...rows)

    // A short page is the end of the table. A full one might be, but we cannot
    // tell from here, so ask again -- the extra round trip costs a few
    // milliseconds and is the entire point of this function.
    if (rows.length < PAGE) return { data: all, error: null }
  }

  return { data: all, error: null }
}
