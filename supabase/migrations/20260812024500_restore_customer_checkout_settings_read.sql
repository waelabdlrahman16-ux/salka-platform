-- Checkout reads these values anonymously before an order exists.  Do not
-- combine the public predicate with is_admin(): a SECURITY DEFINER role helper
-- may be evaluated for an anonymous request before PostgreSQL short-circuits
-- the public key predicate, causing checkout pricing to fail closed.

drop policy if exists "settings_read" on public.settings;
drop policy if exists "public reads customer settings" on public.settings;
drop policy if exists "settings_customer_read" on public.settings;
drop policy if exists "settings_admin_read" on public.settings;

-- The only settings a customer is allowed to read.  This policy intentionally
-- contains no role helper so it is safe for both guest and signed-in customer
-- requests.
create policy "settings_customer_read" on public.settings for select
  to anon, authenticated
  using (
    key = any (array[
      'cod_deposit_threshold_egp',
      'service_fee_percent',
      'sms_login_enabled'
    ]::text[])
  );

-- Admins also need the internal settings, but their privileged predicate must
-- remain in a policy that anonymous requests can never evaluate.
create policy "settings_admin_read" on public.settings for select
  to authenticated
  using (is_admin());

do $assert_checkout_settings_read$
declare
  v_customer_roles name[];
  v_customer_qual text;
  v_admin_roles name[];
  v_admin_qual text;
begin
  if not has_table_privilege('anon', 'public.settings', 'select') then
    raise exception 'anonymous checkout can no longer read approved settings';
  end if;

  select roles, qual into v_customer_roles, v_customer_qual
    from pg_policies
   where schemaname = 'public'
     and tablename = 'settings'
     and policyname = 'settings_customer_read';

  if v_customer_roles is distinct from array['anon', 'authenticated']::name[]
     or v_customer_qual not like '%cod_deposit_threshold_egp%'
     or v_customer_qual not like '%service_fee_percent%'
     or v_customer_qual not like '%sms_login_enabled%'
     or v_customer_qual like '%is_admin()%' then
    raise exception 'customer settings policy is not checkout-safe';
  end if;

  select roles, qual into v_admin_roles, v_admin_qual
    from pg_policies
   where schemaname = 'public'
     and tablename = 'settings'
     and policyname = 'settings_admin_read';

  if v_admin_roles is distinct from array['authenticated']::name[]
     or v_admin_qual not like '%is_admin()%' then
    raise exception 'admin settings read policy is not isolated';
  end if;
end;
$assert_checkout_settings_read$;
