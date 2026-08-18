#!/usr/bin/env node
// Exercise every money function against the real database, then roll it all back.
//
// WHY THIS EXISTS. The order smoke test proves a customer can buy food. Nothing
// proved the other half: that paying a driver pays the right amount once, that a
// wallet credit cannot be issued twice, that a refund cannot be marked paid
// twice. Those are the paths where a bug costs cash rather than a sale, and they
// are the paths a customer never exercises for us.
//
// Three of the four functions are safe today only because of HOW they are
// written -- settlements drain to zero, so a second call finds nothing. That is
// a property of the current bodies, not a guarantee, and it is exactly the kind
// of thing a rewrite silently removes. credit_wallet already lacked it and could
// be paid twice until it was fixed. These assertions are what stop that
// happening again quietly.
//
//   npm run test:money        # locally, with SUPABASE_DB_URL set
//
// WHY THIS IS SAFE ON PRODUCTION. Everything runs inside ONE transaction that is
// always rolled back, on success and on failure. Fixtures are created inside it:
// a throwaway driver on an impossible phone number, its own earnings rows, its
// own wallet. Nothing is read-modify-written on live rows except one order,
// whose refund_status is flipped and rolled back with the rest.
//
// Exit codes carry meaning, the same way the order smoke test's do:
//   1  a money function is broken   -> block the merge
//   2  the script could not run     -> fix the setup; says NOTHING about money

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

const TEST_PHONE = '01999999999'      // deliberately not a real Egyptian mobile in use
const client = new pg.Client({ connectionString: url })

let passed = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  ✓ ${name}`) }
  else { failures.push(`${name}${detail ? ` -- ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` -- ${detail}` : ''}`) }
}

/** Run a statement expecting it to raise; return the error message, or null if it did not.
 *
 *  The SAVEPOINT is not optional. In Postgres a failed statement aborts the whole
 *  transaction -- every later command returns "current transaction is aborted"
 *  until rollback. Half of this suite asserts that a function REFUSES something,
 *  so without a savepoint the first expected failure kills every test after it.
 *  The first run of this file did exactly that: twelve passes, then nothing. */
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

