#!/usr/bin/env node
// Exercise driver assignment against the real database, then roll it back.
//
// WHY THIS EXISTS. Dispatch is the last untested load-bearing path. The money
// functions are covered, the promo ladder is covered, and one real order is
// placed on every pull request -- but nothing asserts that an order can only be
// held by one driver at a time, that a driver cannot exceed four deliveries,
// that unassigning frees him again, or that the test and live driver pools stay
// apart. Every one of those is a rule enforced ONLY inside a Postgres function
// body, which is exactly where `tsc` cannot look and where the 13 August outage
// lived.
//
// The pool rule deserves naming. admin_assign_order refuses when the order's
// is_test does not match the driver's, and NOT EVEN p_force overrides it: a
// real driver sent to a test address is a wasted trip, and a test delivery on a
// real driver is how phantom cash lands on his account. That guard is one line
// and nothing else checks it.
//
//   npm run test:dispatch        # locally, with SUPABASE_DB_URL set
//
// WHY THIS IS SAFE ON PRODUCTION. Same four layers as the promo suite, plus one
// this suite needs specifically:
//
//   1. Everything runs inside ONE transaction that is always rolled back. This
//      is the load-bearing layer -- test-promo.mjs proves it rather than
//      trusting it, by showing a pg_net request queued inside a transaction
//      does not survive the rollback.
//   2. Orders are placed only against a restaurant with is_test = true, and the
//      script refuses to run if that restaurant has any vendor push token.
//   3. Only the TEST driver is ever touched, and the script refuses to run if
//      his profile holds any push token -- delivery_assignments carries a
//      notify trigger, so a test driver with a live phone would be a real
//      notification.
//   4. The pool guard is itself one of the assertions, so a regression that
//      let live and test mix would fail this suite rather than escape through
//      it.
//
// UNLIKE the other two suites, this one READ-MODIFY-WRITES AN EXISTING ROW: it
// flips the test driver's active, available and status flags. test-money.mjs
// already does the same with one order. It is the test driver, and it rolls
// back -- but it is worth knowing that this file is not purely additive.
//
// Exit codes carry meaning, the same way the money, promo and order suites' do:
//   1  a dispatch rule is broken    -> block the merge
//   2  the script could not run     -> fix the setup; says NOTHING about dispatch

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

// place_order validates the Egyptian mobile prefix, so this has to be a
// well-formed 010 number. Same all-zeros block the other suites use.
const PHONE = '01000000093'

const client = new pg.Client({ connectionString: url })

let passed = 0
const failures = []
const skipped = []

function check(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  ✓ ${name}`) }
  else { failures.push(`${name}${detail ? ` -- ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` -- ${detail}` : ''}`) }
}

/** Announce anything this run could NOT cover, and why. A suite that quietly
 *  skips is worse than one that fails: the green tick stops meaning anything. */
function skip(name, why) {
  skipped.push(`${name} -- ${why}`)
  console.log(`  ~ ${name} (skipped: ${why})`)
}

/** SAVEPOINT is not optional -- see the same helper in test-money.mjs. Most of
 *  this suite asserts that a dispatch function REFUSES something, and in
 *  Postgres one failed statement poisons the transaction without it. */
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

