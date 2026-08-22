#!/usr/bin/env node
// Assert the things about PRODUCTION that a build cannot see, and that a
// pre-merge check cannot protect once the merge itself changes the database.
//
//   npm run check:production        # with SUPABASE_DB_URL set
//
// WHY THIS EXISTS. On 2026-08-22, 04:06 -> 06:22 UTC, customers could not check
// out. The app could not read service_fee_max_egp, so it could not compute the
// service fee, so the price never rendered and the order could not be
// submitted.
//
// Nothing was deployed to break it. Merging a migration pull request made the
// Supabase GitHub integration apply every migration file that had no row in
// supabase_migrations.schema_migrations. Seven such files had been sitting in
// the repository unapplied for days. One of them recreates the customer
// settings policy with the THREE keys that predate the service fee cap, so it
// silently replaced the four-key policy from hours earlier. It also reverted
// admin_force_delivered, the duplicate-credit guard on credit_wallet, and a
// grant revocation on account recovery.
//
// The smoke test ALREADY asserts the settings keys and would have caught it. It
// runs on pull requests -- before the merge that does the damage. That is the
// gap this closes: these assertions have to run AFTER main moves, against the
// database as it actually ended up.
//
// Exit codes, so a failure says what it means:
//   0  production matches expectations
//   1  an invariant is broken -- production is wrong, act now
//   2  the check could not run -- bad secret, no network. Also a failure, but
//      a different one: an unverified deploy must not read as a healthy one.

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'
import { loadEnvLocal } from './loadEnvLocal.mjs'

loadEnvLocal()

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(HERE, '..', 'supabase', 'migrations')

// Every key src/lib/serviceFee.ts and the checkout path read as an anonymous
// visitor. The server prices correctly without them; the CUSTOMER sees nothing.
const CLIENT_READ_SETTINGS = [
  'service_fee_percent',
  'service_fee_max_egp',
  'cod_deposit_threshold_egp',
  'sms_login_enabled',
]

// Markers, not full definitions. Each one is a behaviour that a stale migration
// replay has already silently removed once, chosen so the assertion fails only
// when the behaviour is genuinely gone.
const FUNCTION_MARKERS = [
  ['private', 'service_fee_for', '%least%',
   'the service fee cap -- without it there is no ceiling on the fee'],
  ['private', 'admin_force_delivered', '%quote.superseded%',
   'closing a هنجبلك order whose quote was never accepted'],
  ['private', 'credit_wallet', '%duplicate_credit%',
   'the duplicate-credit guard -- without it, tapping credit twice pays twice'],
  ['private', 'confirm_custom_order_price', '%use_quote_flow%',
   'the retired pricing path that bricked order #1187'],
]

const failures = []
function fail(what, why) { failures.push({ what, why }) }

let client
try {
  const url = process.env.SUPABASE_DB_URL
  if (!url) {
    console.error('SUPABASE_DB_URL is not set -- cannot verify production.')
    process.exit(2)
  }
  client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
} catch (err) {
  console.error(`Could not connect: ${err.message}`)
  process.exit(2)
}

const q = async (sql, params) => (await client.query(sql, params)).rows

