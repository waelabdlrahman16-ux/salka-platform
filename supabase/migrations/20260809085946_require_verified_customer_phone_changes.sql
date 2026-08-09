-- A Supabase-authenticated customer could previously assign any syntactically
-- valid phone number to their profile. The function then adopted every guest
-- order with that number, even though the caller had never proved possession.
-- Keep the state change behind the OTP Edge Function, which validates the SMS
-- code and calls this service-role-only routine with the verified identity.

revoke all on function public.update_my_customer_phone(text) from public, anon, authenticated;

create or replace function public.set_verified_customer_phone(
  p_auth_user_id uuid,
  p_phone text
)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_customer_id integer;
  v_phone text;
  v_owner integer;
  v_claimed integer;
begin
  if p_auth_user_id is null then raise exception 'not_logged_in'; end if;

  v_phone := normalize_phone(p_phone);
  if v_phone is null or v_phone !~ '^1[0-25][0-9]{8}$' then
    raise exception 'invalid_phone';
  end if;

  select id into v_customer_id
    from customers
   where auth_user_id = p_auth_user_id;
  if v_customer_id is null then raise exception 'customer_not_found'; end if;

  select id into v_owner from customers where phone = v_phone;
  if v_owner is not null and v_owner <> v_customer_id then
    raise exception 'phone_already_registered';
  end if;

  update customers set phone = v_phone where id = v_customer_id;

  update orders
     set customer_id = v_customer_id
   where customer_id is null
     and normalize_phone(customer_phone) = v_phone;
  get diagnostics v_claimed = row_count;

  return json_build_object(
    'customer_id', v_customer_id,
    'phone', v_phone,
    'claimed_orders', v_claimed
  );
end;
$function$;

revoke all on function public.set_verified_customer_phone(uuid, text) from public, anon, authenticated;
grant execute on function public.set_verified_customer_phone(uuid, text) to service_role;

comment on function public.set_verified_customer_phone(uuid, text) is
  'Internal OTP-completion step. Callable only by service_role after the customer-otp Edge Function validates phone possession.';

do $assert_permissions$
begin
  if has_function_privilege('anon', 'public.update_my_customer_phone(text)', 'execute')
     or has_function_privilege('authenticated', 'public.update_my_customer_phone(text)', 'execute') then
    raise exception 'unsafe direct phone update remains executable';
  end if;
  if has_function_privilege('anon', 'public.set_verified_customer_phone(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.set_verified_customer_phone(uuid,text)', 'execute') then
    raise exception 'verified phone completion must remain internal';
  end if;
  if not has_function_privilege('service_role', 'public.set_verified_customer_phone(uuid,text)', 'execute') then
    raise exception 'OTP service cannot complete verified phone changes';
  end if;
end;
$assert_permissions$;
