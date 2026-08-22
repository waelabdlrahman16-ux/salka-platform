# Salka — how this project actually works

Written 2026-08-22, after a two-hour checkout outage that nobody caused by
deploying anything. Read the first section before touching migrations.

## THREE things can change production. Only one of them reads CI.

| Path | Trigger | Changes | Reads CI? |
|---|---|---|---|
| `.github/workflows/deploy.yml` | push to `main` | the app (Cloudflare Worker `appgosalka-platform`) | the gates run on the PR before merge |
| **Supabase GitHub integration** | **merge to `main`** | **the DATABASE** | **no** |
| Cloudflare Workers Builds | push | `gosalka-landing` only | no |

The app's Cloudflare Git integration was disconnected on 2026-08-22 so that
`deploy.yml` is the only path to the app. `gosalka-landing` keeps its
integration for branch preview URLs. See `docs/DUPLICATE-DEPLOY-PATHS-2026-08-21.md`.

**Merging a PR that touches `supabase/migrations/` IS the production migration.**
There is no separate apply step. Do not merge one without the owner saying
"live".

## Never leave a migration file unapplied

A committed-but-unapplied migration is a landmine. It carries whatever the
schema looked like when it was written, and it detonates the moment anything
syncs migrations — which, with the integration connected, is the next merge that
touches the directory.

On 2026-08-22 at 04:06 UTC, merging a migration PR made the integration apply
seven files that had been sitting unapplied for days. One of them recreated
`settings_customer_read` with the three keys that predate the service fee cap.
Checkout was dead until 06:22. The same replay also silently reverted
`admin_force_delivered`, the duplicate-credit guard on `credit_wallet`, a grant
revocation on account recovery, `admin_mark_order_as_test`, and the promo
functions.

`npm run check:production` (in `deploy.yml`, after the deploy) asserts every
migration file has a ledger row, that `anon` can read the checkout settings, and
that four previously-reverted behaviours are still present.

## The migration ledger

`supabase_migrations.schema_migrations` has a `statements text[]` column holding
the SQL **as executed**. So:

- A ledger row with no file can be **reconstructed from the ledger** — no CLI, no
  database password. See `docs/MIGRATION-LEDGER-RECONSTRUCTION-2026-08-22.md`.
- The ledger holds statements, not the authored file: a leading comment block is
  not a statement and never reaches it. Where a file already exists, keep it.
- **`apply_migration` (the MCP tool) stamps its OWN version**, which will not
  match your filename — rename the file to the recorded version afterwards. The
  **Git integration uses the filename** as the version, so files applied that way
  do not drift.

## Verifying anything RLS-related

Check it as `anon`, never as the owner. RLS is not enforced for the table owner,
so a policy gap is invisible from a superuser session. That is exactly how the
first `service_fee_max_egp` outage shipped on 2026-08-22 at 00:52.

```sql
begin; set local role anon;
select key from settings where key = 'service_fee_max_egp';
rollback;
```

## CI

- `ci.yml` → `build` (typecheck, build, lint at zero warnings, `check:quote-state`)
  on every branch; `smoke-order` on pull requests only — it places a real order
  against production and rolls it back.
- **Check the `smoke-order` JOB, not the suite.** The push-triggered suite
  reports success with `smoke-order` skipped; only the PR-triggered one runs it.
- `deploy.yml` → build, deploy, then `check:production` against the real database.

## Money and pricing invariants

- `private.service_fee_for(subtotal)` is the ONLY function that reads
  `service_fee_percent`. It is `least(round(subtotal * pct / 100), max)`, capped
  at `service_fee_max_egp` (199). `src/lib/serviceFee.ts` mirrors it exactly —
  verified equal at 358 sampled values.
- Never mirror server pricing in the client without checking both halves of the
  policy. Show nothing until the server answers.
