-- A COD deposit is an external InstaPay transfer. Do not let an administrator
-- advance an order until the customer has first declared that transfer.
create or replace function private.admin_confirm_cod_deposit(p_order_id integer)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_prep integer; v_buffer integer; v_ready timestamptz; v_dispatch timestamptz;
  v_slot_id integer; v_claimed_at timestamptz;
begin
  if not is_admin() then raise exception 'admin_only'; end if;

  select coalesce(r.prep_minutes, 20), o.slot_id, o.instapay_claimed_at
    into v_prep, v_slot_id, v_claimed_at
    from orders o join restaurants r on r.id = o.restaurant_id
   where o.id = p_order_id
     and o.cod_deposit_amount is not null
     and o.status = 'awaiting_payment';
  if not found then raise exception 'order_not_awaiting_deposit'; end if;
  if v_claimed_at is null then raise exception 'payment_not_claimed'; end if;

  select coalesce((select value::integer from settings where key = 'travel_buffer_minutes'), 10)
    into v_buffer;

  if v_slot_id is null then
    v_ready := now() + make_interval(mins => v_prep);
    v_dispatch := greatest(now(), v_ready - make_interval(mins => v_buffer));
    update orders
       set status = 'pending', online_payment_status = 'paid',
           ready_at = v_ready, dispatch_at = v_dispatch
     where id = p_order_id;
  else
    update orders
       set status = case when dispatch_at is not null and dispatch_at > now()
                         then 'Scheduled' else 'pending' end,
           online_payment_status = 'paid'
     where id = p_order_id;
  end if;
end;
$$;

-- Authenticated checkout must be visible in that customer's account even when
-- the legacy browser-session token is absent or expired. Keep an existing
-- legacy session link intact; otherwise attach the newly created order to the
-- authenticated customer immediately after the validated private insert. An
-- authenticated identity is canonical, so it also wins over a stale legacy
-- browser-session token.
create or replace function public.submit_custom_order(
  p_restaurant_id integer, p_customer_name text, p_customer_phone text,
  p_zone text, p_unit_number text, p_address_notes text, p_delivery_fee numeric,
  p_request_items json, p_request_notes text, p_compound_id integer default null,
  p_session_token uuid default null, p_slot_id integer default null,
  p_scheduled_date date default null, p_prescription_path text default null,
  p_rate_key text default null, p_auth_user_id uuid default null,
  p_promo_code text default null
) returns json
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_phone text; v_items json := coalesce(p_request_items, '[]'::json);
  v_bucket text; v_recent integer; v_result json; v_customer_id integer;
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

  if p_auth_user_id is not null then
    perform set_config('request.jwt.claim.sub', p_auth_user_id::text, true);
    select id into v_customer_id from customers where auth_user_id = p_auth_user_id limit 1;
  end if;

  v_result := private.submit_custom_order(
    p_restaurant_id, p_customer_name, v_phone, p_zone, p_unit_number, p_address_notes,
    p_delivery_fee, v_items, p_request_notes, p_compound_id, p_session_token,
    p_slot_id, p_scheduled_date, p_prescription_path, p_promo_code
  );

  if v_customer_id is not null then
    update orders
       set customer_id = v_customer_id
     where id = (v_result->>'id')::integer;
  end if;

  insert into rate_limit_log(bucket) values (v_bucket);
  return v_result;
end;
$$;
