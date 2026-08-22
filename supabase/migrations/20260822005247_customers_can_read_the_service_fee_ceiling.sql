-- The ceiling is half the price, so it has to be as readable as the percentage.
--
-- 20260822004717 added settings.service_fee_max_egp and made the client read both
-- halves of the fee policy. settings_customer_read whitelists keys one by one, and
-- the new key was not on the list -- so the browser asked for two rows, RLS returned
-- one, and src/lib/serviceFee.ts correctly refused to invent the missing half.
-- Checkout showed "مش قادرين نحسب رسوم الخدمة دلوقتي" and could not complete.
--
-- The server was never wrong: private.service_fee_for() runs SECURITY DEFINER and
-- was charging the capped 199 throughout. Only the display was blocked.
--
-- This is the same reason cod_deposit_threshold_egp and service_fee_percent are on
-- the list: a number the customer is charged is a number the customer may read.
-- Nothing internal is exposed -- the ceiling appears in every receipt that shows a
-- capped fee.
--
-- THE TEST THAT WOULD HAVE CAUGHT IT. The capped-fee migration was validated on a
-- throwaway Postgres as superuser, where RLS is never enforced, so a policy gap was
-- invisible by construction. Any change that adds a settings key the client reads
-- must be checked as the anon role:
--   set local role anon; select key from settings where key = '<new key>';
drop policy if exists settings_customer_read on settings;
create policy settings_customer_read on settings
  for select
  using (key = any (array[
    'cod_deposit_threshold_egp',
    'service_fee_percent',
    'service_fee_max_egp',
    'sms_login_enabled'
  ]));
