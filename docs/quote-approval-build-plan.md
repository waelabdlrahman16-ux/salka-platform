# Quote approval — local build plan

**Status: local implementation draft; not applied or deployed.** This is the
implementation handoff for [`quote-approval-transition-matrix.md`](quote-approval-transition-matrix.md).
The listed migration and Edge Function exist only in this worktree. Nothing has
been applied, deployed, committed, or changed in production.

## Goal

Make a customer explicitly accept a specific, immutable custom-order quote before
the order can become payable, visible to the vendor, dispatched, or prepared.

## Confirmed production baseline

At merged PR #178 (`b356c697`):

1. `private.submit_custom_order` creates a custom request with
   `pricing_status = 'pending_quote'` and `status = 'awaiting_quote'`.
2. A supervisor/vendor action calls `confirm_custom_order_price` through
   `supabase/functions/vendor-operations/index.ts` using action `confirmPrice`.
3. `private.confirm_custom_order_price` currently writes the price directly to
   `orders`, sets `pricing_status = 'confirmed'`, computes a deposit when needed,
   and moves the order to `pending`, `Scheduled`, or `awaiting_payment`.
4. There is no `order_quotes` table, no customer accept/reject endpoint, and no
   state representing customer agreement.

This means `pricing_status = 'confirmed'` currently means *staff issued a price*,
not *the customer accepted it*. It must not be reinterpreted as agreement during a
rollout.

## Local draft status

- The additive migration, server-owned 15-minute expiry, quote API, customer
  approval UI, notification calls, and row-level visibility/transition guards
  are drafted locally.
- A schema-only, read-only production export was restored into a separate
  disposable local Postgres database. The quote migration executed there
  successfully and `scripts/test-quote-state-local.sql` passed for issue,
  unchanged reissue, acceptance, rejection, expiry persistence, fulfilment
  blocking, the Supervisor ceiling, and the Admin override.
- `supabase/baseline/database.types.ts` was regenerated from that migrated
  local schema. This export contains no production rows or secrets.
- Remaining before a release request: physical-device push evidence and an
  explicitly authorized rollout plan.

## Target data contract

The implementation needs a versioned `order_quotes` record. It is the authoritative
financial snapshot for a custom-order quote; the `orders` row carries only the current
quote state and current quote reference.

Required immutable fields after issue:

- `order_id`, `version`, `state`, `issued_by`, `issued_at`, `expires_at`
- `subtotal`, `delivery_fee`, `service_fee`, `promo_code_id`
- all promo allocation fields, `wallet_used`, `total`
- `payment_method`, `deposit_required`, `deposit_amount`, `currency`
- `accepted_at`, `accepted_by`, `rejected_at`, `rejected_by`, and optional reason

Required order-level compatibility fields:

- `quote_state`: `not_required`, `pending`, `offered`, `accepted`, `rejected`,
  `expired`, `superseded`
- `current_quote_id`

Legacy `pricing_status` remains during rollout. For custom orders, the initial mapping
is `pending_quote → pending`; legacy `confirmed` is historical staff pricing and must
not be backfilled as `accepted`.

## New server operations

All operations must execute in the database transaction that validates the transition
and appends its audit event. The Edge Functions only validate request shape, require
identity, apply rate limits, and map known errors.

| Operation | Caller | Preconditions | Result |
| --- | --- | --- | --- |
| `issue_custom_order_quote` | Supervisor/Admin | Custom order, quote state `pending`, `offered`, `rejected`, or `expired`, not cancelled | Inserts a new version; prior offered version becomes `superseded`; current state becomes `offered`; vendor remains unable to view it. |
| `accept_custom_order_quote` | Customer only | Current offered quote, unexpired, customer owns the order | Marks exact version accepted; freezes snapshot onto order; opens `unpaid` or `deposit_due`; does not double-charge. |
| `reject_custom_order_quote` | Customer only | Current offered quote, unexpired | Marks version rejected; releases any held promo reservation; stops progression. |
| `expire_custom_order_quotes` | Scheduled system operation | Current offered quote past expiry | Marks it expired and emits a single event/notification. |

The existing `confirm_custom_order_price` must be retired from the customer lifecycle
or converted into `issue_custom_order_quote`; it must never set `status = pending`,
`Scheduled`, or `awaiting_payment` by itself.

### Pricing prerequisite

`private.reprice_order` is currently the sole owner of total/promotion arithmetic,
but it is deliberately **not** a read-only calculator: it locks and updates `orders`,
and can credit a customer's wallet when repricing reduces wallet usage. An offered
quote must not perform either side effect before the customer accepts it.

Before implementing `issue_custom_order_quote`, extract the pricing arithmetic into a
pure, side-effect-free snapshot helper (or equivalent query) that returns the subtotal,
fees, promotion splits, wallet contribution, and total for supplied inputs. The issue
transition writes that returned snapshot into `order_quotes`; acceptance is the first
point allowed to copy it to `orders` and perform the corresponding ledger mutation.

Do not call `reprice_order` simply to calculate an offered quote and then try to undo
its writes. That would create an observable financial mutation and a retry hazard.

## Exact local touchpoints

