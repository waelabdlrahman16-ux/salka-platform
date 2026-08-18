# Orphan migrations from 2026-08-10 -- reconstruction record

Seven versions in `supabase_migrations.schema_migrations` were applied directly to production through the Supabase MCP connection and never committed to this repository as migration files. All seven were applied between 02:14 and 03:32 UTC on 2026-08-10, discovered during the P0 migration-filename reconciliation that produced [PR #59](https://github.com/waelabdlrahman16-ux/salka-platform/pull/59). This document is the recovery record for the two groups they split into.

## Group 1: card-redesign feature, built and reverted same session -- no file created

| Version | Name |
|---|---|
| `20260810021459` | `vendor_card_signals_and_open_reminders` |
| `20260810022022` | `fix_duplicate_open_reminders_on_null_contact` |
| `20260810022738` | `vendor_open_reminder_notifier_and_states` |
| `20260810022819` | `remind_me_when_open_takes_platform` |
| `20260810023256` | `revert_card_redesign_from_production` |

**Verified net effect on current schema: zero.** Queried live `pg_proc` and `information_schema.columns` for any function or column matching `%open_reminder%`, `%card_signal%`, or `%remind_me%` -- zero rows. Whatever this feature added, `revert_card_redesign_from_production` removed all of it.

**No file was created for these five versions.** The actual SQL that ran is not recoverable -- not in git history (checked in full, across all branches, before concluding this), and Postgres log retention available to this session does not reach back to 02:14–03:32 from the time of this reconstruction (~11:00 UTC same day; the log tool returns only the most recent ~15-minute window with no pagination control). Writing plausible-looking `.sql` files for a feature that was built and fully undone in the same session -- with no verifiable content -- would fabricate history in a directory whose entire purpose is an accurate recovery record. The gap is documented here instead, honestly, as agreed with the project owner rather than guessed at.

If the underlying feature (vendor card signals, open-now reminders) is wanted again, it should be designed and built fresh rather than resurrected from this gap.

## Group 2: two surviving bug fixes -- reconstructed as real migration files

| Version | Name | File |
|---|---|---|
| `20260810031422` | `fix_customer_arrival_push_sending_customers_to_driver_login` | `supabase/migrations/20260810031422_fix_customer_arrival_push_sending_customers_to_driver_login.sql` |
| `20260810031515` | `fix_all_customer_pushes_landing_on_driver_login` | `supabase/migrations/20260810031515_fix_all_customer_pushes_landing_on_driver_login.sql` |

Unlike Group 1, these two are **not** part of the revert -- they landed 40+ minutes after `revert_card_redesign_from_production` and their names describe a real, distinct bug: customer-facing push notifications were missing their tap-target link and falling through to the driver-login screen instead of the customer order-tracking page.

Both files were reconstructed from the **current, live** definitions of `public.notify_customer_driver_arrived()` and `public.notify_order_status_change()` -- not from recovered original SQL, which does not exist anywhere reachable. The match is high-confidence, not a guess:

- Both functions build a push payload with a `data.link` field pointing at `/track/<public_token>` (the customer tracking page).
- Both carry an inline code comment explicitly describing the bug these migration names name: `notify_customer_driver_arrived` says *"The tap target. Without it the service worker falls through to the driver board"*; `notify_order_status_change` says *"The tap target. public_token is on this same row."*
- No migration filed since either version touches either function (checked by grepping `supabase/migrations/` for both function names) -- confirming the live definition is exactly what these two fixes left behind, unmodified since.

Each reconstructed file carries the same disclosure inline: it reproduces today's verified live behavior, not the historical diff, because the historical diff is not recoverable. Applying either file to a fresh database reproduces current production behavior correctly.

## Why this split

Group 1 has zero live effect to recover -- any file would be undiscoverable content dressed as history. Group 2 has a real, currently-active effect that can be captured accurately from the live database, so reconstructing it as a migration file is grounded in verifiable fact rather than invention. Same underlying constraint, two different honest responses to it.
