#!/usr/bin/env node
// Fail the build if any query reads a whole table without paging.
//
// WHY THIS EXISTS. On 2026-08-20 a vendor reported that سوبر كرانشي, live and
// orderable in the customer app, did not exist in the admin portal. Nothing was
// broken: menu_items had passed 1000 rows, and PostgREST caps every response at
// 1000 rows without saying so -- HTTP 200, a short array, no error, no warning.
// Admin.tsx asked for all menu items ordered by id and was handed the 1000
// oldest. Fifteen items, thirteen of them at one restaurant, were invisible to
// every member of staff while customers went on ordering them. The catalog
// screen had the same bug with a different ORDER BY, so it hid a different
// fifteen, and neither screen agreed with the other or with the app.
//
// The cost of that bug was not the truncation. It was the silence: nothing
// could have told anyone, so it took a customer noticing. Two things now break
// that silence -- a console error on any response that comes back at the
// ceiling (lib/supabase.ts), and this, which stops the class of query that
// caused it from reaching production at all.
//
// WHAT IT FLAGS. Reads with no filter and no bound -- "give me this entire
// table". Those are always wrong on a table that can grow, and the fix is
// always the same: selectAll() from lib/selectAll.ts.
//
// WHAT IT DELIBERATELY DOES NOT FLAG. Reads narrowed by .eq/.in/.gte and so on.
// Most are bounded in practice (one restaurant's menu, one order's lines) and
// listing exceptions here would rot into noise nobody reads. Those are covered
// at runtime instead, by the console error, which fires on real data rather
// than on a guess about it.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['src', 'supabase/functions']
const CODE = /\.(ts|tsx|js|mjs)$/

/** Comments break naive chain parsing: a `//` line between .eq() and .limit()
 *  makes an unbounded query look bounded and vice versa. Blank them, keeping
 *  offsets intact so reported line numbers stay true. */
function stripComments(source) {
  let out = ''
  let i = 0
  while (i < source.length) {
    const c = source[i]
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out += c
      i++
      while (i < source.length) {
        if (source[i] === '\\') { out += source[i] + (source[i + 1] ?? ''); i += 2; continue }
        out += source[i]
        if (source[i] === quote) { i++; break }
        i++
      }
      continue
    }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') { out += ' '; i++ }
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : end + 2
      out += source.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }
    out += c
    i++
  }
  return out
}

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, found)
    else if (CODE.test(entry)) found.push(path)
  }
  return found
}

const BOUNDED = /\.limit\(|\.range\(|\.single\(\)|\.maybeSingle\(\)|head:\s*true/
const FILTERED = /\.eq\(|\.in\(|\.neq\(|\.gt\(|\.gte\(|\.lt\(|\.lte\(|\.like\(|\.ilike\(|\.is\(|\.or\(|\.not\(|\.contains\(|\.filter\(|\.match\(/

const offenders = []

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const raw = readFileSync(file, 'utf8')
    const text = stripComments(raw)

    for (const match of text.matchAll(/\.from\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g)) {
      const table = match[1]
      const line = raw.slice(0, match.index).split('\n').length

      // Walk the .method(...) calls that follow, balancing parentheses so that
      // arguments containing their own parens do not end the chain early.
      let chain = ''
      let i = match.index + match[0].length
      for (;;) {
        let j = i
        while (j < text.length && /\s/.test(text[j])) j++
        if (text[j] !== '.') break
        let k = j
        let depth = 0
        let opened = false
        while (k < text.length) {
          if (text[k] === '(') { depth++; opened = true }
          else if (text[k] === ')') { depth--; if (depth === 0) { k++; break } }
          k++
        }
        if (!opened) break
        chain += text.slice(j, k).replace(/\s+/g, ' ')
        i = k
      }

      if (!chain.startsWith('.select(')) continue          // a write, not a read
      if (BOUNDED.test(chain) || FILTERED.test(chain)) continue

      offenders.push({ file, line, table })
    }
  }
}

if (offenders.length) {
  console.error('\nUNPAGED FULL-TABLE READS -- these will silently lose rows once the table passes 1000:\n')
  for (const o of offenders) console.error(`  ${o.file}:${o.line}  reads all of "${o.table}"`)
  console.error(`\nPostgREST returns at most 1000 rows and reports success either way, so the`)
  console.error(`screen looks fine and the data is wrong. Wrap each one in selectAll():\n`)
  console.error(`  const { data, error } = await selectAll((from, to) =>`)
  console.error(`    supabase.from('table').select('*').order('id').range(from, to))\n`)
  console.error(`Order by something unique -- paging an unordered query repeats and skips rows.\n`)
  process.exit(1)
}

console.log('check-unbounded-reads: no unpaged full-table reads.')
