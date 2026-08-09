create schema if not exists private;
revoke all on schema private from public;

-- Keep the reviewed pricing engines byte-for-byte intact, but remove them from
-- the exposed Data API schema. Public wrappers below reject abusive input
-- before those larger functions perform menu, discount and scheduling work.
alter function public.place_order(
  integer,text,text,text,text,text,numeric,json,integer,date,integer,text,boolean,uuid,text
) set schema private;

alter function public.request_pickup(
  integer,text,text,text,text,text,numeric,text,numeric,text,integer,uuid
) set schema private;

revoke all on function private.place_order(
  integer,text,text,text,text,text,numeric,json,integer,date,integer,text,boolean,uuid,text
) from public, anon, authenticated;

revoke all on function private.request_pickup(
  integer,text,text,text,text,text,numeric,text,numeric,text,integer,uuid
) from public, anon, authenticated;

create function public.place_order(
  p_restaurant_id integer,
  p_customer_name text,
  p_customer_phone text,
  p_zone text,
  p_unit_number text,
  p_address_notes text,
  p_delivery_fee numeric,
  p_items json,
  p_slot_id integer default null,
  p_scheduled_date date default null,
  p_compound_id integer default null,
  p_payment_method text default 'cod',
  p_use_wallet boolean default false,
  p_session_token uuid default null,
  p_customer_note text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone text;
  v_bucket text;
  v_recent integer;
  v_result json;
begin
  v_phone := normalize_phone(p_customer_phone);

  if length(btrim(coalesce(p_customer_name, ''))) not between 2 and 100 then
    raise exception 'invalid_customer_name';
  end if;
  if v_phone is null or v_phone !~ '^1[0-25][0-9]{8}$' then
    raise exception 'invalid_phone';
  end if;
  if length(btrim(coalesce(p_zone, ''))) not between 1 and 120 then
    raise exception 'invalid_zone';
  end if;
  if length(btrim(coalesce(p_unit_number, ''))) not between 1 and 100 then
    raise exception 'invalid_unit_number';
  end if;
  if length(coalesce(p_address_notes, '')) > 1000
     or length(coalesce(p_customer_note, '')) > 1000 then
    raise exception 'notes_too_long';
  end if;
  if p_items is null or json_typeof(p_items) <> 'array' then
    raise exception 'invalid_items';
  end if;
  if json_array_length(p_items) not between 1 and 50 then
    raise exception 'invalid_item_count';
  end if;
  if exists (
    select 1 from json_array_elements(p_items) item
     where coalesce((item->>'qty')::integer, 0) not between 1 and 100
  ) then
    raise exception 'invalid_item_quantity';
  end if;

  v_bucket := 'order:' || v_phone;
  perform pg_advisory_xact_lock(hashtextextended(v_bucket, 0));

  select count(*) into v_recent from rate_limit_log
   where bucket = v_bucket and called_at > now() - interval '15 minutes';
  if v_recent >= 5 then raise exception 'order_rate_limit'; end if;

  select count(*) into v_recent from rate_limit_log
   where bucket = v_bucket and called_at > now() - interval '24 hours';
  if v_recent >= 20 then raise exception 'daily_order_limit'; end if;

  v_result := private.place_order(
    p_restaurant_id, p_customer_name, v_phone, p_zone, p_unit_number,
    p_address_notes, p_delivery_fee, p_items, p_slot_id, p_scheduled_date,
    p_compound_id, p_payment_method, p_use_wallet, p_session_token,
    p_customer_note
  );

  insert into rate_limit_log (bucket) values (v_bucket);
  return v_result;
end;
$function$;

create function public.request_pickup(
  p_restaurant_id integer,
  p_customer_name text,
  p_customer_phone text,
  p_zone text,
  p_unit_number text,
  p_address_notes text,
  p_delivery_fee numeric,
  p_payment_mode text,
  p_collect_amount numeric,
  p_request_notes text,
  p_compound_id integer default null,
  p_session_token uuid default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone text;
  v_bucket text;
  v_recent integer;
  v_result json;
begin
  v_phone := normalize_phone(p_customer_phone);

  if length(btrim(coalesce(p_customer_name, ''))) not between 2 and 100 then
    raise exception 'invalid_customer_name';
  end if;
  if v_phone is null or v_phone !~ '^1[0-25][0-9]{8}$' then
    raise exception 'invalid_phone';
  end if;
  if length(btrim(coalesce(p_zone, ''))) not between 1 and 120 then
    raise exception 'invalid_zone';
  end if;
  if length(btrim(coalesce(p_unit_number, ''))) not between 1 and 100 then
    raise exception 'invalid_unit_number';
  end if;
  if length(coalesce(p_address_notes, '')) > 1000
     or length(coalesce(p_request_notes, '')) > 2000 then
    raise exception 'notes_too_long';
  end if;
  if p_collect_amount = 'NaN'::numeric
     or coalesce(p_collect_amount, 0) < 0
     or coalesce(p_collect_amount, 0) > 1000000 then
    raise exception 'invalid_collect_amount';
  end if;

  v_bucket := 'order:' || v_phone;
  perform pg_advisory_xact_lock(hashtextextended(v_bucket, 0));

  select count(*) into v_recent from rate_limit_log
   where bucket = v_bucket and called_at > now() - interval '15 minutes';
  if v_recent >= 5 then raise exception 'order_rate_limit'; end if;

  select count(*) into v_recent from rate_limit_log
   where bucket = v_bucket and called_at > now() - interval '24 hours';
  if v_recent >= 20 then raise exception 'daily_order_limit'; end if;

  v_result := private.request_pickup(
    p_restaurant_id, p_customer_name, v_phone, p_zone, p_unit_number,
    p_address_notes, p_delivery_fee, p_payment_mode, p_collect_amount,
    p_request_notes, p_compound_id, p_session_token
  );

  insert into rate_limit_log (bucket) values (v_bucket);
  return v_result;
end;
$function$;

create or replace function public.mark_instapay_claimed(p_token uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id integer;
  v_claimed_at timestamptz;
begin
  select id, instapay_claimed_at into v_order_id, v_claimed_at
    from orders
   where public_token = p_token
     and status = 'awaiting_payment'
     and (
       payment_method = 'instapay'
       or (payment_method = 'cod' and cod_deposit_amount is not null)
     )
   for update;

  if not found then raise exception 'order_not_awaiting_payment'; end if;
  if v_claimed_at is not null then return; end if;

  update orders set instapay_claimed_at = now() where id = v_order_id;
end;
$function$;

revoke all on function public.place_order(
  integer,text,text,text,text,text,numeric,json,integer,date,integer,text,boolean,uuid,text
) from public;
revoke all on function public.request_pickup(
  integer,text,text,text,text,text,numeric,text,numeric,text,integer,uuid
) from public;
revoke all on function public.mark_instapay_claimed(uuid) from public;

grant execute on function public.place_order(
  integer,text,text,text,text,text,numeric,json,integer,date,integer,text,boolean,uuid,text
) to anon, authenticated, service_role;
grant execute on function public.request_pickup(
  integer,text,text,text,text,text,numeric,text,numeric,text,integer,uuid
) to anon, authenticated, service_role;
grant execute on function public.mark_instapay_claimed(uuid)
  to anon, authenticated, service_role;

do $verification$
begin
  if to_regprocedure('private.place_order(integer,text,text,text,text,text,numeric,json,integer,date,integer,text,boolean,uuid,text)') is null
     or to_regprocedure('private.request_pickup(integer,text,text,text,text,text,numeric,text,numeric,text,integer,uuid)') is null then
    raise exception 'private order engine missing';
  end if;
  if has_function_privilege(
       'anon',
       'private.place_order(integer,text,text,text,text,text,numeric,json,integer,date,integer,text,boolean,uuid,text)',
       'execute'
     ) then
    raise exception 'anonymous access to private order engine remains';
  end if;
  if not has_function_privilege(
       'anon',
       'public.place_order(integer,text,text,text,text,text,numeric,json,integer,date,integer,text,boolean,uuid,text)',
       'execute'
     ) then
    raise exception 'public order wrapper is unavailable';
  end if;
end
$verification$;
