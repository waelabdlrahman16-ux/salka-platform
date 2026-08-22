-- INCIDENT FIX 2026-08-13: migration 20260813172545 (snapshot_order_kitchen_pickup,
-- merged to main as PR #119 / commit 4369170) patched place_order/request_pickup/
-- submit_custom_order via a naive replace(def, 'compound_id,', 'compound_id, kitchen_id,
-- ...') on the function source. Since 'compound_id,' is also a substring of
-- 'p_compound_id,', the replace fired twice, leaving a second bare (unprefixed)
-- kitchen_id, pickup_location_name, pickup_location_address in each function's
-- INSERT ... VALUES clause -- invalid identifiers, so every order-creation call
-- raised "column kitchen_id does not exist". This was 100% of checkout, pickup
-- request and custom-order traffic from ~2026-08-13 17:25 UTC until this fix
-- was applied directly against production at ~19:19 UTC the same day.
--
-- This migration was applied live via the Supabase MCP at the time of the incident
-- but was never checked into the repo, so a fresh database replaying migrations
-- from scratch (a new local/staging environment) would still hit the same bug via
-- migration 20260813172545's string-replace logic. This file makes the fix
-- reproducible: it recreates all three functions with the stray tokens removed
-- from the VALUES clause, keeping only the v_-prefixed variables.
--
-- Do not attempt to "fix" this by editing migration 20260813172545 itself -- it has
-- already been applied to production and is recorded in schema_migrations. Fix
-- forward, as this file does.

CREATE OR REPLACE FUNCTION private.place_order(p_restaurant_id integer, p_customer_name text, p_customer_phone text, p_zone text, p_unit_number text, p_address_notes text, p_delivery_fee numeric, p_items json, p_slot_id integer DEFAULT NULL::integer, p_scheduled_date date DEFAULT NULL::date, p_compound_id integer DEFAULT NULL::integer, p_payment_method text DEFAULT 'cod'::text, p_use_wallet boolean DEFAULT false, p_session_token uuid DEFAULT NULL::uuid, p_customer_note text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_id int; v_token uuid; v_subtotal numeric := 0; v_item json;
  v_prep int; v_buffer int; v_ready timestamptz; v_dispatch timestamptz;
  v_slot delivery_slots%rowtype; v_used int; v_open boolean; v_req boolean;
  v_fee numeric; v_km numeric; v_kitchen_id bigint; v_pickup_name text; v_pickup_address text; v_status text; v_sla int;
  v_service_fee_pct numeric; v_service_fee numeric;
  v_wallet_id int; v_wallet_balance numeric := 0; v_wallet_used numeric := 0;
  v_total numeric;
  v_menu_item_id int; v_qty int; v_real_price numeric; v_real_name text; v_available boolean; v_category text;
  v_customer_id int; v_session_phone text; v_require_login text;
  v_size_id int; v_has_sizes boolean; v_size_price numeric; v_size_name text; v_item_unit_price numeric;
  v_combo_id int; v_combo_price numeric; v_combo_name text;
  v_addon_ids int[]; v_addon_total numeric; v_addon_names text[]; v_matched_count int;
  v_group menu_item_addon_groups%rowtype; v_group_count int;
  v_lines jsonb := '[]'::jsonb; v_line jsonb;
  v_avail_from time; v_avail_until time; v_cairo_now time;
  v_item_disc discounts%rowtype; v_cat_disc discounts%rowtype;
  v_base_price numeric; v_original_unit_price numeric;
  v_cod_threshold numeric; v_cod_deposit numeric; v_net_total numeric;
begin
  if coalesce(trim(p_customer_name),'') = '' or coalesce(trim(p_customer_phone),'') = ''
     or coalesce(trim(p_zone),'') = '' or coalesce(trim(p_unit_number),'') = '' then
    raise exception 'missing_customer_details';
  end if;
  if is_banned(p_customer_phone) then
    raise exception 'account_blocked';
  end if;
  if p_payment_method not in ('cod','online','instapay') then raise exception 'invalid_payment_method'; end if;

  if p_session_token is not null then
    select cs.customer_id, c.phone into v_customer_id, v_session_phone
      from customer_sessions cs join customers c on c.id = cs.customer_id
      where cs.token = p_session_token and cs.expires_at > now();
  end if;

  if v_customer_id is null then
    v_customer_id := my_customer_id();
  end if;

  if v_session_phone is null and v_customer_id is not null then
    select phone into v_session_phone from customers where id = v_customer_id;
  end if;

  select value into v_require_login from settings where key = 'require_customer_login';
  if coalesce(v_require_login, 'false') = 'true' and v_customer_id is null then
    raise exception 'login_required';
  end if;

  select vendor_is_open_now(p_restaurant_id) into v_open;
  if not found or not v_open then raise exception 'restaurant_closed'; end if;

  if p_compound_id is not null and not vendor_covers_compound(p_restaurant_id, p_compound_id) then
    raise exception 'vendor_not_covering_compound';
  end if;

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

  if json_array_length(p_items) = 0 then raise exception 'empty_order'; end if;

  v_cairo_now := (now() at time zone 'Africa/Cairo')::time;

  for v_item in select * from json_array_elements(p_items) loop
    v_menu_item_id := (v_item->>'menu_item_id')::int;
    v_qty := (v_item->>'qty')::int;
    v_size_id := nullif(v_item->>'size_id','')::int;
    v_combo_id := nullif(v_item->>'combo_id','')::int;
    if v_menu_item_id is null or v_qty is null or v_qty <= 0 then raise exception 'invalid_item'; end if;

    select price, name, available, available_from, available_until, category
      into v_real_price, v_real_name, v_available, v_avail_from, v_avail_until, v_category
      from menu_items where id = v_menu_item_id and restaurant_id = p_restaurant_id;
    if v_real_price is null then raise exception 'menu_item_not_found'; end if;
    if not coalesce(v_available, true) then raise exception 'item_unavailable'; end if;
    if v_avail_from is not null and v_avail_until is not null and v_cairo_now not between v_avail_from and v_avail_until then
      raise exception 'item_not_available_now';
    end if;
    select coalesce(requires_prescription, false) into v_req from menu_items where id = v_menu_item_id;

    select exists(select 1 from menu_item_sizes where menu_item_id = v_menu_item_id and available) into v_has_sizes;
    v_size_name := null;
    v_combo_name := null;

    if v_combo_id is not null then
      select price, name into v_combo_price, v_combo_name from menu_item_combos
        where id = v_combo_id and menu_item_id = v_menu_item_id and available;
      if v_combo_price is null then raise exception 'invalid_combo'; end if;
      v_base_price := v_combo_price;
    elsif v_has_sizes then
      if v_size_id is null then raise exception 'size_required'; end if;
      select price, name into v_size_price, v_size_name from menu_item_sizes
        where id = v_size_id and menu_item_id = v_menu_item_id and available;
      if v_size_price is null then raise exception 'invalid_size'; end if;
      v_base_price := v_size_price;
    else
      v_base_price := v_real_price;
    end if;

    select * into v_item_disc from discounts
      where scope = 'item' and menu_item_id = v_menu_item_id and active
        and (starts_at is null or now() >= starts_at) and (ends_at is null or now() <= ends_at)
      limit 1;
    select * into v_cat_disc from discounts
      where scope = 'category' and restaurant_id = p_restaurant_id and category = v_category and active
        and (starts_at is null or now() >= starts_at) and (ends_at is null or now() <= ends_at)
      limit 1;

    v_original_unit_price := v_base_price;
    if v_item_disc.id is not null then
      v_base_price := case when v_item_disc.discount_type = 'percent'
        then round(v_base_price * (1 - v_item_disc.value / 100.0), 2)
        else greatest(0, v_base_price - v_item_disc.value) end;
    elsif v_cat_disc.id is not null then
      v_base_price := case when v_cat_disc.discount_type = 'percent'
        then round(v_base_price * (1 - v_cat_disc.value / 100.0), 2)
        else greatest(0, v_base_price - v_cat_disc.value) end;
    end if;
    v_item_unit_price := v_base_price;

    select array(select (jsonb_array_elements_text(coalesce(v_item::jsonb->'addon_ids', '[]'::jsonb)))::int)
      into v_addon_ids;
    v_addon_total := 0; v_addon_names := array[]::text[];
    if v_addon_ids is not null and array_length(v_addon_ids, 1) > 0 then
      select coalesce(sum(a.price), 0), coalesce(array_agg(a.name order by a.display_order), array[]::text[]),
             count(*)
        into v_addon_total, v_addon_names, v_matched_count
      from menu_item_addons a join menu_item_addon_groups g on g.id = a.group_id
      where a.id = any(v_addon_ids) and g.menu_item_id = v_menu_item_id and a.available;
      if v_matched_count <> array_length(v_addon_ids, 1) then raise exception 'invalid_addon'; end if;

      for v_group in select * from menu_item_addon_groups where menu_item_id = v_menu_item_id loop
        select count(*) into v_group_count from menu_item_addons a
          where a.group_id = v_group.id and a.id = any(v_addon_ids);
        if v_group_count < v_group.min_select then raise exception 'addon_group_min_not_met'; end if;
        if v_group.max_select is not null and v_group_count > v_group.max_select then
          raise exception 'addon_group_max_exceeded';
        end if;
      end loop;
    else
      for v_group in select * from menu_item_addon_groups where menu_item_id = v_menu_item_id loop
        if v_group.min_select > 0 then raise exception 'addon_group_min_not_met'; end if;
      end loop;
    end if;

    v_item_unit_price := v_item_unit_price + v_addon_total;
    v_subtotal := v_subtotal + (v_qty * v_item_unit_price);

    v_line := jsonb_build_object(
      'menu_item_id', v_menu_item_id, 'qty', v_qty, 'unit_price', v_item_unit_price,
      'name', v_real_name, 'requires_prescription', coalesce(v_req, false),
      'size_name', v_size_name, 'combo_name', v_combo_name, 'addon_names', to_jsonb(v_addon_names),
      'original_unit_price', case when v_original_unit_price <> v_base_price then v_original_unit_price + v_addon_total else null end
    );
    v_lines := v_lines || jsonb_build_array(v_line);
  end loop;

  select coalesce((select value::numeric from settings where key = 'service_fee_percent'), 0)
    into v_service_fee_pct;
  v_service_fee := round(v_subtotal * v_service_fee_pct / 100.0);
  v_total := v_subtotal + v_fee + v_service_fee;

  if p_use_wallet and v_session_phone is not null
     and normalize_phone(v_session_phone) = normalize_phone(p_customer_phone) then
    insert into customer_wallets (phone, balance) values (normalize_phone(p_customer_phone), 0)
      on conflict (phone) do nothing;
    select id, balance into v_wallet_id, v_wallet_balance
      from customer_wallets where phone = normalize_phone(p_customer_phone) for update;
    v_wallet_used := least(coalesce(v_wallet_balance, 0), v_total);
  end if;

  v_net_total := v_total - v_wallet_used;

  v_cod_deposit := null;
  if p_payment_method = 'cod' then
    select coalesce((select value::numeric from settings where key = 'cod_deposit_threshold_egp'), 300)
      into v_cod_threshold;
    if v_net_total > v_cod_threshold then
      v_cod_deposit := ceil(v_net_total * 0.5);
    end if;
  end if;

  select coalesce(prep_minutes, 20) into v_prep from restaurants where id = p_restaurant_id;
  select coalesce((select value::int from settings where key = 'travel_buffer_minutes'), 10)
    into v_buffer;

  if p_slot_id is not null then
    select * into v_slot from delivery_slots where id = p_slot_id for update;
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

  v_status := case
    when (p_payment_method in ('online','instapay') and v_net_total > 0) or v_cod_deposit is not null
      then 'awaiting_payment'
    when p_slot_id is not null and v_dispatch is not null and v_dispatch > now()
      then 'Scheduled'
    else 'pending'
  end;

  insert into orders (restaurant_id, customer_name, customer_phone, zone, unit_number,
                      address_notes, customer_note, subtotal, delivery_fee, service_fee, wallet_used, total,
                      ready_at, dispatch_at, slot_id, scheduled_date, compound_id, kitchen_id, pickup_location_name, pickup_location_address,
                      status, payment_method, online_payment_status, sla_minutes, customer_id, cod_deposit_amount)
  values (p_restaurant_id, trim(p_customer_name), trim(p_customer_phone), p_zone,
          trim(p_unit_number), coalesce(p_address_notes,''), nullif(trim(coalesce(p_customer_note,'')),''),
          v_subtotal, v_fee, v_service_fee, v_wallet_used,
          v_net_total, v_ready, v_dispatch, p_slot_id, p_scheduled_date, p_compound_id, v_kitchen_id, v_pickup_name, v_pickup_address,
          v_status, p_payment_method,
          case when p_payment_method in ('online','instapay') and v_net_total > 0 then 'pending'
               when v_cod_deposit is not null then 'pending' else null end,
          v_sla, v_customer_id, v_cod_deposit)
  returning id, public_token into v_order_id, v_token;

  if v_wallet_used > 0 then
    update customer_wallets set balance = balance - v_wallet_used where id = v_wallet_id;
    insert into wallet_transactions (wallet_id, amount, reason, order_id)
      values (v_wallet_id, -v_wallet_used, 'استخدام الرصيد في طلب #' || v_order_id, v_order_id);
  end if;

  insert into order_items (order_id, menu_item_id, name, qty, unit_price, total, requires_prescription, size_name, combo_name, addon_names, original_unit_price)
  select v_order_id, (l->>'menu_item_id')::int, l->>'name', (l->>'qty')::int, (l->>'unit_price')::numeric,
         (l->>'qty')::int * (l->>'unit_price')::numeric, (l->>'requires_prescription')::boolean,
         l->>'size_name', l->>'combo_name',
         case when jsonb_array_length(coalesce(l->'addon_names','[]'::jsonb)) = 0 then null
              else array(select jsonb_array_elements_text(l->'addon_names')) end,
         (l->>'original_unit_price')::numeric
  from jsonb_array_elements(v_lines) as l;

  return json_build_object('id', v_order_id, 'token', v_token,
                           'ready_at', v_ready, 'dispatch_at', v_dispatch, 'wallet_used', v_wallet_used,
                           'cod_deposit_amount', v_cod_deposit);
end; $function$;

CREATE OR REPLACE FUNCTION private.request_pickup(p_restaurant_id integer, p_customer_name text, p_customer_phone text, p_zone text, p_unit_number text, p_address_notes text, p_delivery_fee numeric, p_payment_mode text, p_collect_amount numeric, p_request_notes text, p_compound_id integer DEFAULT NULL::integer, p_session_token uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_id int; v_token uuid; v_prep int; v_buffer int; v_ready timestamptz; v_dispatch timestamptz;
  v_total numeric; v_fee numeric; v_km numeric; v_kitchen_id bigint; v_pickup_name text; v_pickup_address text; v_exists boolean; v_sla int; v_customer_id int;
  v_pct numeric; v_service numeric; v_goods numeric;
begin
  if coalesce(trim(p_customer_name),'') = '' or coalesce(trim(p_customer_phone),'') = ''
     or coalesce(trim(p_zone),'') = '' or coalesce(trim(p_unit_number),'') = '' then
    raise exception 'missing_customer_details';
  end if;
  if p_payment_mode not in ('prepaid','driver_pays') then raise exception 'invalid_payment_mode'; end if;
  if p_payment_mode = 'driver_pays' and coalesce(p_collect_amount, 0) <= 0 then
    raise exception 'collect_amount_required';
  end if;

  if p_session_token is not null then
    select cs.customer_id into v_customer_id
      from customer_sessions cs where cs.token = p_session_token and cs.expires_at > now();
  end if;

  select true, coalesce(prep_minutes, 10) into v_exists, v_prep
    from restaurants where id = p_restaurant_id;
  if not v_exists then raise exception 'restaurant_not_found'; end if;

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

  select coalesce((select value::int from settings where key = 'travel_buffer_minutes'), 10) into v_buffer;
  v_ready := now() + make_interval(mins => v_prep);
  v_dispatch := greatest(now(), v_ready - make_interval(mins => v_buffer));

  v_goods := case when p_payment_mode = 'driver_pays' then coalesce(p_collect_amount, 0) else 0 end;
  select coalesce((select value::numeric from settings where key = 'service_fee_percent'), 0) into v_pct;
  v_service := round(v_goods * v_pct / 100.0);
  v_total := v_fee + v_goods + v_service;

  insert into orders (restaurant_id, customer_name, customer_phone, zone, unit_number,
                      address_notes, subtotal, delivery_fee, service_fee, total,
                      order_type, request_notes, pricing_status, kitchen_status,
                      payment_mode, collect_amount, ready_at, dispatch_at, compound_id, kitchen_id, pickup_location_name, pickup_location_address, sla_minutes, customer_id)
  values (p_restaurant_id, trim(p_customer_name), trim(p_customer_phone), p_zone,
          trim(p_unit_number), coalesce(p_address_notes,''),
          coalesce(p_collect_amount, 0), v_fee, v_service, v_total,
          'pickup_request', coalesce(p_request_notes,''), 'n/a', 'ready',
          p_payment_mode, p_collect_amount, v_ready, v_dispatch, p_compound_id, v_kitchen_id, v_pickup_name, v_pickup_address, v_sla, v_customer_id)
  returning id, public_token into v_order_id, v_token;

  return json_build_object('id', v_order_id, 'token', v_token,
                           'total', v_total, 'delivery_fee', v_fee, 'service_fee', v_service,
                           'collect_amount', coalesce(p_collect_amount, 0));
end; $function$;

CREATE OR REPLACE FUNCTION private.submit_custom_order(p_restaurant_id integer, p_customer_name text, p_customer_phone text, p_zone text, p_unit_number text, p_address_notes text, p_delivery_fee numeric, p_request_items json, p_request_notes text, p_compound_id integer DEFAULT NULL::integer, p_session_token uuid DEFAULT NULL::uuid, p_slot_id integer DEFAULT NULL::integer, p_scheduled_date date DEFAULT NULL::date, p_prescription_path text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_id int; v_token uuid; v_prep int; v_buffer int; v_ready timestamptz; v_dispatch timestamptz;
  v_mode text; v_fee numeric; v_km numeric; v_kitchen_id bigint; v_pickup_name text; v_pickup_address text; v_sla int; v_customer_id int;
  v_slot delivery_slots%rowtype; v_used int; v_rx text; v_item_count int;
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
                      customer_id, prescription_path)
  values (p_restaurant_id, trim(p_customer_name), trim(p_customer_phone), p_zone,
          trim(p_unit_number), coalesce(p_address_notes,''), 0, v_fee, v_fee,
          'custom_request', coalesce(p_request_items::jsonb, '[]'::jsonb),
          coalesce(p_request_notes,''), 'pending_quote', 'awaiting_quote',
          v_ready, v_dispatch, p_slot_id, p_scheduled_date, p_compound_id, v_kitchen_id, v_pickup_name, v_pickup_address, v_sla,
          v_customer_id, v_rx)
  returning id, public_token into v_order_id, v_token;

  return json_build_object('id', v_order_id, 'token', v_token);
end; $function$;
