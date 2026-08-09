-- The customer application reads exactly three settings from the Data API.
-- The previous USING (true) policy also exposed driver compensation, bonus
-- targets, dispatch thresholds, and SLA internals to every anonymous caller.

revoke insert, update, delete, truncate, references, trigger
on table public.settings
from anon;

drop policy if exists "public read settings" on public.settings;
create policy "public reads customer settings"
on public.settings
for select
to anon, authenticated
using (
  key = any (array[
    'cod_deposit_threshold_egp',
    'service_fee_percent',
    'sms_login_enabled'
  ]::text[])
);

-- Keep the privileged policy away from anon entirely. If a PUBLIC policy calls
-- is_admin(), Postgres may evaluate it for anonymous reads and fail with
-- permission_denied instead of simply hiding the internal rows.
drop policy if exists "admin writes settings" on public.settings;
create policy "admin manages settings"
on public.settings
for all
to authenticated
using (is_admin())
with check (is_admin());

do $assert_settings_privacy$
declare
  v_roles name[];
  v_qual text;
begin
  if has_table_privilege('anon', 'public.settings', 'insert')
     or has_table_privilege('anon', 'public.settings', 'update')
     or has_table_privilege('anon', 'public.settings', 'delete')
     or has_table_privilege('anon', 'public.settings', 'truncate')
     or has_table_privilege('anon', 'public.settings', 'references')
     or has_table_privilege('anon', 'public.settings', 'trigger') then
    raise exception 'anonymous settings write privileges remain';
  end if;
  if not has_table_privilege('anon', 'public.settings', 'select') then
    raise exception 'customer settings are no longer readable';
  end if;

  select roles, qual into v_roles, v_qual
    from pg_policies
   where schemaname = 'public'
     and tablename = 'settings'
     and policyname = 'public reads customer settings';

  if v_roles is distinct from array['anon', 'authenticated']::name[]
     or v_qual not like '%cod_deposit_threshold_egp%'
     or v_qual not like '%service_fee_percent%'
     or v_qual not like '%sms_login_enabled%'
     or v_qual like '%is_admin()%' then
    raise exception 'settings read policy does not match the approved boundary';
  end if;

  select roles, qual into v_roles, v_qual
    from pg_policies
   where schemaname = 'public'
     and tablename = 'settings'
     and policyname = 'admin manages settings';
  if v_roles is distinct from array['authenticated']::name[]
     or v_qual not like '%is_admin()%' then
    raise exception 'settings admin policy does not match the approved boundary';
  end if;
end;
$assert_settings_privacy$;