let started = false
try {
  await client.connect()
  await client.query('BEGIN')
  started = true

  // ---- who we act as -------------------------------------------------------
  const { rows: admins } = await client.query(
    `select id from profiles where role = 'admin' limit 1`)
  if (!admins.length) {
    console.error('No admin profile exists, so is_admin() can never be true. Cannot test.')
    process.exit(SETUP_FAILURE)
  }
  const adminId = admins[0].id
  const asAdmin = () => client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [adminId])
  await asAdmin()

  // ---- fixtures, all inside the transaction --------------------------------
  const { rows: [driver] } = await client.query(
    `insert into drivers (name, phone, vehicle_type, vehicle_plate, active, cash_held)
     values ('MONEY TEST -- rolled back', $1, 'motorcycle', 'TEST', false, 0)
     returning id`, [TEST_PHONE])

  console.log('\nsettle_driver_earnings')
  await client.query(
    `insert into driver_earnings (driver_id, delivery_fee, driver_earning, admin_amount, paid)
     values ($1, 60, 40, 20, false), ($1, 50, 30, 20, false)`, [driver.id])
  await client.query(
    `insert into settlement_requests (driver_id, status) values ($1, 'pending')`, [driver.id])

  await client.query(`select settle_driver_earnings($1, $2)`, [driver.id, adminId])

  const { rows: [s1] } = await client.query(
    `select count(*)::int n, coalesce(sum(amount),0)::numeric total, max(actor::text) actor
       from driver_settlements where driver_id = $1 and kind = 'earnings_paid'`, [driver.id])
  check('pays the exact unpaid sum, once', s1.n === 1 && Number(s1.total) === 70,
        `got ${s1.n} row(s) totalling ${s1.total}, expected 1 row of 70`)
  check('records the acting admin', s1.actor === adminId)

  const { rows: [unpaid] } = await client.query(
    `select count(*)::int n from driver_earnings where driver_id = $1 and not paid`, [driver.id])
  check('marks the earnings paid', unpaid.n === 0, `${unpaid.n} still unpaid`)

  const { rows: [req] } = await client.query(
    `select status from settlement_requests where driver_id = $1`, [driver.id])
  check('fulfils the pending settlement request', req.status === 'fulfilled', `status=${req.status}`)

  await client.query(`select settle_driver_earnings($1, $2)`, [driver.id, adminId])
  const { rows: [s2] } = await client.query(
    `select count(*)::int n from driver_settlements where driver_id = $1 and kind = 'earnings_paid'`, [driver.id])
  check('paying twice pays once (idempotent)', s2.n === 1, `${s2.n} settlement rows after two calls`)

  console.log('\nsettle_driver_cash')
  await client.query(`update drivers set cash_held = 250 where id = $1`, [driver.id])
  await client.query(`select settle_driver_cash($1, $2)`, [driver.id, adminId])
  const { rows: [c1] } = await client.query(
    `select (select cash_held from drivers where id = $1)::numeric held,
            (select coalesce(sum(amount),0) from driver_settlements
              where driver_id = $1 and kind = 'cash_remitted')::numeric remitted,
            (select max(actor::text) from driver_settlements
              where driver_id = $1 and kind = 'cash_remitted') actor`, [driver.id])
  check('zeroes the cash held', Number(c1.held) === 0, `cash_held=${c1.held}`)
  check('records the amount remitted', Number(c1.remitted) === 250, `remitted=${c1.remitted}`)
  check('records the acting admin', c1.actor === adminId)

  await client.query(`select settle_driver_cash($1, $2)`, [driver.id, adminId])
  const { rows: [c2] } = await client.query(
    `select count(*)::int n from driver_settlements where driver_id = $1 and kind = 'cash_remitted'`, [driver.id])
  check('settling cash twice records once (idempotent)', c2.n === 1, `${c2.n} rows`)

  console.log('\ncredit_wallet')
  await client.query(`select credit_wallet($1, 25, 'MONEY TEST reason A', null, $2)`, [TEST_PHONE, adminId])
  const { rows: [w1] } = await client.query(
    `select (select balance from customer_wallets where phone = normalize_phone($1))::numeric bal,
            (select count(*)::int from wallet_transactions
              where wallet_id = (select id from customer_wallets where phone = normalize_phone($1))) n,
            (select max(actor::text) from wallet_transactions
              where wallet_id = (select id from customer_wallets where phone = normalize_phone($1))) actor`,
    [TEST_PHONE])
  check('credits the balance', Number(w1.bal) === 25, `balance=${w1.bal}`)
  check('records the acting admin', w1.actor === adminId)

  const dup = await expectRaise(
    `select credit_wallet($1, 25, 'MONEY TEST reason A', null, $2)`, [TEST_PHONE, adminId])
  check('refuses an identical repeat', dup !== null && dup.includes('duplicate_credit'), dup ?? 'no error raised')

  await client.query(`select credit_wallet($1, 25, 'MONEY TEST reason B', null, $2)`, [TEST_PHONE, adminId])
  const { rows: [w2] } = await client.query(
    `select balance::numeric bal from customer_wallets where phone = normalize_phone($1)`, [TEST_PHONE])
  check('allows the same amount with a different reason', Number(w2.bal) === 50, `balance=${w2.bal}`)

  const neg = await expectRaise(`select credit_wallet($1, -5, 'MONEY TEST neg', null, $2)`, [TEST_PHONE, adminId])
  check('refuses a negative amount', neg !== null && neg.includes('invalid_credit_amount'), neg ?? 'no error')

  const zero = await expectRaise(`select credit_wallet($1, 0, 'MONEY TEST zero', null, $2)`, [TEST_PHONE, adminId])
  check('refuses a zero amount', zero !== null && zero.includes('invalid_credit_amount'), zero ?? 'no error')

  const noReason = await expectRaise(`select credit_wallet($1, 10, '', null, $2)`, [TEST_PHONE, adminId])
  check('requires a reason', noReason !== null && noReason.includes('reason_required'), noReason ?? 'no error')

  console.log('\nmark_refunded')
  const { rows: [order] } = await client.query(`select id from orders order by id desc limit 1`)
  await client.query(`update orders set refund_status = 'pending', refunded_by = null, refunded_at = null where id = $1`, [order.id])
  await client.query(`select mark_refunded($1, $2)`, [order.id, adminId])
  const { rows: [o1] } = await client.query(
    `select refund_status, refunded_by::text, refunded_at is not null as has_time from orders where id = $1`, [order.id])
  check('marks the refund paid', o1.refund_status === 'refunded', `status=${o1.refund_status}`)
  check('records who refunded it', o1.refunded_by === adminId)
  check('records when it was refunded', o1.has_time === true)

  const twice = await expectRaise(`select mark_refunded($1, $2)`, [order.id, adminId])
  check('refuses to refund twice', twice !== null && twice.includes('refund_not_pending'), twice ?? 'no error')

  console.log('\nauthorisation')
  const notAdmin = '00000000-0000-4000-8000-000000000000'
  for (const [name, sql, params] of [
    ['settle_driver_earnings', `select settle_driver_earnings($1, $2)`, [driver.id, notAdmin]],
    ['settle_driver_cash', `select settle_driver_cash($1, $2)`, [driver.id, notAdmin]],
    ['credit_wallet', `select credit_wallet($1, 5, 'MONEY TEST nonadmin', null, $2)`, [TEST_PHONE, notAdmin]],
    ['mark_refunded', `select mark_refunded($1, $2)`, [order.id, notAdmin]],
  ]) {
    const err = await expectRaise(sql, params)
    check(`${name} refuses a non-admin`, err !== null && err.includes('admin_only'), err ?? 'no error raised')
    await asAdmin()   // the failed call left the claim set to the non-admin
  }

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

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.error('\nMONEY TESTS FAILED -- do not deploy:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('MONEY TESTS PASSED -- settlements, wallet credits and refunds behave.')
