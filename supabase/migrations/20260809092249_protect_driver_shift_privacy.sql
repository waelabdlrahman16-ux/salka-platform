-- Open swap requests contain a driver's ID, personal reason, and timestamps;
-- the matching shift contains their work date and hours. Both policies were
-- created for PUBLIC, and the tables still have SELECT grants for anon, so an
-- unauthenticated Data API caller could read every future open swap.

drop policy if exists "read swap requests" on public.shift_swap_requests;
create policy "read swap requests"
on public.shift_swap_requests
for select
to authenticated
using (
  is_admin()
  or requested_by = my_driver_id()
  or (my_driver_id() is not null and status = 'open')
);

drop policy if exists "driver reads open swap shifts" on public.shifts;
create policy "driver reads open swap shifts"
on public.shifts
for select
to authenticated
using (
  my_driver_id() is not null
  and exists (
    select 1
      from public.shift_swap_requests r
     where r.shift_id = shifts.id
       and r.status = 'open'
  )
);

do $assert_driver_shift_privacy$
declare
  v_roles name[];
  v_qual text;
begin
  select roles, qual into v_roles, v_qual
    from pg_policies
   where schemaname = 'public'
     and tablename = 'shift_swap_requests'
     and policyname = 'read swap requests';
  if v_roles is distinct from array['authenticated']::name[]
     or v_qual not like '%my_driver_id() IS NOT NULL%' then
    raise exception 'open swap requests are not restricted to authenticated drivers';
  end if;

  select roles, qual into v_roles, v_qual
    from pg_policies
   where schemaname = 'public'
     and tablename = 'shifts'
     and policyname = 'driver reads open swap shifts';
  if v_roles is distinct from array['authenticated']::name[]
     or v_qual not like '%my_driver_id() IS NOT NULL%' then
    raise exception 'open swap shifts are not restricted to authenticated drivers';
  end if;
end;
$assert_driver_shift_privacy$;
