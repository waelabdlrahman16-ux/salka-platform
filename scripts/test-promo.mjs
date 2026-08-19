#!/usr/bin/env node
// Exercise the promo-code ladder against the real database, then roll it back.
//
// WHY THIS EXISTS. On 2026-08-19 two promo faults were found together, both in
// production, neither caught by anything:
//
//   1. A cancelled order held its redemption forever. SOKHNA30 had 6 of its
//      first 13 redemptions locked to orders that never happened, so the code
//      would have hit its 50 cap having delivered about 27.
//   2. The per-customer key was 'customer:<id>' when signed in and
//      'phone:<number>' when not, so the same human got a fresh allowance by
//      signing in between two orders. Three phones used a code twice.
//
// Both are money leaks, and both are invisible to `tsc`, to the linter and to
// the order smoke test -- an order still places perfectly while the discount it
// carries is wrong. The only thing that could have caught either is an
// assertion about what the promo functions DO with a second attempt. That is
// what this file is.
//
//   npm run test:promo        # locally, with SUPABASE_DB_URL set
//
// WHY THIS IS SAFE ON PRODUCTION. Four layers, in order of how much they carry:
//
//   1. Everything runs inside ONE transaction that is always rolled back, on
//      success and on failure. This is the load-bearing one -- see the pg_net
//      section below, which proves it rather than trusting it.
//   2. Orders are placed only against a restaurant with is_test = true, and the
//      script refuses to run if that restaurant has any vendor push token.
//   3. The promo codes it exercises are created inside the transaction with a
//      random suffix. No live code is ever read-modify-written, so no real
//      customer's allowance and no real code's remaining count is touched.
//   4. notify_order_status_change returns immediately when the order has no
//      push_token. Orders placed here never have one.
//
// THE ADMIN PUSH, AND WHY LAYER 1 IS THE ONE THAT MATTERS. notify_admin_new_order
// fires on EVERY order insert and pushes to admin devices, which are live right
// now. The order smoke test has been inserting orders on every pull request for
// days without any phone ringing, which means rollback -- not the vendor-token
// guard that script documents -- is what has been silencing it. That was an
// assumption nobody had checked. So this suite checks it: it enqueues one
// harmless request to example.com through net.http_post inside the transaction,
// and after the rollback asserts the queued row is gone. If that assertion ever
// fails, one request to example.com escaped and something far more important is
// wrong -- CI has been sending real pushes and nobody knew.
//
// Exit codes carry meaning, the same way the money and order suites' do:
//   1  a promo function is broken   -> block the merge
//   2  the script could not run     -> fix the setup; says NOTHING about promos

import pg from 'pg'
import { loadEnvLocal } from './loadEnvLocal.mjs'

loadEnvLocal()

const SETUP_FAILURE = 2
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('SUPABASE_DB_URL is not set. See scripts/smoke-place-order.mjs for the format.')
  process.exit(SETUP_FAILURE)
}
try {
  const u = new URL(url)
  if (!u.password) throw new Error('no password in the URL')
} catch (e) {
  console.error(`SUPABASE_DB_URL is not a valid connection string: ${e.message}`)
  process.exit(SETUP_FAILURE)
}

// place_order validates the Egyptian mobile prefix, so these have to be
// well-formed 010 numbers rather than obvious dummies -- 019 is rejected as
// invalid_phone before any promo logic runs. They sit in the same all-zeros
// block the order smoke test already uses. normalize_phone keeps the right-most
// ten digits, so these two differ in their key and PHONE_A's three spellings
// below all collapse onto the same one.
const PHONE_A = '01000000091'
const PHONE_B = '01000000092'
const PHONE_A_KEY = 'phone:1000000091'

const client = new pg.Client({ connectionString: url })
const rand = () => Array.from({ length: 6 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('')

let passed = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  ✓ ${name}`) }
  else { failures.push(`${name}${detail ? ` -- ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` -- ${detail}` : ''}`) }
}

/** Run a statement expecting it to raise; return the error message, or null if it did not.
 *
 *  The SAVEPOINT is not optional, for the same reason it is not optional in
 *  test-money.mjs: in Postgres a failed statement aborts the whole transaction,
 *  and most of this suite asserts that a promo function REFUSES something. */
