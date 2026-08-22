#!/usr/bin/env node
// Place a real order, then roll it back. Fail loudly if that stops working.
//
// WHY THIS EXISTS. On 2026-08-13 checkout, pickup and custom orders were dead
// for two hours. The change that broke them was valid TypeScript and
// valid-looking SQL: a migration patched three function bodies with a string
// replace, and because 'compound_id,' is a substring of 'p_compound_id,' the
// replacement fired twice and left a bare `kitchen_id` in each INSERT. Nothing
// caught it. `tsc` cannot see inside a Postgres function, and the only gate
// this repo had was `tsc && vite build`.
//
// The failure was invisible until a real customer submitted a real order,
// because plpgsql only plans an INSERT when it executes one. So the check has
// to go all the way through: validate, price, insert, return an order id. A
// test that stops at the validation layer -- passing deliberately bad input and
// asserting a clean rejection -- would NOT have caught 13 August, because bad
// input never reaches the INSERT.
//
//   npm run smoke:order          # locally, with SUPABASE_DB_URL set
//
// WHY THIS IS SAFE ON PRODUCTION. Three independent layers:
//
//   1. It only ever targets a restaurant with is_test = true. set_order_is_test
//      stamps is_test onto the order from the restaurant, and the platform's
//      test-mode guards keep those orders out of money and dispatch.
//   2. notify_new_order returns early when the restaurant has no vendor push
//      tokens (`if jsonb_array_length(v_tokens) = 0 then return new`). The
//      script refuses to run against a test restaurant that HAS tokens, so no
//      vendor phone can ring.
//   3. Everything happens inside a transaction that is always rolled back, even
//      on success. The order never persists.
//
// It refuses to run rather than guessing: no test restaurant, or one that could
// notify somebody, and it exits non-zero with an explanation. A smoke test that
// quietly degrades into doing nothing is worse than no smoke test, because the
// green tick then means nothing.

import pg from 'pg'
import { loadEnvLocal } from './loadEnvLocal.mjs'

loadEnvLocal()

const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('SUPABASE_DB_URL is not set.\n')
  console.error('  Put it in .env.local instead of the shell -- quoting and line wrapping have\n  bitten this three separate ways. One line, no quotes needed:\n\n      SUPABASE_DB_URL=postgresql://postgres.pqpnwxyevrsipklzmwex:PASSWORD@HOST.pooler.supabase.com:5432/postgres\n\n  Open it with:  open -e .env.local\n  It is gitignored, so the password cannot be committed.')
  process.exit(2)
}

// Exit codes carry meaning, because the two failures mean opposite things:
//
//   1  ordering is broken       -> block the merge, wake somebody up
//   2  this script cannot run   -> fix the setup; says NOTHING about ordering
//
// The first version conflated them, so a mistyped connection string printed
// "SMOKE TEST FAILED -- do not deploy". A check that cries wolf gets ignored,
// and an ignored check is worse than no check at all.
const SETUP_FAILURE = 2

// Validate the shape before dialling, so a bad string produces "your connection
// string is wrong" rather than a raw DNS error. A clipboard that had something
// else on it yields e.g. `getaddrinfo ENOTFOUND base`, which reads like an
// outage and is not one.
{
  let parsed
  try { parsed = new URL(url) } catch {
    console.error('SUPABASE_DB_URL is not a valid URL.')
    console.error(`  got: ${url.slice(0, 40)}${url.length > 40 ? '…' : ''}  (${url.length} chars)`)
    console.error('  expected: postgresql://postgres.<ref>:<password>@<host>.pooler.supabase.com:5432/postgres')
    console.error('\n  Most likely the clipboard held something else when it was copied.')
    process.exit(SETUP_FAILURE)
  }
  const problems = []
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) problems.push(`protocol is "${parsed.protocol}", expected postgresql:`)
  if (!/supabase\.(com|co)$/.test(parsed.hostname)) problems.push(`host is "${parsed.hostname}", expected a *.supabase.com address`)
  if (!parsed.password) problems.push('no password in the URL -- the [YOUR-PASSWORD] placeholder may not have been replaced')
  if (problems.length) {
    console.error('SUPABASE_DB_URL does not look like a Supabase connection string:')
    problems.forEach(p => console.error(`  - ${p}`))
    console.error(`\n  masked: ${url.replace(/:[^:@/]*@/, ':***@')}`)
    console.error('\n  Copy it fresh from Supabase → Connect → Session pooler.')
    process.exit(SETUP_FAILURE)
  }
}

