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

const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('SUPABASE_DB_URL is not set.')
  console.error('Get it from Supabase → Connect → Session pooler, and substitute the password.')
  process.exit(1)
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
     'automated smoke test — this transaction is rolled back',
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
  fail('place_order raised.', err.message)
  // The shape of the 13 August outage, named so nobody has to rediscover it.
  if (/column .* does not exist/i.test(err.message)) {
    console.error('\n  A column referenced by the function does not exist. This is exactly the')
    console.error('  2026-08-13 failure: a migration edited the function body and left an')
    console.error('  invalid identifier behind. Ordering is broken in production right now.')
  }
} finally {
  // Always. Even on success -- especially on success.
  if (started) { try { await client.query('ROLLBACK'); console.log('\n(rolled back — nothing persisted)') } catch {} }
  try { await client.end() } catch {}
}

if (process.exitCode) {
  console.error('\nSMOKE TEST FAILED — do not deploy.')
} else {
  console.log('SMOKE TEST PASSED — ordering works end to end.')
}