try {
  // 1. No migration file may be missing from the ledger.
  //
  // This is the root cause, not a symptom. A committed-but-unapplied file is a
  // landmine: it carries an old truth and detonates whenever anything decides
  // to catch the ledger up -- which, with the Supabase Git integration
  // connected, is the next merge that touches migrations.
  const onDisk = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .map(f => f.split('_')[0])
  const inLedger = new Set(
    (await q('select version from supabase_migrations.schema_migrations')).map(r => r.version))
  const unapplied = onDisk.filter(v => !inLedger.has(v)).sort()
  if (unapplied.length) {
    fail(`${unapplied.length} migration file(s) are not in the ledger: ${unapplied.join(', ')}`,
      'Each one will be applied, in full, the next time anything syncs migrations --\n' +
      'carrying whatever the schema looked like when it was written. Apply them\n' +
      'deliberately, or delete them, but do not leave them armed.')
  } else {
    console.log(`✓ all ${onDisk.length} migration files are in the ledger`)
  }

  // 1b. A migration FILE must contain what its ledger row actually executed.
  //
  // Check 1 asks only whether a version is PRESENT. It cannot see a file whose
  // contents are not what ran -- and that is the failure mode behind every
  // schema object that has ever turned out to live only in production. The
  // quote system and the admin customer screens both got there that way: applied
  // to the database, never truly captured in a file.
  //
  // TEXT COMPARISON IS THE WRONG TOOL. The ledger holds statements, not the
  // authored file: a leading comment block is not a statement and never reaches
  // it, and a deploy through a different tool can reflow whitespace. What has to
  // match is the set of objects each side CREATES. Both sides are scanned with
  // the same pattern, so when a file and its ledger row agree, the two sets are
  // identical -- verified across all 102 non-marker files at the time of writing.
  //
  // HISTORICAL MARKERS ARE NOT DRIFT. 202 of the files here are deliberate
  // placeholders for versions applied before the repository tracked migrations;
  // the schema of that era is captured in supabase/baseline instead. They say so
  // in their first line, and they are skipped. Without that exemption this check
  // is 202 false alarms and gets ignored, which is worse than not having it.
  //
  // One direction only: a ledger row creating something its file does not is
  // always wrong. The reverse is not necessarily -- a statement can be edited
  // out of a file after failing -- so it is not asserted here.
  const CREATES = /create\s+(?:or\s+replace\s+)?(?:function|trigger)\s+([a-zA-Z0-9_."]+)/gi
  const objectsIn = text => new Set(
    [...text.matchAll(CREATES)].map(m => m[1].toLowerCase().replace(/"/g, '')))

  const fileFor = new Map(
    readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .map(f => [f.split('_')[0], f]))

  const ledgerRows = await q(
    'select version, statements from supabase_migrations.schema_migrations')
  const contentDrift = []
  let compared = 0
  for (const { version, statements } of ledgerRows) {
    const file = fileFor.get(version)
    if (!file || !statements) continue          // check 1 owns the missing-file case
    const authoredText = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    if (authoredText.includes('Historical migration marker')) continue
    const executed = objectsIn(statements.join('\n'))
    if (!executed.size) continue
    compared++
    const missing = [...executed].filter(o => !objectsIn(authoredText).has(o))
    if (missing.length) contentDrift.push({ file, missing })
  }

  if (contentDrift.length) {
    fail(`${contentDrift.length} migration file(s) do not contain what they executed:\n` +
      contentDrift.map(d => `      ${d.file} is missing ${d.missing.join(', ')}`).join('\n'),
      'The ledger recorded these objects being created by that version; the file of\n' +
      'that version does not create them, so the definition exists only in\n' +
      'production. Reconstruct the file from the ledger row -- see\n' +
      'docs/MIGRATION-LEDGER-RECONSTRUCTION-2026-08-22.md. Do NOT write a new\n' +
      'migration: the version is already applied and will never be replayed.')
  } else {
    console.log(`\u2713 all ${compared} migration files match what their version executed`)
  }

  // 2. An anonymous visitor can read every setting checkout needs.
  await client.query('begin')
  await client.query('set local role anon')
  const visible = (await q(
    'select key from settings where key = any($1::text[])', [CLIENT_READ_SETTINGS])).map(r => r.key)
  await client.query('rollback')
  const unreadable = CLIENT_READ_SETTINGS.filter(k => !visible.includes(k))
  if (unreadable.length) {
    fail(`anon cannot read ${unreadable.length} setting(s) checkout needs: ${unreadable.join(', ')}`,
      'settings_customer_read is a per-key whitelist and these keys are not on it.\n' +
      'The server prices the order correctly and the customer sees no price at all,\n' +
      'which stops checkout dead. This is the 22 August outage.')
  } else {
    console.log(`✓ anon can read all ${CLIENT_READ_SETTINGS.length} checkout settings`)
  }

  // 3. Behaviours that a stale replay has removed before.
  for (const [schema, fn, marker, what] of FUNCTION_MARKERS) {
    const [row] = await q(
      `select pg_get_functiondef(p.oid) ilike $3 as ok
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = $1 and p.proname = $2`, [schema, fn, marker])
    if (!row) fail(`${schema}.${fn} does not exist`, `It carries ${what}.`)
    else if (!row.ok) fail(`${schema}.${fn} has lost ${what}`,
      'An older definition of this function is live. Something replayed a stale\n' +
      'migration over it -- check supabase_migrations.schema_migrations for the\n' +
      'newest migration that defines it, and re-apply that one.')
  }
  if (!failures.length) console.log(`✓ all ${FUNCTION_MARKERS.length} function invariants hold`)
} catch (err) {
  console.error(`Check could not complete: ${err.message}`)
  try { await client.end() } catch { /* already gone */ }
  process.exit(2)
}

await client.end()

if (failures.length) {
  console.error(`\n${failures.length} production invariant(s) BROKEN:\n`)
  for (const f of failures) console.error(`  ✗ ${f.what}\n    ${f.why.replace(/\n/g, '\n    ')}\n`)
  process.exit(1)
}
console.log('\nProduction invariants hold.')
