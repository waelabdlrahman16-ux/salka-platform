-- Batch 7: remove SELECT grants that do nothing except create future risk.
--
-- These seven tables have RLS enabled and ZERO policies, which already denies
-- every row to anon and authenticated. Verified empirically before writing this:
-- each was queried through PostgREST as a real anonymous client and returned [].
-- The SELECT grant is therefore inert today -- and one accidental
-- `create policy ... for select using (true)` away from publishing OTP codes,
-- session tokens and customer PII.
--
-- Nothing reads these tables through the grant:
--   * 0 references anywhere in src/ (checked `.from('<table>')` for all twelve)
--   * every real reader is a SECURITY DEFINER function, which executes as owner
--     and never consults the caller's grant
--
-- The five remaining policy-free tables (_mcd_menu_backup_20260806,
-- dead_push_tokens, push_nudge, push_send_log, rate_limit_log) already have no
-- such grant and are untouched.
--
-- This does NOT clear the twelve rls_enabled_no_policy INFO notices. Those are
-- accepted by design: access is via definer functions, so policies would be
-- dead weight. See supabase/baseline/ACCEPTED-WARNINGS.md.
--
-- ROLLBACK: grant select on the same seven tables back to anon, authenticated.

revoke select on
  public.customers,
  public.customer_sessions,
  public.customer_otp_codes,
  public.customer_addresses,
  public.order_status_events,
  public.driver_shift_bonuses,
  public.request_item_suppressions
from anon, authenticated;

do $v$
declare
  t text;
  targets text[] := array[
    'public.customers',
    'public.customer_sessions',
    'public.customer_otp_codes',
    'public.customer_addresses',
    'public.order_status_events',
    'public.driver_shift_bonuses',
    'public.request_item_suppressions'
  ];
  guarded text[] := array[
    'public.is_admin()',
    'public.my_driver_id()',
    'public.is_catalog_manager()',
    'public.is_supervisor()',
    'public.my_restaurant_id()',
    'public.supervisor_may_touch_order(integer)',
    'public.my_customer_id()'
  ];
begin
  -- 1. anon and authenticated must not be able to read any of the seven.
  foreach t in array targets loop
    if has_table_privilege('anon', t, 'select') then
      raise exception 'anon can still select %', t;
    end if;
    if has_table_privilege('authenticated', t, 'select') then
      raise exception 'authenticated can still select %', t;
    end if;
  end loop;

  -- 2. RLS must still be on with no policy, so the definer-only model holds.
  foreach t in array targets loop
    if not (select c.relrowsecurity from pg_class c where c.oid = t::regclass) then
      raise exception 'RLS is no longer enabled on %', t;
    end if;
    if (select count(*) from pg_policy p where p.polrelid = t::regclass) > 0 then
      raise exception 'a policy now exists on % -- re-verify anon cannot read it', t;
    end if;
  end loop;

  -- 3. The seven RLS-critical predicates must keep authenticated EXECUTE, or
  --    vendor, supervisor, driver and admin reads go dark. is_admin() alone
  --    backs 43 policies across 32 tables.
  foreach t in array guarded loop
    if not has_function_privilege('authenticated', t, 'execute') then
      raise exception 'RLS predicate % lost authenticated execute', t;
    end if;
  end loop;

  -- 4. service_role must still reach the tables the Edge Functions read.
  foreach t in array targets loop
    if not has_table_privilege('service_role', t, 'select') then
      raise exception 'service_role lost select on %', t;
    end if;
  end loop;
end $v$;
