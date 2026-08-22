-- A percentage with no ceiling is not a service fee, it is a share of the order.
--
-- settings.service_fee_percent is 8. That is a sensible number on a 400 EGP
-- basket (32 EGP) and an indefensible one on a 5,000 EGP هنجبلك order (400 EGP),
-- where the work Salka does is identical: one quote, one driver, one delivery.
-- The fee tracked the basket instead of the service, and nothing stopped it.
--
-- So: a flat ceiling of 199 EGP, in settings alongside the percentage, and one
-- function that both numbers pass through.
--
--   service_fee = least( round(subtotal * service_fee_percent / 100),
--                        service_fee_max_egp )
--
-- WHY A HELPER RATHER THAN least(...) IN SEVEN PLACES.
-- That arithmetic was written out seven times: place_order, custom_order_quote_snapshot,
-- confirm_custom_order_price, request_pickup, staff_create_pickup_order,
-- admin_adjust_order and public.quote_promo_code. Six of them also re-read the
-- setting with their own inline coalesce. Adding a cap to seven copies means the
-- next person to change fee policy has to find seven copies -- and the reason
-- src/lib/serviceFee.ts exists at all is that this exact duplication, one layer up
-- in the client, silently overcharged customers when the percentage changed.
-- One helper, seven callers, one place to change next time.
--
-- admin_adjust_order is why the cap cannot live at only some of the sites: it
-- computes the fee AND the waiver (round(subtotal*pct/100) - service_fee). Capping
-- the charge but not the waiver would credit a customer for fee they were never
-- going to be charged.
--
-- NEW QUOTES ONLY. An unaccepted custom-order quote holds a frozen, uncapped
-- service_fee, and rule 7 of the quote flow is that a frozen quote is never
-- recomputed. This migration therefore touches no existing row: no UPDATE against
-- orders, no backfill. Quotes issued from now on are capped; quotes already on a
-- customer's screen are honoured exactly as offered. Order #979 is untouched.

-- ONE UNRELATED LINE COMES ALONG. place_order is replaced whole (there is no way to
-- replace one statement of a plpgsql body), and the copy in
-- 20260813192700 is one line behind production: it still has the hardcoded
-- `ceil(v_net_total * 0.5)` deposit that 20260820120000 replaced with
-- setting_num('cod_deposit_percent'). This file carries PRODUCTION's version of that
-- line, not the repo's, so replaying these migrations cannot silently revert the
-- deposit setting. Verified line-by-line against pg_get_functiondef before writing.

-- ---------------------------------------------------------------------------
-- 1. The ceiling is a setting, not a constant.
-- ---------------------------------------------------------------------------
-- CLASS A (required), same as service_fee_percent: it governs money, it cannot be
-- deleted, and no consumer may invent a value for it.
insert into settings (key, value, label, kind, required, min_value, max_value) values
  ('service_fee_max_egp', '199',
   'الحد الأقصى لرسوم الخدمة للطلب الواحد (ج.م)', 'numeric', true, 0, null)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. One definition of the service fee.
-- ---------------------------------------------------------------------------
-- Strict on both settings, deliberately. setting_num() raises rather than guessing
-- when a required row is missing, and part 4 of 20260820120000 made both of these
-- rows undeletable -- so the strict path is unreachable in practice and the loud
-- failure is the correct one if it ever is reached. This does tighten six call
-- sites that used to coalesce a missing service_fee_percent to 0: a vanished
-- setting used to mean "charge no service fee", and now means "stop and say so".
create or replace function private.service_fee_for(p_subtotal numeric)
returns numeric
language sql
stable
set search_path to 'public'
as $function$
  select least(
    round(greatest(coalesce(p_subtotal, 0), 0) * private.setting_num('service_fee_percent') / 100.0),
    private.setting_num('service_fee_max_egp')
  );
$function$;

comment on function private.service_fee_for(numeric) is
  'The only place the service fee is computed: percentage of subtotal, capped at settings.service_fee_max_egp. Mirrored for display only by src/lib/serviceFee.ts.';

-- ---------------------------------------------------------------------------
-- 3. Every caller routed through it.
-- ---------------------------------------------------------------------------
-- 3a. place_order -- the cart checkout path.
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
  v_service_fee numeric;
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

  v_service_fee := private.service_fee_for(v_subtotal);
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
      v_cod_deposit := least(ceil(v_net_total * private.setting_num('cod_deposit_percent') / 100.0), v_net_total);
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

