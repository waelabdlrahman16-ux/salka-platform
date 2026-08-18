# Fawaterak Payment Integration -- Readiness Note (2026-08-10)

## Status: Blocked on merchant paperwork, not on code

## Why this exists
Fawaterak (Egyptian payment gateway aggregator: Meeza, Fawry, InstaPay, cards,
wallets) is on the P3 backlog as "payment integration readiness." The merchant
account/paperwork with Fawaterak isn't finished, so no live integration or
credential wiring can start yet. This documents what's already in place and
what's still needed, so the moment paperwork closes this is a scoped task
rather than a cold start.

## Current payment state (no gateway today)
Payment is fully manual: `orders.payment_method` defaults to cash-on-delivery,
and the InstaPay path is a customer self-reporting a manual transfer to a
static handle (`src/lib/instapay.ts`), which an admin then reconciles by hand
(`admin-financial-actions` Edge Function). There is no outbound call to any
payment gateway anywhere in the codebase today.

## What's already in place
- **Schema**: the `orders` table already has `payment_mode`, `collect_amount`,
  `online_payment_status`, `fawaterak_invoice_id`, and `fawaterak_invoice_key`
  columns (added by a prior migration as groundwork, never wired to logic).
  No migration should be needed to start -- just logic to populate/transition
  these.
- **Secrets pattern**: server-side third-party keys are stored as Supabase
  function secrets and read via `Deno.env.get()` inside Edge Functions
  (established pattern: `SMSMISR_*`, `RESEND_API_KEY`, etc.) -- Fawaterak's API
  key and webhook secret would follow the same path, never reaching the
  client bundle.
- **Webhook template**: `send-push` and `send-receipt-email` Edge Functions
  already implement the shape a Fawaterak callback endpoint needs -- an
  unauthenticated POST verified by a shared secret header. Fawaterak's actual
  callback signature scheme isn't confirmed yet (their docs would need to be
  checked once the merchant account exists), but the endpoint pattern is
  proven in this codebase.

## What integration will actually touch (once unblocked)
1. New outbound Edge Function to create a Fawaterak invoice / hosted-checkout
   session server-side (API key never reaches the client).
2. New inbound Edge Function for Fawaterak's payment-confirmation webhook,
   adapting the existing shared-secret pattern to Fawaterak's real signature
   verification.
3. `CheckoutPage.tsx` update to redirect to the hosted checkout page and
   handle the return.
4. A `private`-schema Postgres function (matching this repo's
   authenticated/rate-limited Edge Function security posture) to transition
   `online_payment_status` on webhook confirmation.
5. Admin reconciliation UI: a "paid online" state needs to show up alongside
   the existing manual COD/InstaPay views.
6. Refund logic: none exists for any payment method today (cancellation only
   refunds internal wallet balance) -- a Fawaterak refund path is new,
   unbuilt territory and needs its own design.

## Verdict
Medium, well-contained project once unblocked -- roughly two new Edge
Functions, a checkout UI change, state-machine wiring onto already-existing
columns, an admin UI addition, and new refund logic. Not a rearchitecture.

## The moment paperwork closes
1. Get the Fawaterak API key and webhook signing secret, store as Supabase
   function secrets.
2. Confirm Fawaterak's actual webhook signature scheme from their merchant
   docs (not yet modeled in this codebase) and adapt the shared-secret
   pattern into real signature verification.
3. Decide on the full set of `online_payment_status` values and the admin
   reconciliation UX before writing code -- the columns exist but are
   currently unused by any code path, so nothing is locked in yet.
