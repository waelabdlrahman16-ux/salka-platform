# What is in production and not in this repository

Swept 2026-08-21, after pricing order #1000 turned out to be impossible for four
days because production was serving an edge function built before the repo grew
the action it needed (#190). That fault was invisible to lint, typecheck, the
build and every test script, because each file involved was individually
correct. This is what the same question turned up everywhere else.

`scripts/check-drift.mjs` reruns all of it.

## The headline: an entire feature exists only in production

The **quote-approval system** is live and load-bearing — it is what blocked
assigning a driver to #1000 all evening — and this repository contains none of
it:

| Live in production | In this repo |
|---|---|
| table `order_quotes` | no migration creates it |
| column `orders.quote_state`, `orders.current_quote_id` | no migration adds them |
| trigger `guard_custom_order_quote_dispatch` | absent |
| trigger `guard_custom_order_quote_fulfilment` | absent |
| `issue_custom_order_quote`, `accept_custom_order_quote`, `reject_custom_order_quote`, `renew_expired_custom_order_quote`, `get_current_custom_order_quote`, `staff_current_custom_order_quote`, `preview_custom_order_quote`, `expire_custom_order_quotes` | absent |
| edge function `quote-operations` (v5) | absent |
| the client that calls all of it | absent — nothing in `src/` mentions `quote_state` |

The only trace here is `docs/quote-approval-transition-matrix.md`, a design note.

Two guards in that system refuse work when a quote is not accepted, and this
repository has no way to see them. That is how "assign driver" read as a broken
button all evening: the refusal was correct and invisible.

## Migrations

411 applied in production, 373 files here at the time of the sweep.

- **45 applied in production with no file here.** Mostly `20260813` compound
  and fee work (coordinates, name_en, fee tiers, the service-fee mechanism)
  plus the `20260821` quote system.
- **30 same name, different version.** Applied through the dashboard or the MCP
  server, which stamps its own timestamp. Not drift in content, but it makes a
  version-only comparison useless — the first pass of this sweep reported 64
  mismatches, and 30 were this.
- **7 files here with no matching applied row.** Every object they create was
  checked directly and **all of them exist in production**
  (`account_recovery_requests`, `order_test_audit_log`,
  `admin_adjust_restaurant_prices`, `admin_bake_restaurant_service_fee`,
  `admin_mark_order_as_test`, `request_customer_account_recovery`,
  `admin_force_delivered`). They were applied by some other route. Nothing is
  missing from production; the ledger is just unreliable.
- Security controls in that group were verified rather than assumed:
  `admin_force_delivered` does require `is_admin()` and does not accept
  supervisors, and `settings` still has a policy `anon` can read, which
  anonymous checkout pricing depends on.

## Edge functions

- **`quote-operations`** and **`send-alert-email`** are deployed and are not in
  this repository.
- **`vendor-operations`** was four days stale. Fixed and redeployed in #190.
- Everything else needs a **content** comparison, which is what the script does.
  Do not use timestamps: #137 added most of these files to the repo on
  2026-08-18, long after they were first deployed, so "the repo is newer" is
  meaningless for them. `customer-order-creation` looked three hours stale by
  that measure and is byte-for-byte current — checked.

## Callable RPCs nothing here mentions

14 of 64 checked. Seven are the quote system. The rest:

`admin_customer_management`, `admin_update_customer_address`,
`admin_update_customer_future`, `admin_apply_customer_address_to_order`,
`admin_delete_empty_restaurant`, `set_order_is_test`

Either the client calling them lives outside this repository, or they are dead
API surface. Both are worth deciding about; neither is automatically a fault.

## How this keeps happening

Nothing deploys edge functions or migrations from CI. `deploy.yml` runs
`wrangler` and nothing else. Both go up by hand, and the deployed
`entrypoint_path` values show two different working copies on one machine:

- `/Users/waelabdlrahman/Documents/ChatGPT/Salka/salka-platform`
- `/Users/waelabdlrahman/Documents/Claude/Projects/Salka/repo/salka-platform`

Two checkouts at different commits, each deploying different functions, is
exactly how one function stays four days behind while its neighbours are
current.

## Worth doing next

1. Run `node scripts/check-drift.mjs` in CI so this is answered continuously
   rather than after an outage.
2. Bring the quote system into the repository — migration, edge function and
   client. It is the largest untracked thing and it already caused one evening
   of confusion.
3. Decide on `quote-operations` and `send-alert-email`: adopt or remove.
4. Add an edge-function deploy step, so "deployed" and "merged" mean the same
   thing.
5. Settle the two working copies down to one.
