-- Order creation now enters through customer-order-creation. The Edge layer
-- verifies the caller, applies a global circuit breaker, and HMACs the phone
-- before this database layer stores a rate-limit key. These wrappers remain
-- SECURITY DEFINER because the reviewed pricing engines are private, but only
-- service_role can execute them.

drop function if exists public.place_order(
  integer,text,text,text,text,text,numeric,json,integer,date,integer,text,boolean,uuid,text
);
drop function if exists public.request_pickup(
  integer,text,text,text,text,text,numeric,text,numeric,text,integer,uuid
);
drop function if exists public.submit_custom_order(
  integer,text,text,text,text,text,numeric,json,text,integer,uuid,integer,date,text
);

create function public.place_order(
  p_restaurant_id integer, p_customer_name text, p_customer_phone text,
  p_zone text, p_unit_number text, p_address_notes text, p_delivery_fee numeric,
  p_items json, p_slot_id integer default null, p_scheduled_date date default null,
  p_compound_id integer default null, p_payment_method text default 'cod',
  p_use_wallet boolean default false, p_session_token uuid default null,
  p_customer_note text default null, p_rate_key text default null,
  p_auth_user_id uuid default null
) returns json
language plpgsql security definer set search_path to 'public'
as $function$
declare v_phone text; v_bucket text; v_recent integer; v_result json;
begin
  v_phone := normalize_phone(p_customer_phone);
  if length(btrim(coalesce(p_customer_name, ''))) not between 2 and 100 then raise exception 'invalid_customer_name'; end if;
  if v_phone is null or v_phone !~ '^1[0-25][0-9]{8}$' then raise exception 'invalid_phone'; end if;
  if length(btrim(coalesce(p_zone, ''))) not between 1 and 120 then raise exception 'invalid_zone'; end if;
  if length(btrim(coalesce(p_unit_number, ''))) not between 1 and 100 then raise exception 'invalid_unit_number'; end if;
  if length(coalesce(p_address_notes, '')) > 1000 or length(coalesce(p_customer_note, '')) > 1000 then raise exception 'notes_too_long'; end if;
  if p_items is null or json_typeof(p_items) <> 'array' then raise exception 'invalid_items'; end if;
  if json_array_length(p_items) not between 1 and 50 then raise exception 'invalid_item_count'; end if;
  if exists (select 1 from json_array_elements(p_items) item where
    not (coalesce(item->>'qty','') ~ '^[0-9]{1,3}$' and (item->>'qty')::numeric between 1 and 100)
  ) then raise exception 'invalid_item_quantity'; end if;
  if p_rate_key is null or p_rate_key !~ '^[0-9a-f]{64}$' then raise exception 'invalid_rate_key'; end if;

  v_bucket := 'order-hmac:' || p_rate_key;
  perform pg_advisory_xact_lock(hashtextextended(v_bucket, 0));
  select count(*) into v_recent from rate_limit_log where bucket = v_bucket and called_at > now() - interval '15 minutes';
  if v_recent >= 5 then raise exception 'order_rate_limit'; end if;
  select count(*) into v_recent from rate_limit_log where bucket = v_bucket and called_at > now() - interval '24 hours';
  if v_recent >= 20 then raise exception 'daily_order_limit'; end if;

  if p_auth_user_id is not null then
    perform set_config('request.jwt.claim.sub', p_auth_user_id::text, true);
  end if;
  v_result := private.place_order(
    p_restaurant_id,p_customer_name,v_phone,p_zone,p_unit_number,p_address_notes,
    p_delivery_fee,p_items,p_slot_id,p_scheduled_date,p_compound_id,p_payment_method,
    p_use_wallet,p_session_token,p_customer_note
  );
  insert into rate_limit_log(bucket) values(v_bucket);
  return v_result;
end $function$;

