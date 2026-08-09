-- A public order token is sufficient to follow a guest order, but it must not
-- also let a later visitor replace an already-registered notification device.
-- Keep guest opt-in and dead-token recovery working while requiring account
-- ownership for a change from one live destination to another.
create or replace function public.save_customer_push_token(
  p_token uuid,
  p_push_token text,
  p_platform text default 'web'
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_push_token text;
  v_order_id integer;
  v_existing_token text;
  v_customer_auth_user_id uuid;
  v_is_owner boolean;
begin
  if p_platform not in ('web','android','ios') then raise exception 'bad_platform'; end if;

  v_push_token := nullif(btrim(coalesce(p_push_token, '')), '');
  if v_push_token is null then raise exception 'empty_token'; end if;
  if length(v_push_token) > 4096 then raise exception 'token_too_long'; end if;

  if exists (select 1 from public.dead_push_tokens d where d.token = v_push_token) then
    return json_build_object('stored', false, 'stale', true, 'conflict', false);
  end if;

  -- Lock just the order row so simultaneous registrations cannot both observe
  -- an empty destination and silently replace one another.
  select o.id, o.push_token, c.auth_user_id
    into v_order_id, v_existing_token, v_customer_auth_user_id
    from public.orders o
    left join public.customers c on c.id = o.customer_id
   where o.public_token = p_token
   for update of o;

  if v_order_id is null then
    return json_build_object('stored', false, 'stale', false, 'conflict', false);
  end if;

  v_is_owner := auth.uid() is not null
                and auth.uid() = v_customer_auth_user_id;

  if v_existing_token is not null
     and v_existing_token is distinct from v_push_token
     and not v_is_owner then
    return json_build_object('stored', false, 'stale', false, 'conflict', true);
  end if;

  update public.orders
     set push_token = v_push_token,
         push_platform = p_platform
   where id = v_order_id;

  return json_build_object('stored', true, 'stale', false, 'conflict', false);
end;
$function$;

revoke all on function public.save_customer_push_token(uuid,text,text) from public;
grant execute on function public.save_customer_push_token(uuid,text,text)
  to anon, authenticated, service_role;

do $verification$
begin
  if not has_function_privilege(
      'anon',
      'public.save_customer_push_token(uuid,text,text)',
      'execute')
     or not has_function_privilege(
      'authenticated',
      'public.save_customer_push_token(uuid,text,text)',
      'execute')
     or not has_function_privilege(
      'service_role',
      'public.save_customer_push_token(uuid,text,text)',
      'execute') then
    raise exception 'customer push token application privileges are incomplete';
  end if;

  if exists (
    select 1
      from pg_proc p
      cross join lateral aclexplode(
        coalesce(p.proacl, acldefault('f', p.proowner))
      ) acl
     where p.oid =
       'public.save_customer_push_token(uuid,text,text)'::regprocedure
       and acl.grantee = 0
       and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'implicit public execute privilege remains';
  end if;
end
$verification$;