-- 3b. custom_order_quote_snapshot -- the canonical custom-order/quote path. Backs
-- preview, issue and (via the frozen row) accept. The cap must land here, BEFORE
-- promo_discount_for and promo_split, or a service-targeted promo would be computed
-- against an uncapped fee and discount money that was never charged.
create or replace function private.custom_order_quote_snapshot(p_order_id integer, p_subtotal numeric)
returns table(subtotal numeric, delivery_fee numeric, service_fee numeric, promo_code_id integer, promo_discount numeric, promo_discount_service numeric, promo_discount_delivery numeric, promo_discount_vendor numeric, wallet_used numeric, total numeric, payment_method text, deposit_required boolean, deposit_amount numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order orders%rowtype;
  v_promo promo_codes%rowtype;
  v_service numeric;
  v_discount numeric := 0;
  v_discount_service numeric := 0;
  v_discount_delivery numeric := 0;
  v_discount_vendor numeric := 0;
  v_total numeric;
  v_wallet numeric;
  v_deposit numeric := 0;
begin
  if p_subtotal is null or p_subtotal < 0 then raise exception 'invalid_amount'; end if;

  select * into v_order
    from orders
   where id = p_order_id and order_type = 'custom_request';
  if not found then raise exception 'order_not_found'; end if;
  if v_order.status = 'Cancelled' then raise exception 'order_closed'; end if;

  v_service := private.service_fee_for(p_subtotal);

  if v_order.promo_code_id is not null then
    select * into v_promo from promo_codes where id = v_order.promo_code_id;
    if found then
      v_discount := private.promo_discount_for(
        v_promo, p_subtotal, coalesce(v_order.delivery_fee, 0), v_service);
      select cut_service, cut_delivery, cut_vendor
        into v_discount_service, v_discount_delivery, v_discount_vendor
        from private.promo_split(
          v_promo.applies_to, v_discount, coalesce(v_order.delivery_fee, 0), v_service);
    end if;
  end if;

  v_total := greatest(0, p_subtotal + coalesce(v_order.delivery_fee, 0) + v_service - v_discount);
  v_wallet := least(coalesce(v_order.wallet_used, 0), v_total);

  -- orders.total is the net amount due after any wallet contribution. The
  -- deposit threshold and amount must use that same net number.
  v_total := v_total - v_wallet;

  if v_order.payment_method = 'cod'
     and v_total > private.setting_num('cod_deposit_threshold_egp') then
    v_deposit := least(
      ceil(v_total * private.setting_num('cod_deposit_percent') / 100.0),
      v_total
    );
  end if;

  return query select
    p_subtotal,
    coalesce(v_order.delivery_fee, 0),
    v_service,
    v_order.promo_code_id::integer,
    v_discount,
    v_discount_service,
    v_discount_delivery,
    v_discount_vendor,
    v_wallet,
    v_total,
    v_order.payment_method,
    v_deposit > 0,
    v_deposit;
end;
$function$;

-- 3c. confirm_custom_order_price -- the older direct-pricing path, still granted to
-- supervisors (see 20260821212340). Capped too, or it becomes the way around the cap.
create or replace function private.confirm_custom_order_price(p_order_id integer, p_subtotal numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_o orders%rowtype; v_total numeric; v_threshold numeric; v_deposit numeric;
        v_status text; v_service numeric;
begin
  if not is_supervisor() then raise exception 'not_authorized'; end if;
  if p_subtotal is null or p_subtotal < 0 then raise exception 'invalid_amount'; end if;

  select * into v_o from orders where id = p_order_id and order_type = 'custom_request';
  if not found then raise exception 'order_not_found'; end if;
  if v_o.status = 'Cancelled' then raise exception 'order_closed'; end if;

  v_service := private.service_fee_for(p_subtotal);

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

-- 3d. public.quote_promo_code (legacy 4-arg) -- recomputes the fee only to price a
-- promo against it. Uncapped here, a promo would be quoted off a fee the customer
-- will not be charged.
create or replace function public.quote_promo_code(p_code text, p_restaurant_id integer, p_compound_id integer, p_subtotal numeric)
returns json
language sql
security definer
set search_path to 'public'
as $function$
  select private.quote_promo_code(
    p_code, p_restaurant_id, p_compound_id, p_subtotal,
    coalesce(private.delivery_fee_for_restaurant(p_restaurant_id, p_compound_id), 0),
    private.service_fee_for(p_subtotal)
  )
$function$;

-- 3e. admin_adjust_order -- charges the fee on an adjustment, or records what was
-- waived. Both numbers come from the same capped helper now: a waiver can only ever
-- credit fee that would actually have been charged.
create or replace function private.admin_adjust_order(p_order_id integer, p_amount numeric, p_reason text, p_charge_service_fee boolean default false)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor text; v_o orders%rowtype;
  v_new_subtotal numeric; v_new_fee numeric; v_waived numeric := null;
  v_capped_fee numeric;
  v_new_total numeric; v_has_lines boolean; v_line_id int;
begin
  if is_admin() then v_actor := 'admin';
  elsif is_supervisor() then v_actor := 'supervisor';
  else raise exception 'admin_only';
  end if;

  if p_amount is null or p_amount = 0 then raise exception 'invalid_amount'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;

  select * into v_o from orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_o.status = 'Cancelled' then raise exception 'order_cancelled'; end if;

  -- PRODUCT lines, not adjustment lines. An order whose only order_items row is
  -- a previous adjustment still has no products to sum.
  select exists (
    select 1 from order_items
     where order_id = p_order_id and not coalesce(is_adjustment, false)
  ) into v_has_lines;

  -- created_by keeps the role; created_by_uid names the person. Both, not one:
  -- the role is what the screen shows, the uuid is what an audit needs.
  insert into order_items (order_id, menu_item_id, name, qty, unit_price, total,
                           is_adjustment, created_by, created_by_uid)
  values (p_order_id, null, trim(p_reason), 1, p_amount, p_amount, true, v_actor, auth.uid())
  returning id into v_line_id;

  if v_has_lines then
    -- Derived, never assigned: the header cannot disagree with the lines.
    select coalesce(sum(total), 0) into v_new_subtotal
      from order_items where order_id = p_order_id;
  else
    -- Nothing to derive from; apply to what is stored.
    v_new_subtotal := coalesce(v_o.subtotal, 0) + p_amount;
  end if;

  if v_new_subtotal < 0 then raise exception 'negative_subtotal'; end if;

  v_capped_fee := private.service_fee_for(v_new_subtotal);

  if p_charge_service_fee then
    v_new_fee := v_capped_fee;
  else
    v_new_fee := v_o.service_fee;
    v_waived  := v_capped_fee - coalesce(v_o.service_fee, 0);
    if v_waived <= 0 then v_waived := null; end if;
    update order_items set service_fee_waived = v_waived where id = v_line_id;
  end if;

  update orders
     set subtotal = v_new_subtotal, service_fee = v_new_fee
   where id = p_order_id;

  -- The total, and the promo that comes off it, are not this function's to
  -- compute. See 20260819210000: the discount used to vanish here.
  perform private.reprice_order(p_order_id);
  select total into v_new_total from orders where id = p_order_id;
  if v_new_total < 0 then raise exception 'negative_total'; end if;

  return json_build_object(
    'order_id',           p_order_id,
    'derived_from_lines', v_has_lines,
    'old_subtotal',       v_o.subtotal,    'new_subtotal',    v_new_subtotal,
    'old_service_fee',    v_o.service_fee, 'new_service_fee', v_new_fee,
    'service_fee_waived', v_waived,
    'delivery_fee',       v_o.delivery_fee,
    'old_total',          v_o.total,       'new_total',       v_new_total,
    'actor',              v_actor,
    'actor_uid',          auth.uid()
  );
end $function$;

-- 3f. request_pickup -- customer-initiated pickup. The fee is charged on the goods
-- the driver pays for, so the same ceiling applies.
create or replace function private.request_pickup(p_restaurant_id integer, p_customer_name text, p_customer_phone text, p_zone text, p_unit_number text, p_address_notes text, p_delivery_fee numeric, p_payment_mode text, p_collect_amount numeric, p_request_notes text, p_compound_id integer default null::integer, p_session_token uuid default null::uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id int; v_token uuid; v_prep int; v_buffer int; v_ready timestamptz; v_dispatch timestamptz;
  v_total numeric; v_fee numeric; v_km numeric; v_kitchen_id bigint; v_pickup_name text; v_pickup_address text; v_exists boolean; v_sla int; v_customer_id int;
  v_service numeric; v_goods numeric;
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
  v_service := private.service_fee_for(v_goods);
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

-- 3g. staff_create_pickup_order -- the phoned-in equivalent. Same base, same ceiling.
create or replace function private.staff_create_pickup_order(p_restaurant_id integer, p_customer_name text, p_customer_phone text, p_compound_id integer, p_unit_number text, p_address_notes text default ''::text, p_collect_amount numeric default 0, p_request_notes text default ''::text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fee numeric; v_km numeric; v_sla int; v_prep int; v_buffer int;
  v_ready timestamptz; v_dispatch timestamptz;
  v_vendor_type text; v_vendor_name text; v_total numeric;
  v_service numeric; v_threshold numeric; v_deposit_advice numeric;
  v_order_id int; v_token uuid; v_actor text;
begin
  if is_admin() then v_actor := 'admin';
  elsif is_supervisor() then v_actor := 'supervisor';
  else raise exception 'admin_only';
  end if;

  if coalesce(trim(p_customer_name),'') = '' or coalesce(trim(p_customer_phone),'') = ''
     or coalesce(trim(p_unit_number),'') = '' then
    raise exception 'missing_customer_details';
  end if;
  if p_compound_id is null then raise exception 'compound_id_required'; end if;
  if coalesce(p_collect_amount, 0) < 0 then raise exception 'invalid_collect_amount'; end if;

  select vendor_type, name, coalesce(prep_minutes, 15)
    into v_vendor_type, v_vendor_name, v_prep
    from restaurants where id = p_restaurant_id and not archived;
  if v_vendor_name is null then raise exception 'restaurant_not_found'; end if;

  -- The supervisor's remit stops at the restaurants, same boundary as
  -- supervisor_may_touch_order().
  if v_actor = 'supervisor' and coalesce(v_vendor_type, 'restaurant') <> 'restaurant' then
    raise exception 'not_authorized';
  end if;

  select distance_km, delivery_fee into v_km, v_fee from compounds where id = p_compound_id;
  if v_fee is null then raise exception 'compound_missing_fee'; end if;
  v_sla := sla_minutes_for(p_restaurant_id, p_compound_id);

  select coalesce((select value::int from settings where key = 'travel_buffer_minutes'), 10) into v_buffer;
  v_ready := now() + make_interval(mins => v_prep);
  v_dispatch := greatest(now(), v_ready - make_interval(mins => v_buffer));

  -- Same source, same base, same rounding and same ceiling as place_order.
  v_service := private.service_fee_for(coalesce(p_collect_amount, 0));

  -- The driver collects the food price, the delivery fee AND the service fee at
  -- the door; only the food half is owed back to the vendor. subtotal carries
  -- the vendor's money so the earnings and cash screens keep working off the
  -- same columns they always have.
  v_total := v_fee + coalesce(p_collect_amount, 0) + v_service;

  select coalesce((select value::numeric from settings where key = 'cod_deposit_threshold_egp'), 300)
    into v_threshold;
  v_deposit_advice := case when v_total > v_threshold then least(ceil(v_total * private.setting_num('cod_deposit_percent') / 100.0), v_total) else null end;

  insert into orders (restaurant_id, customer_name, customer_phone, zone, unit_number,
                      address_notes, subtotal, delivery_fee, service_fee, total,
                      order_type, request_notes, pricing_status, kitchen_status,
                      payment_method, payment_mode, collect_amount,
                      compound_id, ready_at, dispatch_at, sla_minutes, status)
  values (p_restaurant_id, trim(p_customer_name), trim(p_customer_phone),
          (select name from compounds where id = p_compound_id),
          trim(p_unit_number), coalesce(p_address_notes,''),
          coalesce(p_collect_amount, 0), v_fee, v_service, v_total,
          'pickup_request',
          nullif(trim(coalesce(p_request_notes,'')),''),
          'n/a',
          -- Born ready: nobody presses "accept" on the vendor screen for an
          -- order the vendor phoned in, and driver_mark_picked_up requires
          -- kitchen_status = 'ready'.
          'ready',
          'cod', 'driver_pays', coalesce(p_collect_amount, 0),
          p_compound_id, v_ready, v_dispatch, v_sla, 'pending')
  returning id, public_token into v_order_id, v_token;

  insert into order_status_events (order_id, from_status, to_status, actor)
  values (v_order_id, null, 'pending', v_actor);

  return json_build_object('id', v_order_id, 'token', v_token,
                           'total', v_total, 'delivery_fee', v_fee,
                           'service_fee', v_service,
                           'collect_amount', coalesce(p_collect_amount, 0),
                           'deposit_advice', v_deposit_advice,
                           'deposit_threshold', v_threshold,
                           'vendor', v_vendor_name);
end $function$;

-- ---------------------------------------------------------------------------
-- 4. Nothing recomputed, nothing backfilled.
-- ---------------------------------------------------------------------------
-- Deliberately no UPDATE against orders. Frozen quotes stay frozen (rule 7), open
-- orders keep the price the customer agreed to, and #979 is untouched.
