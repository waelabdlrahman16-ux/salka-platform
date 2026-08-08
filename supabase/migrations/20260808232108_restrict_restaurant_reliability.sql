-- restaurant_reliability reads order history with owner privileges. Keep the
-- vendor dashboard working, but do not let an arbitrary signed-in account use
-- a restaurant id to inspect another vendor's private operating metrics.
create or replace function public.restaurant_reliability(
  p_restaurant_id integer
)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if p_restaurant_id is null then
    raise exception 'restaurant_required';
  end if;

  if not public.is_admin()
     and p_restaurant_id is distinct from public.my_restaurant_id() then
    raise exception 'not_authorized';
  end if;

  return json_build_object(
    'avg_accept_minutes', (
      select round(
        avg(extract(epoch from (o.vendor_accepted_at - o.created_at)) / 60)::numeric,
        1
      )
      from public.orders o
      where o.restaurant_id = p_restaurant_id
        and o.vendor_accepted_at is not null
        and o.created_at > now() - interval '30 days'
    ),
    'slow_accepts', (
      select count(*)
      from public.orders o
      where o.restaurant_id = p_restaurant_id
        and o.vendor_accepted_at is not null
        and o.created_at > now() - interval '30 days'
        and extract(epoch from (o.vendor_accepted_at - o.created_at)) / 60 > 5
    ),
    'total_orders', (
      select count(*)
      from public.orders o
      where o.restaurant_id = p_restaurant_id
        and o.created_at > now() - interval '30 days'
    )
  );
end;
$function$;

revoke all on function public.restaurant_reliability(integer)
  from public, anon, authenticated;
grant execute on function public.restaurant_reliability(integer)
  to authenticated, service_role;

do $verification$
begin
  if has_function_privilege(
       'anon', 'public.restaurant_reliability(integer)', 'execute'
     ) then
    raise exception 'anonymous restaurant analytics grant remains';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.restaurant_reliability(integer)',
       'execute'
     ) then
    raise exception 'vendor restaurant analytics grant is missing';
  end if;

  if exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) acl
    where p.oid = 'public.restaurant_reliability(integer)'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'implicit public restaurant analytics grant remains';
  end if;
end
$verification$;