try {
  await client.connect()

  // ---- preconditions -------------------------------------------------------
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

  // The test driver, and the profile that signs in as him. delivery_assignments
  // carries notify_driver_assignment_change, so a test driver holding a live
  // push token would mean a real phone buzzing. Refuse rather than risk it.
  const [driver] = await q(`
    select d.id, d.active, d.available, d.status, d.vehicle_type,
           p.id as profile_id,
           (select count(*) from push_tokens pt where pt.profile_id = p.id) as tokens
      from drivers d
      join profiles p on p.role = 'driver' and p.driver_id = d.id
     where d.is_test
     order by d.id limit 1`)

  if (!driver) {
    console.error('No test driver found. Need a row in `drivers` with is_test = true and a profile whose driver_id points at it.')
    process.exit(SETUP_FAILURE)
  }
  if (Number(driver.tokens) > 0) {
    console.error(`Test driver ${driver.id} has ${driver.tokens} push token(s); assigning to him would send a real notification.`)
    process.exit(SETUP_FAILURE)
  }

  // A LIVE driver, used only as the wrong half of the pool test. Never assigned
  // to successfully -- the assertion is that the attempt is refused.
  const [liveDriver] = await q(`select id from drivers where not is_test and active order by id limit 1`)

  const [admin] = await q(`select id from profiles where role = 'admin' limit 1`)
  if (!admin) {
    console.error('No admin profile exists, so supervisor_may_touch_order can never be true. Cannot test.')
    process.exit(SETUP_FAILURE)
  }

  console.log(`Target: "${target.name}" (restaurant ${target.restaurant_id}, test mode)`)
  console.log(`  test driver ${driver.id} (${driver.vehicle_type}, 0 push tokens), compound ${target.compound_id}\n`)

  await client.query('BEGIN')
  started = true

  const asAdmin  = () => client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [admin.id])
  const asDriver = () => client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [driver.profile_id])
  const asNobody = () => client.query(`select set_config('request.jwt.claim.sub', $1, true)`,
                                      ['00000000-0000-4000-8000-000000000000'])
  await asAdmin()

  const placeOrder = async (compoundId = target.compound_id) => {
    const rateKey = Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
    const [{ result }] = await q(
      `select public.place_order(
         p_restaurant_id => $1, p_customer_name => 'CI Dispatch Test', p_customer_phone => $2,
         p_zone => 'CI', p_unit_number => 'CI-1',
         p_address_notes => 'automated dispatch test -- this transaction is rolled back',
         p_delivery_fee => 0, p_items => $3::json, p_promo_code => null, p_compound_id => $4,
         p_payment_method => 'cod', p_use_wallet => false, p_rate_key => $5) as result`,
      [target.restaurant_id, PHONE,
       JSON.stringify([{ menu_item_id: target.menu_item_id, qty: 1 }]),
       compoundId, rateKey])
    if (!result?.id) throw new Error(`place_order returned no id: ${JSON.stringify(result)}`)
    return result.id
  }

  const assignment = async (orderId) => (await q(
    `select id, driver_id, status, attempt_number, responded_at, rejection_reason
       from delivery_assignments where order_id = $1 order by attempt_number desc limit 1`,
    [orderId]))[0]

  const orderStatus = async (orderId) =>
    (await q(`select status from orders where id = $1`, [orderId]))[0]?.status

  const driverRow = async () => (await q(
    `select active, available, status from drivers where id = $1`, [driver.id]))[0]

  // =========================================================================
  console.log('admin_assign_order -- putting an order on a driver')
  // =========================================================================

  const order1 = await placeOrder()
  await client.query(`select private.admin_assign_order($1, $2, false)`, [order1, driver.id])
  const a1 = await assignment(order1)
  check('creates an assignment', !!a1)
  check('offers it rather than accepting it for him', a1?.status === 'Offered', `got ${a1?.status}`)
  check('numbers it as the first attempt', a1?.attempt_number === 1, `got ${a1?.attempt_number}`)
  check('puts it on the driver asked for', a1?.driver_id === driver.id)

  const twice = await expectRaise(`select private.admin_assign_order($1, $2, false)`, [order1, driver.id])
  check('refuses to assign an order that is already out',
    twice?.includes('already_assigned') === true, twice ?? 'no error raised')

  // THE POOL GUARD. Not even p_force overrides this one.
  if (liveDriver) {
    const crossed = await expectRaise(
      `select private.admin_assign_order($1, $2, true)`, [await placeOrder(), liveDriver.id])
    check('refuses to put a test order on a live driver, even forced',
      crossed?.includes('not_your_pool') === true, crossed ?? 'no error raised')
  } else {
    skip('the pool guard', 'no active live driver exists to test the wrong half with')
  }

  const suspendedOrder = await placeOrder()
  await client.query(`update drivers set active = false where id = $1`, [driver.id])
  const suspended = await expectRaise(
    `select private.admin_assign_order($1, $2, false)`, [suspendedOrder, driver.id])
  check('refuses a suspended driver', suspended?.includes('driver_suspended') === true,
    suspended ?? 'no error raised')
  await client.query(`update drivers set active = true where id = $1`, [driver.id])

  await asNobody()
  const notAdmin = await expectRaise(
    `select private.admin_assign_order($1, $2, false)`, [suspendedOrder, driver.id])
  check('refuses a caller who is not an admin or supervisor',
    notAdmin?.includes('admin_only') === true, notAdmin ?? 'no error raised')
  await asAdmin()

  // =========================================================================
  console.log('\nthe driver answering -- accept and reject')
  // =========================================================================

  await asDriver()
  await client.query(`select private.driver_accept_assignment($1, $2)`, [a1.id, order1])
  const accepted = await assignment(order1)
  check('accepting moves the assignment to Accepted', accepted?.status === 'Accepted', `got ${accepted?.status}`)
  check('accepting stamps when he answered', accepted?.responded_at !== null)
  check('accepting pulls the order with it', await orderStatus(order1) === 'Accepted')

  const acceptTwice = await expectRaise(
    `select private.driver_accept_assignment($1, $2)`, [a1.id, order1])
  check('refuses a second accept of the same assignment',
    acceptTwice?.includes('wrong_stage') === true, acceptTwice ?? 'no error raised')

  await asNobody()
  const notHis = await expectRaise(`select private.driver_accept_assignment($1, $2)`, [a1.id, order1])
  check('refuses someone who is not a driver at all',
    notHis?.includes('not_a_driver') === true, notHis ?? 'no error raised')
  await asAdmin()

  const rejectOrder = await placeOrder()
  await client.query(`select private.admin_assign_order($1, $2, false)`, [rejectOrder, driver.id])
  const toReject = await assignment(rejectOrder)
  await asDriver()
  await client.query(`select private.driver_reject_assignment($1, $2)`, [toReject.id, 'too far'])
  const rejected = await assignment(rejectOrder)
  check('rejecting moves the assignment to Rejected', rejected?.status === 'Rejected', `got ${rejected?.status}`)
  check('rejecting records the reason he gave', rejected?.rejection_reason === 'too far',
    `got ${rejected?.rejection_reason}`)
  check('rejecting puts the order back on the market',
    await orderStatus(rejectOrder) === 'Driver_Searching', `got ${await orderStatus(rejectOrder)}`)

  const rejectTwice = await expectRaise(
    `select private.driver_reject_assignment($1, $2)`, [toReject.id, 'again'])
  check('refuses to reject an assignment already answered',
    rejectTwice?.includes('wrong_stage') === true, rejectTwice ?? 'no error raised')
  await asAdmin()

  // A driver who declined does not get offered the same order again, unless an
  // admin insists. p_force is the deliberate override, and it must still work.
  const declinedAgain = await expectRaise(
    `select private.admin_assign_order($1, $2, false)`, [rejectOrder, driver.id])
  check('does not re-offer an order the driver already declined',
    declinedAgain?.includes('driver_already_declined') === true, declinedAgain ?? 'no error raised')
  await client.query(`select private.admin_assign_order($1, $2, true)`, [rejectOrder, driver.id])
  check('an admin can force it through anyway', (await assignment(rejectOrder))?.status === 'Offered')
  await client.query(`select private.admin_unassign_order($1, 'CI dispatch test')`, [rejectOrder])

  // =========================================================================
  console.log('\nthe four-delivery cap')
  // =========================================================================
  // order1 is already Accepted, so three more fill him up.

  const held = [order1]
  for (let i = 0; i < 3; i++) {
    const id = await placeOrder()
    await client.query(`select private.admin_assign_order($1, $2, false)`, [id, driver.id])
    const a = await assignment(id)
    await asDriver()
    await client.query(`select private.driver_accept_assignment($1, $2)`, [a.id, id])
    await asAdmin()
    held.push(id)
  }

  const [{ active_now }] = await q(
    `select count(*)::int as active_now from delivery_assignments
      where driver_id = $1 and status in ('Accepted','Picked_Up','Out_for_Delivery')`, [driver.id])
  check('four accepted deliveries are counted as four', active_now === 4, `got ${active_now}`)
  check('the driver is marked unavailable at four', (await driverRow())?.available === false)

  const fifth = await placeOrder()
  const capped = await expectRaise(
    `select private.admin_assign_order($1, $2, false)`, [fifth, driver.id])
  check('refuses a fifth delivery', capped?.includes('dispatch_rule_blocked') === true,
    capped ?? 'no error raised')

  const [{ can }] = await q(`select public.driver_can_take_order($1, $2) as can`, [driver.id, fifth])
  check('driver_can_take_order says no on its own', can === false)

  // =========================================================================
  console.log('\nnot sending one driver in two directions at once')
  // =========================================================================
  const [otherDirection] = await q(`
    select c2.id
      from compounds c1, compounds c2
     where c1.id = $1 and c1.direction is not null
       and c2.direction is not null and c2.direction <> c1.direction
     order by c2.id limit 1`, [target.compound_id])

  if (!otherDirection) {
    skip('the direction rule', 'no compound with a direction different from the target exists')
  } else {
    // Free him down to one delivery so the cap is not what does the refusing.
    for (const id of held.slice(1)) {
      await client.query(`select private.admin_unassign_order($1, 'CI dispatch test')`, [id])
    }
    // The test restaurant covers exactly one compound, and place_order refuses
    // with vendor_not_covering_compound outside it. Coverage is a fixture like
    // any other here -- created inside the transaction, gone on rollback.
    await client.query(
      `insert into vendor_coverage (restaurant_id, compound_id) values ($1, $2)
       on conflict do nothing`, [target.restaurant_id, otherDirection.id])
    const wrongWay = await placeOrder(otherDirection.id)
    const [{ can: canOther }] = await q(
      `select public.driver_can_take_order($1, $2) as can`, [driver.id, wrongWay])
    check('a driver already heading one way is refused the other way', canOther === false)
  }

  // =========================================================================
  console.log('\nadmin_unassign_order -- taking it back off him')
  // =========================================================================

  const beforeUnassign = await orderStatus(order1)
  await client.query(`select private.admin_unassign_order($1, 'CI dispatch test')`, [order1])
  const unassigned = await assignment(order1)
  check('cancels the assignment', unassigned?.status === 'Cancelled', `got ${unassigned?.status}`)
  check('records why it was taken back', unassigned?.rejection_reason === 'CI dispatch test',
    `got ${unassigned?.rejection_reason}`)
  check('puts the order back on the market',
    await orderStatus(order1) === 'Driver_Searching', `was ${beforeUnassign}`)

  const nowFree = await driverRow()
  check('frees the driver up again', nowFree?.available === true)
  check('sets him back to Available with nothing left to deliver', nowFree?.status === 'Available',
    `got ${nowFree?.status}`)

  const nothingToTake = await expectRaise(
    `select private.admin_unassign_order($1, 'CI dispatch test')`, [order1])
  check('refuses when there is no active assignment to take back',
    nothingToTake?.includes('no_active_assignment') === true, nothingToTake ?? 'no error raised')

  // =========================================================================
  console.log('\nthe no-answer ladder')
  // =========================================================================
  // This is the path that pages a human at 11pm, so its guards matter: it must
  // not fire before the driver has actually tried, and a second tap (or the
  // client's retry-on-network-failure) must not page admin twice.

  const noAnswerOrder = await placeOrder()
  await client.query(`select private.admin_assign_order($1, $2, false)`, [noAnswerOrder, driver.id])
  const na = await assignment(noAnswerOrder)
  await asDriver()
  await client.query(`select private.driver_accept_assignment($1, $2)`, [na.id, noAnswerOrder])

  // The ladder first. Every rung refuses to be skipped, and each refusal is a
  // separate guard in a separate function -- collectively they are what stops a
  // driver marking an order delivered from his sofa.
  const pickupBeforeArriving = await expectRaise(`select private.driver_mark_picked_up($1)`, [na.id])
  check('refuses a pickup before he says he reached the restaurant',
    pickupBeforeArriving?.includes('must_arrive_first') === true, pickupBeforeArriving ?? 'no error raised')

  await client.query(`select private.driver_arrived_at_restaurant($1)`, [na.id])
  const pickupBeforeReady = await expectRaise(`select private.driver_mark_picked_up($1)`, [na.id])
  check('refuses a pickup before the kitchen says the food is ready',
    pickupBeforeReady?.includes('order_not_ready') === true, pickupBeforeReady ?? 'no error raised')

  await client.query(`update orders set kitchen_status = 'ready' where id = $1`, [noAnswerOrder])
  await client.query(`select private.driver_mark_picked_up($1)`, [na.id])
  check('picking up moves the assignment on', (await assignment(noAnswerOrder))?.status === 'Picked_Up')
  check('picking up pulls the order with it', await orderStatus(noAnswerOrder) === 'Picked_Up')

  const callBeforeLeaving = await expectRaise(`select private.driver_called_customer($1)`, [na.id])
  check('refuses a customer call before he has set off',
    callBeforeLeaving?.includes('wrong_stage') === true, callBeforeLeaving ?? 'no error raised')

  await client.query(`select private.driver_mark_out_for_delivery($1)`, [na.id])
  check('setting off moves the assignment on',
    (await assignment(noAnswerOrder))?.status === 'Out_for_Delivery')
  check('setting off pulls the order with it',
    await orderStatus(noAnswerOrder) === 'Out_for_Delivery')

  const beforeCalling = await expectRaise(`select private.driver_report_no_answer($1)`, [na.id])
  check('refuses a no-answer report before he has called',
    beforeCalling?.includes('must_call_customer_first') === true, beforeCalling ?? 'no error raised')

  await client.query(`select private.driver_called_customer($1)`, [na.id])
  const tooEarly = await expectRaise(`select private.driver_report_no_answer($1)`, [na.id])
  check('refuses a no-answer report in the first five minutes',
    tooEarly?.includes('too_early') === true, tooEarly ?? 'no error raised')

  // Backdate the out-for-delivery stamp past the five-minute gate rather than
  // waiting for it. The gate is what is under test, not the clock.
  await client.query(
    `update delivery_assignments set out_for_delivery_at = now() - interval '10 minutes' where id = $1`, [na.id])
  await client.query(`select private.driver_report_no_answer($1)`, [na.id])
  const [reported] = await q(
    `select no_answer_reported_at from delivery_assignments where id = $1`, [na.id])
  check('accepts the report once he has called and waited', reported?.no_answer_reported_at !== null)

  await client.query(`select private.driver_report_no_answer($1)`, [na.id])
  const [again] = await q(
    `select no_answer_reported_at from delivery_assignments where id = $1`, [na.id])
  check('a second tap does not page admin again',
    String(again?.no_answer_reported_at) === String(reported?.no_answer_reported_at),
    'the timestamp moved, so the admin notification fired twice')

  await asAdmin()
  const badAction = await expectRaise(
    `select private.admin_resolve_no_answer($1, $2)`, [na.id, 'something_else'])
  check('refuses an admin resolution that is not one of the five actions',
    badAction?.includes('invalid_action') === true, badAction ?? 'no error raised')

  await client.query(`select private.admin_resolve_no_answer($1, 'wait')`, [na.id])
  const [waited] = await q(
    `select no_answer_admin_action, no_answer_reported_at from delivery_assignments where id = $1`, [na.id])
  check('choosing to wait records the decision', waited?.no_answer_admin_action === 'wait')
  check('choosing to wait clears the flag so the next no-answer can page again',
    waited?.no_answer_reported_at === null)

} catch (e) {
  console.error(`\nThe suite could not complete: ${e.message}`)
  failures.push(`suite aborted: ${e.message}`)
} finally {
  if (started) {
    try { await client.query('ROLLBACK'); console.log('\n(rolled back -- nothing persisted)') }
    catch { /* connection already gone; nothing was committed either way */ }
  }
  try { await client.end() } catch { /* nothing useful to do if closing fails */ }
}

console.log(`\n${passed} passed, ${failures.length} failed${skipped.length ? `, ${skipped.length} skipped` : ''}`)
if (skipped.length) {
  console.log('\nNot covered by this run:')
  for (const s of skipped) console.log(`  - ${s}`)
}
if (failures.length) {
  console.error('\nDISPATCH TESTS FAILED -- do not deploy:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('DISPATCH TESTS PASSED -- assignment, the four-delivery cap, unassignment and the no-answer ladder behave.')