async function expectRaise(sql, params = []) {
  await client.query('SAVEPOINT probe')
  try {
    await client.query(sql, params)
    await client.query('RELEASE SAVEPOINT probe')
    return null
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT probe')
    return e.message
  }
}

const q = async (sql, params) => (await client.query(sql, params)).rows

let started = false
let queuedRequestId = null   // set inside the transaction, checked after the rollback

try {
  await client.connect()

  // ---- preconditions -------------------------------------------------------
  // Same target and same refusal-to-guess as the order smoke test: a test
  // restaurant that cannot notify a vendor, with something orderable on it.
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
     order by r.id limit 1`)

  if (!target) {
    console.error('No test restaurant found. Run `npm run smoke:setup` first.')
    process.exit(SETUP_FAILURE)
  }
  if (Number(target.vendor_tokens) > 0) {
    console.error(`Test restaurant "${target.name}" has ${target.vendor_tokens} vendor push token(s); an order would notify a real phone.`)
    process.exit(SETUP_FAILURE)
  }
  if (!target.menu_item_id || !target.compound_id) {
    console.error(`Test restaurant "${target.name}" has no simple orderable item, or covers no compound.`)
    process.exit(SETUP_FAILURE)
  }

  // The scope tests need a restaurant and a compound that are real but are NOT
  // the target -- promo_codes has foreign keys on both, so an invented id is
  // rejected by the constraint rather than by the scope check being tested.
  const [elsewhere] = await q(`
    select (select id from restaurants where id <> $1 order by id limit 1) as restaurant_id,
           (select id from compounds where id <> $2 order by id limit 1) as compound_id`,
    [target.restaurant_id, target.compound_id])
  if (!elsewhere?.restaurant_id || !elsewhere?.compound_id) {
    console.error('Need at least one other restaurant and one other compound to test scoping.')
    process.exit(SETUP_FAILURE)
  }

  const [admin] = await q(`select id from profiles where role = 'admin' limit 1`)
  if (!admin) {
    console.error('No admin profile exists, so cancel_order can never authorise. Cannot test.')
    process.exit(SETUP_FAILURE)
  }

  console.log(`Target: "${target.name}" (restaurant ${target.restaurant_id}, test mode)`)
  console.log(`  item ${target.menu_item_id}, compound ${target.compound_id}, 0 vendor tokens\n`)

  await client.query('BEGIN')
  started = true

  // Act as the admin, so cancel_order authorises on is_admin() rather than
  // depending on which statuses happen to be customer-cancellable today. This
  // suite is about promos, not about the cancel ladder.
  await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [admin.id])

  /** Place a real order through the real entry point and return its row.
   *  p_rate_key must be 64 hex chars; a fresh one keeps the bucket empty. */
  const placeOrder = async (phone) => {
    const rateKey = Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
    const [{ result }] = await q(
      `select public.place_order(
         p_restaurant_id => $1, p_customer_name => 'CI Promo Test', p_customer_phone => $2,
         p_zone => 'CI', p_unit_number => 'CI-1',
         p_address_notes => 'automated promo test -- this transaction is rolled back',
         p_delivery_fee => 0, p_items => $3::json, p_promo_code => null, p_compound_id => $4,
         p_payment_method => 'cod', p_use_wallet => false, p_rate_key => $5) as result`,
      [target.restaurant_id, phone,
       JSON.stringify([{ menu_item_id: target.menu_item_id, qty: 1 }]),
       target.compound_id, rateKey])
    if (!result?.id) throw new Error(`place_order returned no id: ${JSON.stringify(result)}`)
    const [row] = await q(
      `select id, subtotal, delivery_fee, service_fee, total, status, customer_phone,
              push_token, public_token, promo_code_id, promo_discount, is_test
         from orders where id = $1`, [result.id])
    return row
  }

  /** A throwaway promo code, created inside the transaction. applies_to
   *  defaults to 'delivery', whose base is the delivery fee -- and these test
   *  orders carry a zero delivery fee, which would make every discount zero.
   *  'vendor' bases the discount on the subtotal, which is always positive. */
  const makePromo = async (over = {}) => {
    const spec = {
      code: `CI-PROMO-${rand()}`, active: true, discount_type: 'fixed', discount_value: 5,
      max_discount_egp: null, minimum_subtotal_egp: 0, restaurant_id: null, compound_id: null,
      starts_at: null, ends_at: null, max_redemptions: null, max_redemptions_per_customer: 1,
      applies_to: 'vendor', ...over,
    }
    const [row] = await q(
      `insert into promo_codes (code, active, discount_type, discount_value, max_discount_egp,
         minimum_subtotal_egp, restaurant_id, compound_id, starts_at, ends_at,
         max_redemptions, max_redemptions_per_customer, applies_to)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
      [spec.code, spec.active, spec.discount_type, spec.discount_value, spec.max_discount_egp,
       spec.minimum_subtotal_egp, spec.restaurant_id, spec.compound_id, spec.starts_at, spec.ends_at,
       spec.max_redemptions, spec.max_redemptions_per_customer, spec.applies_to])
    return row
  }

  const quote = async (code, over = {}) => {
    const a = { restaurant_id: target.restaurant_id, compound_id: target.compound_id,
                subtotal: 500, delivery_fee: 30, service_fee: 25, ...over }
    const [{ result }] = await q(
      `select public.quote_promo_code($1,$2,$3,$4,$5,$6) as result`,
      [code, a.restaurant_id, a.compound_id, a.subtotal, a.delivery_fee, a.service_fee])
    return result
  }

  // =========================================================================
  console.log('quote_promo_code -- what the customer is told before paying')
  // =========================================================================
  // This is the read-only half. It needs no order, so it is cheap and it covers
  // every branch a customer can hit while typing a code into checkout.

  check('rejects a code that does not exist',
    (await quote(`CI-NOPE-${rand()}`))?.reason === 'promo_invalid')

  const inactive = await makePromo({ active: false })
  check('rejects an inactive code', (await quote(inactive.code))?.reason === 'promo_invalid')

  const expired = await makePromo({ ends_at: new Date(Date.now() - 86_400_000).toISOString() })
  check('rejects an expired code', (await quote(expired.code))?.reason === 'promo_expired')

  const future = await makePromo({ starts_at: new Date(Date.now() + 86_400_000).toISOString() })
  check('rejects a code that has not started', (await quote(future.code))?.reason === 'promo_expired')

  const otherRestaurant = await makePromo({ restaurant_id: elsewhere.restaurant_id })
  check('rejects a code scoped to another restaurant',
    (await quote(otherRestaurant.code))?.reason === 'promo_not_available')

  const otherCompound = await makePromo({ compound_id: elsewhere.compound_id })
  check('rejects a code scoped to another compound',
    (await quote(otherCompound.code))?.reason === 'promo_not_available')

  const bigMinimum = await makePromo({ minimum_subtotal_egp: 1000 })
  const minQuote = await quote(bigMinimum.code, { subtotal: 100 })
  check('rejects a basket below the minimum', minQuote?.reason === 'promo_minimum_not_met')
  check('tells the customer what the minimum is', Number(minQuote?.minimum) === 1000,
    `got ${JSON.stringify(minQuote?.minimum)}`)

  const flat = await makePromo({ discount_type: 'fixed', discount_value: 40, applies_to: 'vendor' })
  const flatQuote = await quote(flat.code)
  check('accepts a valid code', flatQuote?.valid === true, JSON.stringify(flatQuote))
  check('a fixed discount is the stated amount', Number(flatQuote?.discount) === 40,
    `got ${flatQuote?.discount}`)

  check('accepts the code lowercased and padded, as a customer types it',
    (await quote(`  ${flat.code.toLowerCase()}  `))?.valid === true)

  const pct = await makePromo({ discount_type: 'percent', discount_value: 20,
                               max_discount_egp: 50, applies_to: 'vendor' })
  check('a percentage discount is capped by max_discount_egp',
    Number((await quote(pct.code, { subtotal: 1000 }))?.discount) === 50,
    'twenty percent of 1000 is 200, and the cap is 50')

  // The one that matters most, because it is the one a stale copy of this
  // function gets wrong: applies_to decides WHICH number is discounted. A
  // delivery promo worth 1000 EGP can only ever be worth the delivery fee.
  const delivery = await makePromo({ discount_type: 'fixed', discount_value: 1000, applies_to: 'delivery' })
  check('a delivery promo discounts the delivery fee, not the basket',
    Number((await quote(delivery.code, { subtotal: 500, delivery_fee: 30, service_fee: 25 }))?.discount) === 30,
    'should be the 30 EGP fee, never the 500 EGP subtotal')

  // =========================================================================
  console.log('\napply_order_promo -- what the customer is actually charged')
  // =========================================================================

  const promoA = await makePromo({ discount_type: 'fixed', discount_value: 5,
                                   applies_to: 'vendor', max_redemptions_per_customer: 1 })
  const order1 = await placeOrder(PHONE_A)
  check('the test order is stamped is_test', order1.is_test === true)
  check('the test order carries no push token, so no customer push can fire',
    order1.push_token === null, `got ${order1.push_token}`)

  const [{ discount }] = await q(
    `select private.apply_order_promo($1, $2, null, $3) as discount`, [order1.id, promoA.code, PHONE_A])
  check('applies the discount', Number(discount) === 5, `got ${discount}`)

  const [after1] = await q(
    `select promo_code_id, promo_discount, total from orders where id = $1`, [order1.id])
  check('records the code on the order', String(after1.promo_code_id) === String(promoA.id))
  check('records the discount on the order', Number(after1.promo_discount) === 5)
  check('takes the discount off the total',
    Number(after1.total) === Number(order1.total) - 5,
    `${order1.total} -> ${after1.total}`)

  const [redemption] = await q(
    `select customer_key, discount_amount, released_at from promo_redemptions where order_id = $1`, [order1.id])
  check('records one redemption', !!redemption)
  check('keys the redemption on the phone, not the customer id',
    redemption?.customer_key === PHONE_A_KEY, `got ${redemption?.customer_key}`)
  check('the redemption starts unreleased', redemption?.released_at === null)

  // THE 19 AUGUST BUG. Same human, same phone, second order -- but this time
  // signed in, so a customer id is passed. Before the fix the key changed from
  // 'phone:...' to 'customer:<id>', landed in an empty bucket, and handed out
  // the discount again.
  const order2 = await placeOrder(PHONE_A)
  const signedIn = await expectRaise(
    `select private.apply_order_promo($1, $2, 4242, $3)`, [order2.id, promoA.code, PHONE_A])
  check('signing in does not grant a second allowance',
    signedIn?.includes('promo_already_used') === true, signedIn ?? 'no error raised')

  // Same phone, three spellings. normalize_phone keeps the last ten digits, so
  // all three must collapse onto one allowance.
  for (const spelling of ['+201000000091', '00201000000091', '01000000091']) {
    const order = await placeOrder(PHONE_A)
    const err = await expectRaise(
      `select private.apply_order_promo($1, $2, null, $3)`, [order.id, promoA.code, spelling])
    check(`the same phone written as ${spelling} is the same allowance`,
      err?.includes('promo_already_used') === true, err ?? 'no error raised')
  }

  const malformed = await expectRaise(
    `select private.apply_order_promo($1, $2, null, $3)`, [order2.id, 'not a code!', PHONE_A])
  check('refuses a malformed code', malformed?.includes('invalid_promo_code') === true,
    malformed ?? 'no error raised')

  const expiredApply = await expectRaise(
    `select private.apply_order_promo($1, $2, null, $3)`, [order2.id, expired.code, PHONE_A])
  check('refuses an expired code at apply time, not only at quote time',
    expiredApply?.includes('promo_expired') === true, expiredApply ?? 'no error raised')

  const minApply = await expectRaise(
    `select private.apply_order_promo($1, $2, null, $3)`, [order2.id, bigMinimum.code, PHONE_A])
  check('refuses a basket below the minimum at apply time',
    minApply?.includes('promo_minimum_not_met') === true, minApply ?? 'no error raised')

  // =========================================================================
  console.log('\nthe global cap, and giving it back on cancellation')
  // =========================================================================
  // THE OTHER 19 AUGUST BUG. A one-redemption code, spent, then the order
  // cancelled. Before the fix the redemption was held forever and the code was
  // dead -- SOKHNA30 lost 6 of its 50 that way.

  const promoB = await makePromo({ discount_type: 'fixed', discount_value: 5,
                                   applies_to: 'vendor', max_redemptions: 1 })
  const order3 = await placeOrder(PHONE_A)
  await client.query(`select private.apply_order_promo($1, $2, null, $3)`, [order3.id, promoB.code, PHONE_A])

  const order4 = await placeOrder(PHONE_B)
  const capped = await expectRaise(
    `select private.apply_order_promo($1, $2, null, $3)`, [order4.id, promoB.code, PHONE_B])
  check('a different customer cannot exceed the global cap',
    capped?.includes('promo_limit_reached') === true, capped ?? 'no error raised')

  await client.query(`select private.cancel_order($1, 'CI promo test', null)`, [order3.id])

  const [released] = await q(
    `select released_at, discount_amount from promo_redemptions where order_id = $1`, [order3.id])
  check('cancelling the order releases the redemption', released?.released_at !== null)
  check('a released redemption keeps its amount for reporting',
    Number(released?.discount_amount) === 5, `got ${released?.discount_amount}`)

  const [{ freed }] = await q(
    `select private.apply_order_promo($1, $2, null, $3) as freed`, [order4.id, promoB.code, PHONE_B])
  check('the freed slot is usable again', Number(freed) === 5, `got ${freed}`)

  // And the per-customer allowance comes back too, on the same release.
  const promoC = await makePromo({ discount_type: 'fixed', discount_value: 5,
                                   applies_to: 'vendor', max_redemptions_per_customer: 1 })
  const order5 = await placeOrder(PHONE_A)
  await client.query(`select private.apply_order_promo($1, $2, null, $3)`, [order5.id, promoC.code, PHONE_A])
  await client.query(`select private.cancel_order($1, 'CI promo test', null)`, [order5.id])
  const order6 = await placeOrder(PHONE_A)
  const [{ again }] = await q(
    `select private.apply_order_promo($1, $2, null, $3) as again`, [order6.id, promoC.code, PHONE_A])
  check('a cancelled order gives the customer their own allowance back',
    Number(again) === 5, `got ${again}`)

  // =========================================================================
  // The safety property this whole file rests on. See the header.
  // =========================================================================
  const [{ id: qid }] = await q(
    `select net.http_post(url := 'https://example.com/salka-ci-rollback-probe') as id`)
  queuedRequestId = qid
  const [{ present }] = await q(
    `select count(*)::int as present from net.http_request_queue where id = $1`, [qid])
  check('a queued outbound request is visible inside the transaction', present === 1)

} catch (e) {
  console.error(`\nThe suite could not complete: ${e.message}`)
  failures.push(`suite aborted: ${e.message}`)
} finally {
  if (started) {
    try { await client.query('ROLLBACK'); console.log('\n(rolled back -- nothing persisted)') }
    catch { /* connection already gone; nothing was committed either way */ }
  }

  // Checked AFTER the rollback, on purpose, and this is the only assertion in
  // the file that could not live inside the transaction. If the row survived,
  // then every order this suite and the order smoke test have ever placed also
  // sent a real admin push, and CI has been notifying people for days.
  if (started && queuedRequestId !== null) {
    try {
      const { rows: [row] } = await client.query(
        `select count(*)::int as still_there from net.http_request_queue where id = $1`, [queuedRequestId])
      check('the rollback discards the queued request, so no push escapes CI',
        row.still_there === 0,
        'a queued outbound request SURVIVED the rollback -- CI has been sending real notifications')
    } catch (e) {
      failures.push(`could not verify the queued request was discarded: ${e.message}`)
    }
  }

  try { await client.end() } catch { /* nothing useful to do if closing fails */ }
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.error('\nPROMO TESTS FAILED -- do not deploy:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('PROMO TESTS PASSED -- quotes, caps, phone identity and release-on-cancel behave.')
