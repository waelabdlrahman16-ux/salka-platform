-- Promo codes on هنجبلك (custom) orders.
--
-- Until now they were impossible there: no box on the screen, no parameter on
-- the API, no column in the database. 93 custom orders, not one with a code.
--
-- WHY IT IS NOT THE SAME AS NORMAL CHECKOUT. A custom request carries NO PRICE
-- when the customer sends it -- they describe what they want and staff quote it
-- afterwards. A percentage of nothing is nothing, and any code with a minimum
-- basket would be refused outright. So the code cannot be applied at submit.
--
-- It is therefore HELD at submit and APPLIED at pricing:
--
--   submit   validate everything that does not depend on price, store the code
--   pricing  apply it for real, against the number staff just typed
--
-- Wael, 2026-08-20: "apply promo for them, i need it to be prefilled and a
-- button in the same input says submit or apply dont make them write it."
--
-- Function bodies below were pulled from pg_get_functiondef and transformed
-- programmatically, every substitution asserted by count -- 5, 0 failures.
-- None was retyped. See 20260813172545 for why that rule exists.

-- ---------------------------------------------------------------------------
-- 1. Where the chosen code waits for a price.
-- ---------------------------------------------------------------------------
alter table orders add column if not exists pending_promo_code text;
comment on column orders.pending_promo_code is
  'The code the customer chose when submitting a custom request, held until staff set the price. Kept after the attempt: pending set + promo_code_id set = applied; pending set + promo_code_id null after pricing = asked for but did not qualify.';

