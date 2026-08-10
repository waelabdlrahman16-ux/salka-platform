-- Customer history supports two real authentication systems: legacy SMS
-- session tokens and Supabase Auth (Google/email). The Edge Function verifies
-- either credential and passes the verified auth user id explicitly; only its
-- service role can execute these privileged database functions.

create function public.last_address_for_phone(
  p_phone text,
  p_session_token uuid,
  p_auth_user_id uuid
) returns json
language plpgsql stable security definer set search_path = 'public'
as $function$
declare v_phone text;
begin
  if p_session_token is not null then
    select c.phone into v_phone
      from customer_sessions cs join customers c on c.id = cs.customer_id
     where cs.token = p_session_token and cs.expires_at > now();
  end if;
  if v_phone is null and p_auth_user_id is not null then
    select c.phone into v_phone from customers c
     where c.auth_user_id = p_auth_user_id and coalesce(c.phone, '') <> '' limit 1;
  end if;
  if v_phone is null then return null; end if;
  if normalize_phone(v_phone) <> normalize_phone(p_phone) then return null; end if;
  return (
    select row_to_json(x) from (
      select o.zone, o.compound_id, o.unit_number, o.address_notes, o.customer_name
        from orders o
       where normalize_phone(o.customer_phone) = normalize_phone(v_phone)
       order by o.created_at desc limit 1
    ) x
  );
end
$function$;

create function public.my_last_request(
  p_restaurant_id integer,
  p_session_token uuid,
  p_auth_user_id uuid
) returns json
language plpgsql stable security definer set search_path = 'public'
as $function$
declare v_phone text;
begin
  if p_session_token is not null then
    select c.phone into v_phone
      from customer_sessions cs join customers c on c.id = cs.customer_id
     where cs.token = p_session_token and cs.expires_at > now();
  end if;
  if v_phone is null and p_auth_user_id is not null then
    select c.phone into v_phone from customers c
     where c.auth_user_id = p_auth_user_id and coalesce(c.phone, '') <> '' limit 1;
  end if;
  if v_phone is null then return 'null'::json; end if;
  return coalesce((
    select row_to_json(x) from (
      select o.id, o.created_at, o.request_items
        from orders o
       where o.restaurant_id = p_restaurant_id
         and normalize_phone(o.customer_phone) = normalize_phone(v_phone)
         and o.order_type = 'custom_request'
         and jsonb_array_length(coalesce(o.request_items,'[]'::jsonb)) > 0
       order by o.created_at desc limit 1
    ) x
  ), 'null'::json);
end
$function$;

create function public.my_orders(
  p_phone text,
  p_session_token uuid,
  p_auth_user_id uuid
) returns json
language plpgsql security definer set search_path = 'public'
as $function$
declare v_phone text;
begin
  if p_session_token is not null then
    select c.phone into v_phone
      from customer_sessions cs join customers c on c.id = cs.customer_id
     where cs.token = p_session_token and cs.expires_at > now();
  end if;
  if v_phone is null and p_auth_user_id is not null then
    select c.phone into v_phone from customers c
     where c.auth_user_id = p_auth_user_id and coalesce(c.phone, '') <> '' limit 1;
  end if;
  if v_phone is null then raise exception 'not_logged_in'; end if;
  v_phone := normalize_phone(v_phone);
  return (
    select coalesce(json_agg(row_to_json(x)), '[]'::json)
      from (
        select o.id, o.public_token, o.total, o.status, o.created_at,
               coalesce(o.pricing_status, 'n/a') as pricing_status,
               r.name as restaurant_name
          from orders o join restaurants r on r.id = o.restaurant_id
         where normalize_phone(o.customer_phone) = v_phone
           and o.created_at > now() - interval '30 days'
         order by o.id desc limit 20
      ) x
  );
end
$function$;

create function public.wallet_balance_for_phone(
  p_phone text,
  p_session_token uuid,
  p_auth_user_id uuid
) returns numeric
language plpgsql stable security definer set search_path = 'public'
as $function$
declare v_phone text;
begin
  if p_session_token is not null then
    select c.phone into v_phone
      from customer_sessions cs join customers c on c.id = cs.customer_id
     where cs.token = p_session_token and cs.expires_at > now();
  end if;
  if v_phone is null and p_auth_user_id is not null then
    select c.phone into v_phone from customers c
     where c.auth_user_id = p_auth_user_id and coalesce(c.phone, '') <> '' limit 1;
  end if;
  if v_phone is null then return 0; end if;
  if normalize_phone(v_phone) <> normalize_phone(p_phone) then return 0; end if;
  return coalesce((select balance from customer_wallets where phone = normalize_phone(v_phone)), 0);
end
$function$;

drop function public.last_address_for_phone(text, uuid);
drop function public.my_last_request(integer, uuid);
drop function public.my_orders(text, uuid);
drop function public.wallet_balance_for_phone(text, uuid);

revoke execute on function public.last_address_for_phone(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.my_last_request(integer, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.my_orders(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.wallet_balance_for_phone(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.session_logout(uuid) from public, anon, authenticated;
revoke execute on function public.session_whoami(uuid) from public, anon, authenticated;

grant execute on function public.last_address_for_phone(text, uuid, uuid) to service_role;
grant execute on function public.my_last_request(integer, uuid, uuid) to service_role;
grant execute on function public.my_orders(text, uuid, uuid) to service_role;
grant execute on function public.wallet_balance_for_phone(text, uuid, uuid) to service_role;
grant execute on function public.session_logout(uuid) to service_role;
grant execute on function public.session_whoami(uuid) to service_role;

do $permissions_check$
declare v_signature text;
begin
  if to_regprocedure('public.last_address_for_phone(text,uuid)') is not null
     or to_regprocedure('public.my_last_request(integer,uuid)') is not null
     or to_regprocedure('public.my_orders(text,uuid)') is not null
     or to_regprocedure('public.wallet_balance_for_phone(text,uuid)') is not null then
    raise exception 'legacy customer history RPC overload remains exposed';
  end if;
  foreach v_signature in array array[
    'public.last_address_for_phone(text,uuid,uuid)',
    'public.my_last_request(integer,uuid,uuid)',
    'public.my_orders(text,uuid,uuid)',
    'public.wallet_balance_for_phone(text,uuid,uuid)',
    'public.session_logout(uuid)',
    'public.session_whoami(uuid)'
  ] loop
    if has_function_privilege('anon', v_signature, 'execute')
       or has_function_privilege('authenticated', v_signature, 'execute') then
      raise exception 'client role still has direct customer session access: %', v_signature;
    end if;
    if not has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'customer-session-access Edge Function lost database access: %', v_signature;
    end if;
  end loop;
end
$permissions_check$;