- `total = subtotal + delivery_fee + service_fee - promo_discount - wallet_used`.
- Wallets: `balance` must equal `sum(wallet_transactions.amount)`, always.
- The quote flow: the supervisor enters only the item subtotal; the backend
  computes everything; a quote is immutable for 15 minutes; the customer must
  accept before preparation, assignment or dispatch. `guard_custom_order_quote_*`
  triggers enforce it. Renewal never recomputes.

## Notifications

`push_nudge_sweep` (every minute) repeats vendor / driver / pricing / payment
reminders; `check_late_unclaimed_orders` (every 30s) advances order state and
alerts once per order. As of 2026-08-22 a repeat goes to whoever can act on it
(pricing → supervisors, payment → admins, since confirming a transfer gates on
`is_admin()`), and escalations still go to everyone via `notify_admin`.

All push tokens are `web` tokens and they die often — 183 dead against 15 live in
one week, all `UNREGISTERED`. `record_push_result` removes a token once FCM
rejects it, but FCM keeps accepting a token long after the browser is gone, so
stale rows linger. `admin_list_accounts` returns `has_device` and the accounts
screen shows when an account has none.

`stale_order_sweep` (every 10 minutes) is the floor under all of it. Every
branch of `push_nudge_sweep` is fenced by `created_at > now() - 45 minutes` and
the pricing escalation is a one-shot, so before 2026-08-22 an order went
permanently silent after 45 minutes — that is why one sat 202 minutes unpriced.
The sweep re-alerts everyone by **age** — 45m, 90m, 180m, 360m, then hourly, with
**no attempts ceiling**, since a ceiling is the bug — and measures scheduled
orders from `dispatch_at` so a pre-booked order is not an instant alarm. It stops
only when the order leaves the waiting state.

Pruning dead tokens: only ever delete a token older than 7 days **that is not the
last one its profile has**. Deleting the last one silences a real vendor or
driver, and `vendor_no_device` then fires on every order they get.

## Things not to touch without asking

- **Order #979** — manually closed as Delivered at 217 EGP as a customer-friendly
  exception.
- **Order #427** — a real customer was overcharged 25.80 EGP on 19 Aug: the promo
  (`SOKHNA30`) was recorded but never deducted from `total`, so 448.00 was
  collected where 422.20 was owed. The bug that caused it (`reprice_order`
  dropping the promo) was fixed hours later. **Settled 2026-08-22**: the customer
  had no account, so a `customer_wallets` row was created for phone
  `1100424577` and credited 25.80 (`wallet_transactions.order_id = 427`).
  `orders.total` still reads 448.00 **on purpose** — that is what the driver
  actually collected, and rewriting it would break the match against the cash.
- **Driver cash balances** — **settled 2026-08-22**. The accountant collected
  the outstanding cash outside the app, so `driver_settlements` now carries a
  `cash_remitted` row per driver for exactly what was held at that moment:
  كريم 13,620.70, أشرف 15,478.70, علي 8,145.30 — 37,244.70 total. `cash_held`
  was decremented by those amounts, not zeroed: كريم collected another 674.00
  on a delivery that landed mid-settlement, and he really does still hold it,
  so his balance reads 674.00 and the other two read 0.00.

  Two rules that came out of doing it. **Never write a settlement from a figure
  you read earlier** — `cash_held` moves whenever a driver delivers, and the
  first attempt was caught only because it asserted the total before
  committing. Settle a named amount and subtract it; never assign zero.
  And the reconciliation gap (collected − settled − held: كريم −3,024.00,
  أشرف +1,735.00, علي −99.50) is a **separate, still-unexplained** problem —
  settling the cash did not explain it. Do not "fix" it silently.

## Working rules

- Work in sensible batches; pause for a real product decision, a missing
  credential, or approval for something destructive.
- The worktree is intentionally dirty. Preserve existing changes. Never commit,
  push, reset or discard unrelated work.
- **Do not deploy, migrate, or change production unless the owner says
  "live" / "go live".** Merging a migration PR counts as migrating.
- Inspect live state before Supabase work and verify after.
- Build and lint before deploying; verify the deployed asset afterwards.
- Report the outcome first, and keep it short.