const client = new pg.Client({ connectionString: url })
const q = async (sql, params) => (await client.query(sql, params)).rows

function fail(msg, detail) {
  console.error(`\n✗ ${msg}`)
  if (detail) console.error(String(detail).split('\n').map(l => '  ' + l).join('\n'))
  process.exitCode = 1
}

let started = false
try {
  await client.connect()

  // ---- the customer's own read path ---------------------------------------
  // This script connects as the owner, where RLS never applies -- so everything
  // below this line proves the SERVER can price an order, and nothing about
  // whether the CUSTOMER can see the price.
  //
  // On 2026-08-22 that gap cost a checkout outage. The service-fee cap added
  // settings.service_fee_max_egp, the client started reading it alongside
  // service_fee_percent, and settings_customer_read -- a per-key whitelist --
  // did not include it. RLS returned one row where the client needed two, and
  // lib/serviceFee.ts correctly refused to invent the missing half: checkout
  // showed "مش قادرين نحسب رسوم الخدمة دلوقتي" and could not complete. The
  // server was charging the right number the whole time. Every gate was green,
  // including this one, because every gate ran as a superuser.
  //
  // So: assert as anon, the role the browser actually uses. Add a key here when
  // the client starts reading one -- a setting the client needs and cannot read
  // is an outage, not a degradation.
  const CLIENT_READ_SETTINGS = [
    'service_fee_percent',      // lib/serviceFee.ts
    'service_fee_max_egp',      // lib/serviceFee.ts -- the ceiling
    'cod_deposit_threshold_egp',
    'sms_login_enabled',
  ]
  await client.query('begin')
  started = true
  await client.query('set local role anon')
  const visible = (await q(
    'select key from settings where key = any($1::text[])', [CLIENT_READ_SETTINGS]
  )).map(r => r.key)
  await client.query('reset role')
  const unreadable = CLIENT_READ_SETTINGS.filter(k => !visible.includes(k))
  if (unreadable.length) {
    fail(`anon cannot read ${unreadable.length} setting(s) the client needs: ${unreadable.join(', ')}.`,
      'settings_customer_read is a per-key whitelist and these keys are not on it.\n' +
      'The server will price orders correctly and the customer will see no price,\n' +
      'which stops checkout dead. Add them to the policy in a migration.')
    await client.query('rollback'); started = false
    await client.end(); process.exit()
  }
  console.log(`\u2713 anon can read all ${CLIENT_READ_SETTINGS.length} client-read settings`)
  await client.query('rollback')
  started = false

  // ---- preconditions -------------------------------------------------------
  // A test restaurant that cannot notify anyone, has an orderable item, and
  // covers at least one compound. All four conditions, or we do not proceed.
  const [target] = await q(`
    select r.id as restaurant_id, r.name,
           (select count(*) from push_tokens pt
              join profiles p on p.id = pt.profile_id
             where p.role = 'vendor' and p.restaurant_id = r.id) as vendor_tokens,
           (select m.id from menu_items m
             where m.restaurant_id = r.id and m.available
               and not coalesce(m.is_shelf_label,false)
               and not exists (select 1 from menu_item_sizes s where s.menu_item_id = m.id)
               and not exists (select 1 from menu_item_addon_groups g
                                where g.menu_item_id = m.id and g.min_select > 0)
             order by m.id limit 1) as menu_item_id,
           (select vc.compound_id from vendor_coverage vc
             where vc.restaurant_id = r.id limit 1) as compound_id
      from restaurants r
     where r.is_test and not r.archived
     order by r.id
     limit 1`)

  if (!target) {
    fail('No test restaurant found.',
      'Need a row in `restaurants` with is_test = true. Create one in the admin panel,\n' +
      'give it one simple menu item and coverage for one compound, and register no\n' +
      'vendor login against it.')
    await client.end(); process.exit()
  }
  if (Number(target.vendor_tokens) > 0) {
    fail(`Test restaurant "${target.name}" has ${target.vendor_tokens} vendor push token(s).`,
      'Placing an order against it would send a real notification. Remove the vendor\n' +
      'push registration, or use a different test restaurant.')
    await client.end(); process.exit()
  }
  if (!target.menu_item_id) {
    fail(`Test restaurant "${target.name}" has no simple orderable item.`,
      'Needs one available item with no required size and no required add-on group.')
    await client.end(); process.exit()
  }
  if (!target.compound_id) {
    fail(`Test restaurant "${target.name}" covers no compound.`,
      'Add one row to vendor_coverage for it.')
    await client.end(); process.exit()
  }

  console.log(`Target: "${target.name}" (restaurant ${target.restaurant_id}, test mode)`)
  console.log(`  item ${target.menu_item_id}, compound ${target.compound_id}, 0 vendor tokens\n`)

  // ---- the order itself ----------------------------------------------------
  await client.query('BEGIN')
  started = true

  // p_rate_key must be 64 hex chars -- place_order rejects anything else. The
  // edge function sends an HMAC of the phone; any valid-shaped key works here,
  // and a unique one per run keeps the rate-limit bucket empty.
  const rateKey = Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')

  const t0 = Date.now()
  const [row] = await q(
    `select public.place_order(
       p_restaurant_id => $1, p_customer_name => $2, p_customer_phone => $3,
       p_zone => $4, p_unit_number => $5, p_address_notes => $6, p_delivery_fee => 0,
       p_items => $7::json, p_promo_code => null, p_compound_id => $8,
       p_payment_method => 'cod', p_use_wallet => false, p_rate_key => $9
     ) as result`,
    [target.restaurant_id, 'CI Smoke Test', '01000000000', 'CI', 'CI-1',
     'automated smoke test -- this transaction is rolled back',
     JSON.stringify([{ menu_item_id: target.menu_item_id, qty: 1 }]),
     target.compound_id, rateKey])
  const ms = Date.now() - t0

  const result = row?.result
  const orderId = result?.id

  if (!orderId) {
    fail('place_order returned no order id.', JSON.stringify(result))
  } else {
    // It returned an id -- but did a row actually land, with sane money on it?
    // The 13 August break would have thrown before here; this catches the
    // quieter failure where an order is created wrong.
    const [order] = await q(
      `select id, status, total, subtotal, delivery_fee, is_test, restaurant_id
         from orders where id = $1`, [orderId])
    if (!order) {
      fail(`place_order returned id ${orderId} but no such order row exists.`)
    } else if (!order.is_test) {
      fail(`Order ${orderId} was NOT marked is_test.`,
        'set_order_is_test should have stamped it from the restaurant. Rolling back,\n' +
        'but investigate before running this again.')
    } else if (Number(order.total) <= 0) {
      fail(`Order ${orderId} has a non-positive total (${order.total}).`)
    } else {
      console.log(`✓ order ${orderId} created in ${ms} ms`)
      console.log(`  status ${order.status} · subtotal ${order.subtotal} · delivery ${order.delivery_fee} · total ${order.total} · is_test ${order.is_test}`)
    }
  }
} catch (err) {
  // Could we even reach the database? If not, this says nothing about whether
  // ordering works, and must not be reported as though it did.
  const netCodes = ['ENOTFOUND','ECONNREFUSED','ETIMEDOUT','ECONNRESET','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','SELF_SIGNED_CERT_IN_CHAIN']
  const isSetup = netCodes.includes(err.code)
    || /password authentication failed|no pg_hba|does not exist|SASL|SSL|self.signed/i.test(err.message || '')
    || err.message?.includes('Connection terminated')
  if (isSetup && !started) {
    console.error(`\n✗ Could not reach the database: ${err.message}`)
    console.error('\n  This is a SETUP problem, not a broken checkout. Ordering is UNVERIFIED,')
    console.error('  not proven broken. Check SUPABASE_DB_URL and network access, then rerun.')
    process.exitCode = SETUP_FAILURE
  } else {
    fail('place_order raised.', err.message)
  // The shape of the 13 August outage, named so nobody has to rediscover it.
    if (/column .* does not exist/i.test(err.message)) {
      console.error('\n  A column referenced by the function does not exist. This is exactly the')
      console.error('  2026-08-13 failure: a migration edited the function body and left an')
      console.error('  invalid identifier behind. Ordering is broken in production right now.')
    }
  }
} finally {
  // Always. Even on success -- especially on success.
  if (started) { try { await client.query('ROLLBACK'); console.log('\n(rolled back -- nothing persisted)') } catch { /* connection already gone; nothing was committed either way */ } }
  try { await client.end() } catch { /* nothing useful to do if closing fails */ }
}

if (process.exitCode === SETUP_FAILURE) {
  console.error('\nSMOKE TEST DID NOT RUN -- setup problem. This says nothing about ordering.')
} else if (process.exitCode) {
  console.error('\nSMOKE TEST FAILED -- ordering is broken. Do not deploy.')
} else {
  console.log('SMOKE TEST PASSED -- ordering works end to end.')
}
