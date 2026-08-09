-- Route admin_set_vendor_slots through the admin-account-driver-actions Edge
-- Function, the same shape as every other privileged admin call.
--
-- The function already refuses a non-admin with `admin_only`, so this is not
-- closing an open door. What it closes is the last one flagged by the
-- authenticated SECURITY DEFINER advisor after batch 5: it arrived outside the
-- batch process and so never got input validation, a rate limit, or an audited
-- caller. It is the single warning standing between 65 and the 64 that PR #47
-- predicted.
--
-- APPLY ONLY AFTER THE FRONTEND IN THIS PR IS LIVE. The public wrapper gains a
-- third argument, so an Admin page still on the old bundle would call a
-- two-argument function that no longer exists in `public`.

create schema if not exists private;
revoke all on schema private from public;

alter function public.admin_set_vendor_slots(integer, boolean) set schema private;
revoke all on function private.admin_set_vendor_slots(integer, boolean) from public, anon, authenticated;

create function public.admin_set_vendor_slots(
  p_restaurant_id integer, p_enabled boolean, p_auth_user_id uuid default null
) returns boolean language plpgsql security definer set search_path = 'public' as $f$
declare r boolean;
begin
  perform set_config('request.jwt.claim.sub', p_auth_user_id::text, true);
  select private.admin_set_vendor_slots(p_restaurant_id, p_enabled) into r;
  return r;
end $f$;

revoke all on function public.admin_set_vendor_slots(integer, boolean, uuid) from public, anon, authenticated;
grant execute on function public.admin_set_vendor_slots(integer, boolean, uuid) to service_role;

do $v$
declare s text := 'public.admin_set_vendor_slots(integer,boolean,uuid)';
begin
  if has_function_privilege('authenticated', s, 'execute')
     or has_function_privilege('anon', s, 'execute')
     or not has_function_privilege('service_role', s, 'execute') then
    raise exception 'invalid admin vendor slots wrapper %', s;
  end if;
end $v$;