| Area | Current file | Required direction |
| --- | --- | --- |
| Core transaction rules | `supabase/migrations/20260820130000_quote_acceptance_state_machine.sql` | Local additive draft: quote records, transition guards, canonical audit events, RLS, notifications, and compatibility mapping. |
| Quote API | `supabase/functions/quote-operations/index.ts` | Local draft for issue, view, accept, and reject; validates request shape and delegates authorization to database transitions. |
| Client API | `src/lib/quoteOperations.ts` | Typed local wrapper shared by supervisor and customer flows. |
| Supervisor UI | `src/pages/Supervisor.tsx` | Change “confirm price” language/action to “send quote”; display offered/accepted/expired states. |
| Admin UI | `src/pages/Admin.tsx` | Expose quote state and version; forbid dispatch while quote is not accepted. |
| Customer tracking | `src/pages/Track.tsx` | Show frozen quote breakdown, expiry, and explicit Accept / Reject choices. |
| Order history | `src/pages/MyOrders.tsx`, `src/pages/Profile.tsx` | Render quote state rather than treating staff-confirmed price as final. |
| Vendor board | `src/pages/Vendor.tsx` and vendor query/RPCs | Exclude every custom order except quote `accepted` with payment conditions satisfied. |
| Type contract | `src/lib/types.ts`, `supabase/baseline/database.types.ts` | Add quote entities/states after schema is finalized; generate types rather than hand-editing generated output. |

## Transition guards to preserve

1. `pending` custom quote: no vendor visibility, acceptance, readiness, assignment,
   or payment demand.
2. `offered` custom quote: only customer accept/reject/allowed cancellation; a later
   quote creates a new version rather than updating amounts in place.
3. `accepted` quote: payment policy is calculated from the frozen quote snapshot,
   including the configured deposit percentage and threshold.
4. Only accepted + payment-satisfied orders move to vendor fulfilment.
5. Cancellation, repricing, refund, and a retried HTTP request cannot create duplicate
   quotes, payment attempts, audit events, or notifications.

## Tests required before any deployment request

`npm run check:quote-state` is a dependency-free local regression check for the
draft’s structural invariants. It complements, but does not replace, the
behavioural database tests below.

- A quote issue does not move the order to vendor fulfilment or create a payable.
- Reissuing identical frozen terms while an offer is live returns that version;
  it does not reset the 15-minute deadline or send another “quote ready” push.
- Customer acceptance is owner-only, requires the current unexpired version, and is
  idempotent.
- Acceptance creates the correct deposit/full-payment requirement from the frozen
  snapshot, not a changed setting or recalculated promotion.
- Rejection, expiry, cancellation, and reissue release/reconcile promo reservations
  once only.
- An accept or reject request arriving exactly after expiry persists the same
  single expired state/event/notification as the scheduled sweep; it must not
  roll the transition back by returning an uncaught database exception.
- A vendor cannot query or act on `pending` or `offered` custom orders.
- Dispatch cannot assign an unaccepted or unpaid-as-required custom order, even
  if a caller bypasses the staff-board UI.
- A vendor RPC cannot advance `kitchen_status` for an unaccepted or
  `awaiting_payment` custom order; cancellation is still allowed.
- Legacy catalogue and pickup flows pass unchanged.
- Existing `pending_quote` and historical `confirmed` orders retain their meaning.
- New catalogue and custom-request orders receive `not_required` and `pending`
  quote states respectively; historical staff-confirmed custom orders stay NULL
  until intentionally reconciled.
- An order cannot point `current_quote_id` at a quote belonging to another
  order.
- Reissuing an outstanding offer appends a `quote.superseded` event before
  creating the next immutable version.
- With a registered, permissioned customer push token: issuing a quote sends one
  “quote ready” push; the sweep sends one reminder in the final two minutes and
  one expiry push after the deadline. Re-running the sweep must not duplicate
  either reminder or expiry notification.

### Physical-device push evidence

This cannot be substituted with an HTTP success response or an emulator. On one
permissioned customer device using a non-production build, retain the order ID,
quote ID, platform, permission state, and timestamp for each result:

1. Enable notifications from the order tracking link and confirm the customer
   token is stored for that exact order.
2. Issue an offer and verify exactly one “quote ready” notification opens the
   matching tracking link.
3. Keep the offer open until the final two minutes; run or wait for the sweep
   and verify exactly one reminder.
4. Background the app, then lock the device, and repeat the reminder/expiry
   observation. The notification must still be displayed and open the order.
5. Allow expiry, verify exactly one terminal expiry notification, then re-run
   the sweep and verify neither reminder nor expiry is duplicated.

Record a failure separately for: missing permission/token, function delivery
failure, device/OS presentation failure, incorrect deep link, and duplicate
delivery. Do not treat any as release-ready until reproduced or explained.

## Product policy

1. **Decided:** a quote expires after **15 minutes**. Expiry leaves the request
   re-quotable; it does not auto-cancel the order.
2. **Decided:** every material change—including a lower price—creates a new
   immutable version and requires customer re-acceptance. An accepted quote is
   not repriced in place.
3. **Decided:** totals above **3,000 EGP** require an Admin to issue the quote.
   The Class-A setting `quote_admin_approval_ceiling_egp` owns this policy.
4. Payment policy after acceptance: confirmed current policy is COD over the portal
   threshold requires an InstaPay deposit equal to the configured percentage of the
   frozen total; decide whether online/other methods need distinct treatment.

## Safe sequence once local draft review is authorized

1. Review the local additive migration and transition contract.
2. Run local checks and a migration dry-run against an approved non-production environment.
3. Generate database types and run the listed behavioural tests.
4. Present the reviewed diff, test evidence, and a separate deployment request.
