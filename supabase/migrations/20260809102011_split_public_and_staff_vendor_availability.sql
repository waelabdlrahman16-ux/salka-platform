-- Public shopping screens need computed availability before a customer signs
-- in. Keep that response deliberately small and run it as the caller: both
-- source tables already expose only SELECT rows through RLS.
create or replace function public.vendor_open_states()
returns json
language sql
stable
security invoker
set search_path = public
as $function$
  select coalesce(json_agg(json_build_object(
           'id',           r.id,
           'is_open',      public.vendor_is_open_now(r.id),
           'next_open_at', public.vendor_next_open_at(r.id)
         )), '[]'::json)
  from public.restaurants r
  where not r.archived;
$function$;

revoke all on function public.vendor_open_states() from public;
grant execute on function public.vendor_open_states() to anon, authenticated, service_role;

-- Closure deadlines and schedule-configuration state are operational details,
-- so the admin screen gets them from a separately authorized endpoint.
create or replace function public.staff_vendor_open_states()
returns json
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null or not (public.is_admin() or public.is_supervisor()) then
    raise exception 'not_authorized';
  end if;

  return (
    select coalesce(json_agg(json_build_object(
             'id',           r.id,
             'is_open',      public.vendor_is_open_now(r.id),
             'next_open_at', public.vendor_next_open_at(r.id),
             'closed_until', r.closed_until,
             'has_hours',    exists (
               select 1 from public.vendor_hours vh where vh.restaurant_id = r.id
             )
           )), '[]'::json)
    from public.restaurants r
    where not r.archived
  );
end;
$function$;

revoke all on function public.staff_vendor_open_states() from public, anon;
grant execute on function public.staff_vendor_open_states() to authenticated, service_role;

do $assertions$
begin
  if not has_function_privilege('anon', 'public.vendor_open_states()', 'execute') then
    raise exception 'anon must execute safe vendor availability';
  end if;
  if (
    select p.prosecdef from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'vendor_open_states'
      and pg_get_function_identity_arguments(p.oid) = ''
  ) then
    raise exception 'public vendor availability must be security invoker';
  end if;
  if has_function_privilege('anon', 'public.staff_vendor_open_states()', 'execute') then
    raise exception 'anon must not execute staff vendor availability';
  end if;
end;
$assertions$;