create function public.request_pickup(
  p_restaurant_id integer, p_customer_name text, p_customer_phone text,
  p_zone text, p_unit_number text, p_address_notes text, p_delivery_fee numeric,
  p_payment_mode text, p_collect_amount numeric, p_request_notes text,
  p_compound_id integer default null, p_session_token uuid default null,
  p_rate_key text default null, p_auth_user_id uuid default null
) returns json
language plpgsql security definer set search_path to 'public'
as $function$
declare v_phone text; v_bucket text; v_recent integer; v_result json;
begin
  v_phone := normalize_phone(p_customer_phone);
  if p_auth_user_id is null or not exists (
    select 1 from profiles where id = p_auth_user_id and role = 'vendor' and restaurant_id = p_restaurant_id
  ) then raise exception 'not_your_restaurant'; end if;
  if length(btrim(coalesce(p_customer_name, ''))) not between 2 and 100 then raise exception 'invalid_customer_name'; end if;
  if v_phone is null or v_phone !~ '^1[0-25][0-9]{8}$' then raise exception 'invalid_phone'; end if;
  if length(btrim(coalesce(p_zone, ''))) not between 1 and 120 then raise exception 'invalid_zone'; end if;
  if length(btrim(coalesce(p_unit_number, ''))) not between 1 and 100 then raise exception 'invalid_unit_number'; end if;
  if length(coalesce(p_address_notes, '')) > 1000 or length(coalesce(p_request_notes, '')) > 2000 then raise exception 'notes_too_long'; end if;
  if p_collect_amount = 'NaN'::numeric or coalesce(p_collect_amount,0) < 0 or coalesce(p_collect_amount,0) > 1000000 then raise exception 'invalid_collect_amount'; end if;
  if p_rate_key is null or p_rate_key !~ '^[0-9a-f]{64}$' then raise exception 'invalid_rate_key'; end if;

  v_bucket := 'order-hmac:' || p_rate_key;
  perform pg_advisory_xact_lock(hashtextextended(v_bucket, 0));
  select count(*) into v_recent from rate_limit_log where bucket = v_bucket and called_at > now() - interval '15 minutes';
  if v_recent >= 5 then raise exception 'order_rate_limit'; end if;
  select count(*) into v_recent from rate_limit_log where bucket = v_bucket and called_at > now() - interval '24 hours';
  if v_recent >= 20 then raise exception 'daily_order_limit'; end if;

  v_result := private.request_pickup(
    p_restaurant_id,p_customer_name,v_phone,p_zone,p_unit_number,p_address_notes,
    p_delivery_fee,p_payment_mode,p_collect_amount,p_request_notes,p_compound_id,p_session_token
  );
  insert into rate_limit_log(bucket) values(v_bucket);
  return v_result;
end $function$;