CREATE OR REPLACE FUNCTION private.submit_custom_order(p_restaurant_id integer, p_customer_name text, p_customer_phone text, p_zone text, p_unit_number text, p_address_notes text, p_delivery_fee numeric, p_request_items json, p_request_notes text, p_compound_id integer DEFAULT NULL::integer, p_session_token uuid DEFAULT NULL::uuid, p_slot_id integer DEFAULT NULL::integer, p_scheduled_date date DEFAULT NULL::date, p_prescription_path text DEFAULT NULL::text, p_promo_code text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_id int; v_token uuid; v_prep int; v_buffer int; v_ready timestamptz; v_dispatch timestamptz;
  v_mode text; v_fee numeric; v_km numeric; v_kitchen_id bigint; v_pickup_name text; v_pickup_address text; v_sla int; v_customer_id int;
  v_slot delivery_slots%rowtype; v_used int; v_rx text; v_item_count int;
  v_promo text; v_quote json; v_reason text;
begin
  if coalesce(trim(p_customer_name),'') = '' or coalesce(trim(p_customer_phone),'') = ''
     or coalesce(trim(p_zone),'') = '' or coalesce(trim(p_unit_number),'') = '' then
    raise exception 'missing_customer_details';
  end if;
  if is_banned(p_customer_phone) then
    raise exception 'account_blocked';
  end if;

  if p_session_token is not null then
    select cs.customer_id into v_customer_id
      from customer_sessions cs where cs.token = p_session_token and cs.expires_at > now();
  end if;

  select order_mode, coalesce(prep_minutes, 20) into v_mode, v_prep
    from restaurants where id = p_restaurant_id;
  if v_mode is distinct from 'custom_request' then raise exception 'not_a_custom_order_vendor'; end if;
  if not vendor_is_open_now(p_restaurant_id) then raise exception 'restaurant_closed'; end if;

  if p_compound_id is null then raise exception 'compound_id_required'; end if;
  select distance_km into v_km from compounds where id = p_compound_id;
  v_fee := private.delivery_fee_for_restaurant(p_restaurant_id, p_compound_id);
  select k.id, k.name, k.address into v_kitchen_id, v_pickup_name, v_pickup_address
    from public.restaurant_kitchens k
   where k.restaurant_id = p_restaurant_id and k.active and k.is_default
   limit 1;
  if v_km is null then raise exception 'compound_missing_distance'; end if;
  if v_fee is null then raise exception 'compound_missing_fee'; end if;
  v_sla := sla_minutes_for(p_restaurant_id, p_compound_id);

  v_rx := nullif(btrim(coalesce(p_prescription_path, '')), '');
  if v_rx is not null and v_rx !~ '^rx-[A-Za-z0-9_-]{6,60}\.(jpg|jpeg|png|webp|avif)$' then
    raise exception 'invalid_prescription_path';
  end if;

  v_item_count := coalesce(json_array_length(coalesce(p_request_items, '[]'::json)), 0);
  if v_item_count = 0 and v_rx is null then raise exception 'empty_order'; end if;

  -- THE PROMO CODE IS CHECKED NOW AND APPLIED LATER.
  --
  -- A custom request has no price yet -- staff quote it -- so the discount
  -- cannot be computed here. What CAN be settled here is everything that does
  -- not depend on price: does the code exist, is it live, is it for this vendor
  -- and this area. Telling someone at submit that their code is wrong is worth
  -- far more than letting them discover it silently when the quote arrives.
  --
  -- The two price-dependent verdicts are deliberately tolerated: at a subtotal
  -- of zero every basket is "under the minimum" and there may be "nothing to
  -- discount" yet. Both are re-judged for real by apply_order_promo at pricing.
  --
  -- Reuses quote_promo_code rather than re-deriving the rules. One rule, one
  -- place -- this codebase has already paid for the other habit.
  v_promo := nullif(upper(btrim(coalesce(p_promo_code, ''))), '');
  if v_promo is not null then
    if v_promo !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' then raise exception 'invalid_promo_code'; end if;
    v_quote := private.quote_promo_code(v_promo, p_restaurant_id, p_compound_id, 0, coalesce(v_fee,0), 0);
    if not coalesce((v_quote->>'valid')::boolean, false) then
      v_reason := v_quote->>'reason';
      if v_reason is distinct from 'promo_minimum_not_met'
         and v_reason is distinct from 'promo_nothing_to_discount' then
        raise exception '%', coalesce(v_reason, 'promo_invalid');
      end if;
    end if;
  end if;

  select coalesce((select value::int from settings where key = 'travel_buffer_minutes'), 10) into v_buffer;

  if p_slot_id is not null then
    select * into v_slot from delivery_slots where id = p_slot_id and restaurant_id = p_restaurant_id for update;
    if not found or not v_slot.active then raise exception 'slot_unavailable'; end if;

    select count(*) into v_used from orders
      where slot_id = p_slot_id and scheduled_date = p_scheduled_date
        and status <> 'Cancelled';
    if v_used >= v_slot.capacity then raise exception 'slot_full'; end if;

    v_ready := (p_scheduled_date + v_slot.start_time) at time zone 'Africa/Cairo';
    v_dispatch := v_ready - make_interval(mins => v_buffer);
  else
    v_ready := now() + make_interval(mins => v_prep);
    v_dispatch := greatest(now(), v_ready - make_interval(mins => v_buffer));
  end if;

  insert into orders (restaurant_id, customer_name, customer_phone, zone, unit_number,
                      address_notes, subtotal, delivery_fee, total,
                      order_type, request_items, request_notes, pricing_status, status,
                      ready_at, dispatch_at, slot_id, scheduled_date, compound_id, kitchen_id, pickup_location_name, pickup_location_address, sla_minutes,
                      customer_id, prescription_path, pending_promo_code)
  values (p_restaurant_id, trim(p_customer_name), trim(p_customer_phone), p_zone,
          trim(p_unit_number), coalesce(p_address_notes,''), 0, v_fee, v_fee,
          'custom_request', coalesce(p_request_items::jsonb, '[]'::jsonb),
          coalesce(p_request_notes,''), 'pending_quote', 'awaiting_quote',
          v_ready, v_dispatch, p_slot_id, p_scheduled_date, p_compound_id, v_kitchen_id, v_pickup_name, v_pickup_address, v_sla,
          v_customer_id, v_rx, v_promo)
  returning id, public_token into v_order_id, v_token;

  return json_build_object('id', v_order_id, 'token', v_token);
end; $function$
;

-- ---------------------------------------------------------------------------
-- 2. The public wrapper simply carries the code through.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_custom_order(p_restaurant_id integer, p_customer_name text, p_customer_phone text, p_zone text, p_unit_number text, p_address_notes text, p_delivery_fee numeric, p_request_items json, p_request_notes text, p_compound_id integer DEFAULT NULL::integer, p_session_token uuid DEFAULT NULL::uuid, p_slot_id integer DEFAULT NULL::integer, p_scheduled_date date DEFAULT NULL::date, p_prescription_path text DEFAULT NULL::text, p_rate_key text DEFAULT NULL::text, p_auth_user_id uuid DEFAULT NULL::uuid, p_promo_code text DEFAULT NULL::text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
    p_scheduled_date,p_prescription_path,p_promo_code
  );
  insert into rate_limit_log(bucket) values(v_bucket);
  return v_result;
end $function$;

-- ---------------------------------------------------------------------------
-- 3. Pricing the request is where the discount finally lands.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.confirm_custom_order_price(p_order_id integer, p_subtotal numeric)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_o orders%rowtype; v_total numeric; v_threshold numeric; v_deposit numeric;
        v_status text; v_pct numeric; v_service numeric;
begin
  if not is_supervisor() then raise exception 'not_authorized'; end if;
  if p_subtotal is null or p_subtotal < 0 then raise exception 'invalid_amount'; end if;

  select * into v_o from orders where id = p_order_id and order_type = 'custom_request';
  if not found then raise exception 'order_not_found'; end if;
  if v_o.status = 'Cancelled' then raise exception 'order_closed'; end if;

  select coalesce((select value::numeric from settings where key = 'service_fee_percent'), 0) into v_pct;
  v_service := round(p_subtotal * v_pct / 100.0);

  update orders set subtotal = p_subtotal, service_fee = v_service, pricing_status = 'confirmed'
   where id = p_order_id;

  -- THE CODE THE CUSTOMER CHOSE AT SUBMIT, APPLIED NOW THAT THERE IS A PRICE.
  --
  -- Wrapped, and swallowing the error on purpose. Between submitting the
  -- request and this moment the code may have hit its total limit, or the
  -- customer may have spent their one allowance elsewhere, or the quote may
  -- land under the minimum. None of that may stop staff pricing the order --
  -- an unpriceable order is a stuck order, and a customer waiting on a quote
  -- would simply never get one. So the discount is lost, not the quote.
  --
  -- pending_promo_code is deliberately NOT cleared, so the record still shows
  -- what was asked for: pending set with promo_code_id null after pricing means
  -- "requested, did not qualify", which is exactly what staff need to see.
  if v_o.promo_code_id is null and coalesce(btrim(v_o.pending_promo_code), '') <> '' then
    begin
      perform private.apply_order_promo(p_order_id, v_o.pending_promo_code, v_o.customer_id, v_o.customer_phone);
    exception when others then
      null;
    end;
  end if;

  perform private.reprice_order(p_order_id);
  select total into v_total from orders where id = p_order_id;

  v_deposit := null;
  if v_o.payment_method = 'cod' then
    select coalesce((select value::numeric from settings where key = 'cod_deposit_threshold_egp'), 300)
      into v_threshold;
    if v_total > v_threshold then v_deposit := least(ceil(v_total * private.setting_num('cod_deposit_percent') / 100.0), v_total); end if;
  end if;

  v_status := case
    when v_deposit is not null then 'awaiting_payment'
    when v_o.status = 'awaiting_quote' then
      case when v_o.slot_id is not null and coalesce(v_o.dispatch_at, v_o.created_at) > now()
           then 'Scheduled' else 'pending' end
    else v_o.status
  end;

  update orders
     set cod_deposit_amount = v_deposit,
         online_payment_status = case when v_deposit is not null then 'pending' else online_payment_status end,
         status = v_status
   where id = p_order_id;
end $function$;
