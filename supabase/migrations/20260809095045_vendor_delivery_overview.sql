-- Give a vendor the small slice of courier information needed to run its
-- kitchen board without granting access to the courier or assignment tables.
-- The restaurant is always derived from the signed-in account.
create or replace function public.vendor_delivery_overview(
  p_order_ids integer[] default null
)
returns table (
  order_id integer,
  status text,
  driver_name text,
  driver_phone text,
  arrived_at_restaurant_at timestamptz,
  out_for_delivery_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_restaurant_id integer;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  v_restaurant_id := public.my_restaurant_id();
  if v_restaurant_id is null then
    raise exception 'not_a_vendor';
  end if;

  if p_order_ids is not null and cardinality(p_order_ids) > 100 then
    raise exception 'too_many_orders';
  end if;

  return query
  select latest.order_id,
         latest.status,
         coalesce(d.name, 'المندوب')::text as driver_name,
         case when latest.status = 'Delivered' then null else d.phone end::text as driver_phone,
         latest.arrived_at_restaurant_at,
         latest.out_for_delivery_at
    from (
      select distinct on (da.order_id)
             da.order_id,
             da.driver_id,
             da.status,
             da.arrived_at_restaurant_at,
             da.out_for_delivery_at
        from public.delivery_assignments da
        join public.orders o on o.id = da.order_id
       where o.restaurant_id = v_restaurant_id
         and da.status in ('Accepted', 'Picked_Up', 'Out_for_Delivery', 'Delivered')
         and (p_order_ids is null or da.order_id = any (p_order_ids))
       order by da.order_id, da.attempt_number desc, da.id desc
       limit 100
    ) latest
    left join public.drivers d on d.id = latest.driver_id;
end;
$function$;

revoke all on function public.vendor_delivery_overview(integer[]) from public, anon;
grant execute on function public.vendor_delivery_overview(integer[]) to authenticated, service_role;

-- This policy never worked because vendors cannot read delivery_assignments.
-- Removing it also prevents a future assignment-policy change from exposing
-- every sensitive driver column through the Data API.
drop policy if exists "vendor reads assigned drivers" on public.drivers;

do $assertions$
begin
  if has_function_privilege('anon', 'public.vendor_delivery_overview(integer[])', 'execute') then
    raise exception 'anon must not execute vendor_delivery_overview';
  end if;
  if not has_function_privilege('authenticated', 'public.vendor_delivery_overview(integer[])', 'execute') then
    raise exception 'authenticated must execute vendor_delivery_overview';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'drivers'
       and policyname = 'vendor reads assigned drivers'
  ) then
    raise exception 'obsolete vendor driver policy still exists';
  end if;
end;
$assertions$;
