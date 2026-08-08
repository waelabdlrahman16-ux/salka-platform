-- Order history contains restaurants, dates, totals and live tracking tokens.
-- A phone number is an identifier, not proof of ownership, so resolve the
-- lookup phone only from a valid Salka customer session or Supabase Auth user.
create or replace function public.my_orders(
  p_phone text,
  p_session_token uuid default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone text;
begin
  if p_session_token is not null then
    select c.phone into v_phone
      from customer_sessions cs
      join customers c on c.id = cs.customer_id
     where cs.token = p_session_token
       and cs.expires_at > now();
  end if;

  if v_phone is null and auth.uid() is not null then
    select c.phone into v_phone
      from customers c
     where c.auth_user_id = auth.uid()
       and coalesce(c.phone, '') <> ''
     limit 1;
  end if;

  if v_phone is null then raise exception 'not_logged_in'; end if;
  v_phone := normalize_phone(v_phone);

  return (
    select coalesce(json_agg(row_to_json(x)), '[]'::json)
      from (
        select o.id,
               o.public_token,
               o.total,
               o.status,
               o.created_at,
               coalesce(o.pricing_status, 'n/a') as pricing_status,
               r.name as restaurant_name
          from orders o
          join restaurants r on r.id = o.restaurant_id
         where normalize_phone(o.customer_phone) = v_phone
           and o.created_at > now() - interval '30 days'
         order by o.id desc
         limit 20
      ) x
  );
end;
$function$;

revoke all on function public.my_orders(text,uuid) from public;
grant execute on function public.my_orders(text,uuid)
  to anon, authenticated, service_role;

do $verification$
begin
  if not has_function_privilege(
       'anon', 'public.my_orders(text,uuid)', 'execute'
     ) then
    raise exception 'legacy customer sessions cannot reach order history';
  end if;
  if exists (
    select 1
      from pg_proc p
      cross join lateral aclexplode(
        coalesce(p.proacl, acldefault('f', p.proowner))
      ) acl
     where p.oid = 'public.my_orders(text,uuid)'::regprocedure
       and acl.grantee = 0
       and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'implicit public order-history grant remains';
  end if;
end
$verification$;
