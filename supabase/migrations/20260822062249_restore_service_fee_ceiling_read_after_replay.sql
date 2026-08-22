-- OUTAGE 2026-08-22 04:06 -> 06:22 UTC. Customers could not check out: the app
-- could not read service_fee_max_egp, so it could not compute the service fee.
--
-- Cause: merging a migration PR made the Supabase GitHub integration run every
-- migration file that had no row in supabase_migrations.schema_migrations. Seven
-- such files had been sitting in this repository unapplied, and one of them --
-- 20260812024500_restore_customer_checkout_settings_read -- recreates
-- settings_customer_read with the THREE keys that predate the service fee cap.
-- It ran at 04:06:38 and silently replaced the four-key policy that
-- 20260822005247 had installed hours earlier.
--
-- The lesson is not about this policy. It is that an unapplied migration file is
-- a landmine: it carries an old truth, and it detonates whenever something
-- decides to catch the ledger up. The seven are now all in the ledger, so they
-- cannot fire again -- but the same shape will recur for any file that is
-- committed and not applied.
drop policy if exists settings_customer_read on settings;
create policy settings_customer_read on settings
  for select
  using (key = any (array[
    'cod_deposit_threshold_egp','service_fee_percent','service_fee_max_egp','sms_login_enabled'
  ]));
