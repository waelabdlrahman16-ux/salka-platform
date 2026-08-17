#!/usr/bin/env node
// Create the fixture the order smoke test needs, once.
//
// scripts/smoke-place-order.mjs places a real order and rolls it back. It
// refuses to run without a restaurant it can safely order from, which means
// all four of:
//
//   is_test = true          keeps the order out of money and dispatch, and
//                           hides the restaurant from customers -- all three
//                           catalogue functions (restaurants_all_public,
//                           restaurants_for_compound, search_menu_for_compound)
//                           filter on `not r.is_test`
//   one simple menu item    available, not a shelf label, no required size and
//                           no required add-on group, so a one-line order is
//                           valid
//   coverage for a compound place_order rejects a vendor that does not cover
//                           the customer's compound
//   no vendor push tokens   notify_new_order returns early when a restaurant
//                           has none, so nobody's phone rings
//
// Idempotent: re-running finds what exists and only fills gaps.
//
//   node scripts/ensure-test-restaurant.mjs             # show the plan, change nothing
//   node scripts/ensure-test-restaurant.mjs --confirm   # apply it
//
// Reads SUPABASE_DB_URL from .env.local. This WRITES to production, which is
// why it does nothing without --confirm.

import pg from 'pg'
import { loadEnvLocal } from './loadEnvLocal.mjs'

loadEnvLocal()

const APPLY = process.argv.includes('--confirm')
const NAME = 'CI Smoke Test (do not delete)'

const url = process.env.SUPABASE_DB_URL
if (!url) { console.error('SUPABASE_DB_URL is not set. See .env.local.example.'); process.exit(2) }

const client = new pg.Client({ connectionString: url })
const q = async (sql, p) => (await client.query(sql, p)).rows

await client.connect()
const plan = []
let restaurantId

try {
  await client.query('BEGIN')

  // ---- the restaurant ------------------------------------------------------
  let [r] = await q(`select id, name, is_test, archived from restaurants where name = $1`, [NAME])
  if (r && !r.is_test) {
    // Refuse rather than flip it: a restaurant that is currently visible to
    // customers must not be silently turned into a test fixture.
    console.error(`A restaurant named "${NAME}" exists but is_test = false.`)
    console.error('Refusing to change it. Rename or remove it, then rerun.')
    await client.query('ROLLBACK'); await client.end(); process.exit(2)
  }
  if (!r) {
    plan.push(`create restaurant "${NAME}" with is_test = true`)
    if (APPLY) {
      ;[r] = await q(
        `insert into restaurants (name, is_test, archived, featured)
         values ($1, true, false, false) returning id, name, is_test, archived`, [NAME])
    }
  } else {
    plan.push(`restaurant "${NAME}" already exists (id ${r.id})`)
  }
  restaurantId = r?.id

  // ---- one simple, orderable item -----------------------------------------
  //
  // When the restaurant does not exist yet AND we are only planning, there is
  // no id to query against -- but the work still has to appear in the plan.
  // The first version silently skipped this whole block in that case and
  // printed a one-line plan for a three-step change, which is a plan that lies.
  if (!restaurantId) {
    plan.push('create one simple menu item (25.00, available, no sizes, no required add-ons)')
    const [c] = await q(`select id, name from compounds where active order by distance_km limit 1`)
    plan.push(c ? `add coverage for compound ${c.id} (${c.name})`
                : 'ERROR: no active compound exists to attach coverage to')
    plan.push('verify no vendor push tokens are attached (nothing can be notified)')
  } else {
    const [item] = await q(`
      select m.id from menu_items m
       where m.restaurant_id = $1 and m.available
         and not coalesce(m.is_shelf_label,false)
         and not exists (select 1 from menu_item_sizes s where s.menu_item_id = m.id)
         and not exists (select 1 from menu_item_addon_groups g
                          where g.menu_item_id = m.id and g.min_select > 0)
       limit 1`, [restaurantId])
    if (!item) {
      plan.push('create one simple menu item (25.00, available, no sizes, no required add-ons)')
      if (APPLY) {
        await q(`insert into menu_items (restaurant_id, name, price, category, available, is_shelf_label)
                 values ($1, 'Smoke Test Item', 25.00, 'test', true, false)`, [restaurantId])
      }
    } else {
      plan.push(`menu item already present (id ${item.id})`)
    }

    // ---- coverage for exactly one compound ---------------------------------
    const [cov] = await q(`select compound_id from vendor_coverage where restaurant_id = $1 limit 1`, [restaurantId])
    if (!cov) {
      const [c] = await q(`select id, name from compounds where active order by distance_km limit 1`)
      if (!c) {
        console.error('No active compound exists to attach coverage to.')
        await client.query('ROLLBACK'); await client.end(); process.exit(2)
      }
      plan.push(`add coverage for compound ${c.id} (${c.name})`)
      if (APPLY) await q(`insert into vendor_coverage (restaurant_id, compound_id) values ($1,$2)`, [restaurantId, c.id])
    } else {
      plan.push(`coverage already present (compound ${cov.compound_id})`)
    }

    // ---- and it must not be able to notify anybody -------------------------
    const [tok] = await q(`
      select count(*)::int as n from push_tokens pt
        join profiles p on p.id = pt.profile_id
       where p.role = 'vendor' and p.restaurant_id = $1`, [restaurantId])
    if (tok.n > 0) {
      console.error(`\nThis restaurant has ${tok.n} vendor push token(s). Ordering against it`)
      console.error('would send a real notification. Remove the vendor login before using it.')
      await client.query('ROLLBACK'); await client.end(); process.exit(2)
    }
    plan.push('no vendor push tokens — nothing can be notified')
  }

  console.log(APPLY ? '\nApplied:\n' : '\nPLAN (nothing changed — rerun with --confirm to apply):\n')
  plan.forEach(p => console.log('  · ' + p))

  if (APPLY) {
    await client.query('COMMIT')
    console.log('\nDone. Now run:  npm run smoke:order')
  } else {
    await client.query('ROLLBACK')
    console.log('\nTo apply:  node scripts/ensure-test-restaurant.mjs --confirm')
  }
} catch (err) {
  try { await client.query('ROLLBACK') } catch {}
  console.error('\n✗ Failed:', err.message)
  process.exitCode = 1
} finally {
  try { await client.end() } catch {}
}