create function public.submit_custom_order(
  p_restaurant_id integer, p_customer_name text, p_customer_phone text,
  p_zone text, p_unit_number text, p_address_notes text, p_delivery_fee numeric,
  p_request_items json, p_request_notes text, p_compound_id integer default null,
  p_session_token uuid default null, p_slot_id integer default null,
  p_scheduled_date date default null, p_prescription_path text default null,
  p_rate_key text default null, p_auth_user_id uuid default null
) returns json
language plpgsql security definer set search_path to 'public'
as $function$
declare v_phone text; v_items json := coalesce(p_request_items,'[]'::json); v_bucket text; v_recent integer; v_result json;
begin
  v_phone := normalize_phone(p_customer_phone);
  if length(btrim(coalesce(p_customer_name, ''))) not between 2 and 100 then raise exception 'invalid_customer_name'; end if;
  if v_phone is null or v_phone !~ '^1[0-25][0-9]{8}$' then raise exception 'invalid_phone'; end if;
  if length(btrim(coalesce(p_zone, ''))) not between 1 and 120 then raise exception 'invalid_zone'; end if;
  if length(btrim(coalesce(p_unit_number, ''))) not between 1 and 100 then raise exception 'invalid_unit_number'; end if;
  if length(coalesce(p_address_notes, '')) > 1000 or length(coalesce(p_request_notes, '')) > 2000 then raise exception 'notes_too_long'; end if;
  if json_typeof(v_items) <> 'array' then raise exception 'invalid_items'; end if;
  if json_array_length(v_items) > 50 then raise exception 'invalid_item_count'; end if;
  if exists (select 1 from json_array_elements(v_items) item where json_typeof(item) <> 'object'
    or length(btrim(coalesce(item->>'name',''))) not between 1 and 200
    or not (coalesce(item->>'qty','') ~ '^[0-9]{1,3}$' and (item->>'qty')::numeric between 1 and 100)
  ) then raise exception 'invalid_item'; end if;
  if p_rate_key is null or p_rate_key !~ '^[0-9a-f]{64}$' then raise exception 'invalid_rate_key'; end if;

  v_bucket := 'order-hmac:' || p_rate_key;
  perform pg_advisory_xact_lock(hashtextextended(v_bucket, 0));
  select count(*) into v_recent from rate_limit_log where bucket = v_bucket and called_at > now() - interval '15 minutes';
  if v_recent >= 5 then raise exception 'order_rate_limit'; end if;
  select count(*) into v_recent from rate_limit_log where bucket = v_bucket and called_at > now() - interval '24 hours';
  if v_recent >= 20 then raise exception 'daily_order_limit'; end if;

  if p_auth_user_id is not null then perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); end if;
  v_result := private.submit_custom_order(
    p_restaurant_id,p_customer_name,v_phone,p_zone,p_unit_number,p_address_notes,
    p_delivery_fee,v_items,p_request_notes,p_compound_id,p_session_token,p_slot_id,
    p_scheduled_date,p_prescription_path
  );
  insert into rate_limit_log(bucket) values(v_bucket);
  return v_result;
end $function$;

revoke all on function public.place_order(integer,text,text,text,text,text,numeric,json,integer,date,integer,text,boolean,uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.request_pickup(integer,text,text,text,text,text,numeric,text,numeric,text,integer,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.submit_custom_order(integer,text,text,text,text,text,numeric,json,text,integer,uuid,integer,date,text,text,uuid) from public,anon,authenticated;
grant execute on function public.place_order(integer,text,text,text,text,text,numeric,json,integer,date,integer,text,boolean,uuid,text,text,uuid) to service_role;
grant execute on function public.request_pickup(integer,text,text,text,text,text,numeric,text,numeric,text,integer,uuid,text,uuid) to service_role;
grant execute on function public.submit_custom_order(integer,text,text,text,text,text,numeric,json,text,integer,uuid,integer,date,text,text,uuid) to service_role;

-- Remove the old clear-phone buckets. They are operational throttling records,
-- not order or revenue records, and keeping them would retain customer PII.
delete from rate_limit_log where bucket ~ '^order:1[0-25][0-9]{8}$';

do $verification$
begin
  if has_function_privilege('anon','public.place_order(integer,text,text,text,text,text,numeric,json,integer,date,integer,text,boolean,uuid,text,text,uuid)','execute')
     or has_function_privilege('authenticated','public.request_pickup(integer,text,text,text,text,text,numeric,text,numeric,text,integer,uuid,text,uuid)','execute')
     or has_function_privilege('anon','public.submit_custom_order(integer,text,text,text,text,text,numeric,json,text,integer,uuid,integer,date,text,text,uuid)','execute') then
    raise exception 'order creation wrapper remains client executable';
  end if;
  if not has_function_privilege('service_role','public.place_order(integer,text,text,text,text,text,numeric,json,integer,date,integer,text,boolean,uuid,text,text,uuid)','execute')
     or not has_function_privilege('service_role','public.request_pickup(integer,text,text,text,text,text,numeric,text,numeric,text,integer,uuid,text,uuid)','execute')
     or not has_function_privilege('service_role','public.submit_custom_order(integer,text,text,text,text,text,numeric,json,text,integer,uuid,integer,date,text,text,uuid)','execute') then
    raise exception 'order creation wrapper unavailable to Edge service';
  end if;
end $verification$;
