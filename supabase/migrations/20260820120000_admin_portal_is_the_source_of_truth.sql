-- The admin portal is the only source of truth.
--
-- THE PRINCIPLE. The number typed into the admin portal is the ONLY number. No code
-- path may substitute a different one, and no input may leave the system in a state
-- where the number cannot be read.
--
-- Three defects close here.
--
-- D1 -- A TYPO IN THE PORTAL BREAKS ORDER PLACEMENT. Live risk, today. settings.value
-- is text with no constraints, and the settings screen writes straight to the table.
-- Every consumer then does value::numeric, so typing '8%', '1,500', Arabic-Indic
-- digits, or a trailing space raises AT READ TIME. service_fee_percent is read by
-- place_order: a mistyped fee does not misprice an order, it stops customers ordering
-- at all, with an error naming a cast rather than a setting.
--
-- D2 -- FIFTEEN FALLBACKS CONTRADICT THE PORTAL. Of 34 settings the database reads,
-- 15 hardcode a fallback that differs from the configured value. service_fee_percent
-- falls back to 0 against a live 8; driver_daily_salary_egp to 0 against 800;
-- van_required_subtotal_egp to 300 against 9000; cod_deposit_threshold_egp to 300
-- against 2000. Nothing alerts on a settings row vanishing, and afterwards a
-- fallback-driven decision is indistinguishable from a policy-driven one.
--
-- D3 -- POLICY THAT NEVER REACHED THE PORTAL AT ALL. Three numbers govern real
-- behaviour and cannot be changed without a migration: the deposit percentage, the
-- driver load cap (4), and the no-answer wait (5 minutes). They are now settings.
--
-- HOW THE GUARANTEE IS MADE, and why it is not simply "delete the fallbacks".
-- Removing an inline fallback means rewriting the function that holds it, and one of
-- them is place_order at 13,306 characters -- the checkout path that a careless edit
-- took down for two hours on 13 August. So the guarantee is made at the DATA layer
-- instead: required rows cannot be deleted, and their values cannot be saved in a form
-- that fails to parse. A fallback that can never be reached cannot contradict anything.
-- The inline fallbacks become dead code rather than a live risk, and the functions that
-- must change for D3 are converted properly, in full.
--
-- ROLLBACK: drop the two triggers and their functions, drop setting_num/setting_bool,
-- drop the four columns, delete the three new settings rows, and restore the converted
-- functions from the migrations named against each. All additive; no data is rewritten.

-- ---------------------------------------------------------------------------
-- 1. Classify every setting.
-- ---------------------------------------------------------------------------
alter table settings add column if not exists kind text not null default 'numeric';
alter table settings add column if not exists required boolean not null default false;
alter table settings add column if not exists min_value numeric;
alter table settings add column if not exists max_value numeric;

alter table settings drop constraint if exists settings_kind_check;
alter table settings add constraint settings_kind_check
  check (kind in ('numeric','boolean','text'));

comment on column settings.kind is
  'How the value is parsed and validated on write. numeric|boolean|text.';
comment on column settings.required is
  'CLASS A: money and policy. Cannot be deleted, and consumers must not guess a value for it.';

-- CLASS A -- money and policy. Never guess. Deletion blocked.
update settings set kind = 'numeric', required = true, min_value = 0 where key in (
  'service_fee_percent','cod_deposit_threshold_egp','van_required_subtotal_egp',
  'driver_daily_salary_egp','driver_flat_earning_egp',
  'driver_bonus_tier1_amount','driver_bonus_tier2_amount','driver_bonus_tier3_amount',
  'driver_bonus_tier1_orders','driver_bonus_tier2_orders','driver_bonus_tier3_orders',
  'fee_tier1_egp','fee_tier2_egp','fee_tier3_egp','fee_tier4_egp','fee_tier5_egp',
  'fee_tier6_egp','fee_tier7_egp',
  'fee_tier1_max_km','fee_tier2_max_km','fee_tier3_max_km','fee_tier4_max_km',
  'fee_tier5_max_km','fee_tier6_max_km','fee_tier7_max_km',
  'sla_travel_per_km'
);

-- A percentage is not merely non-negative.
update settings set max_value = 100 where key in ('service_fee_percent','sla_range_pct');

-- CLASS B -- operational timing. Degrades rather than stops: a cron that raises stops
-- watching for stalled orders, which is worse than one using a documented default.
update settings set kind = 'numeric', required = false, min_value = 0 where key in (
  'escalate_after_minutes','stall_quote_minutes','stall_accepted_minutes',
  'stall_delivery_minutes','stall_payment_minutes','travel_buffer_minutes',
  'sla_travel_base_minutes','sla_range_pct','slot_cutoff_minutes'
);

update settings set kind = 'boolean', required = false, min_value = null, max_value = null
 where value in ('true','false');

-- Unread today, kept editable and unconstrained rather than silently retyped.
update settings set kind = 'text', required = false where key = 'driver_pay_model';

-- ---------------------------------------------------------------------------
-- 2. Policy that was never in the portal. D3.
-- ---------------------------------------------------------------------------
-- Seeded at exactly today's hardcoded values, so this migration changes no behaviour.
-- Every one is wired to its function in part 3.
insert into settings (key, value, label, kind, required, min_value, max_value) values
  -- 50% of the order total, taken by InstaPay before the order proceeds. On a 2,000
  -- EGP order that is 1,000. Capped at the total in the functions themselves, so a
  -- deposit can never exceed what the customer actually owes.
  --
  -- Seeded at 50, exactly today's hardcoded behaviour, so this migration changes
  -- nothing until the number is changed in the settings screen.
  ('cod_deposit_percent', '50',
   'نسبة العربون المطلوب تحويله إنستاباي للطلبات الكاش الكبيرة (%)', 'numeric', true, 1, 100),
  ('driver_max_active_orders', '4',
   'أقصى عدد طلبات جارية للمندوب في نفس الوقت', 'numeric', true, 1, 20),
  ('no_answer_wait_minutes', '5',
   'دقائق انتظار قبل ما المندوب يقدر يبلّغ إن العميل مش بيرد', 'numeric', true, 1, 60)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Validate on WRITE, so a typo cannot reach a customer's checkout. D1.
-- ---------------------------------------------------------------------------
create or replace function private.validate_setting()
returns trigger language plpgsql as $fn$
declare v_num numeric;
begin
  -- A trailing space is the likeliest typo of all, and invisible in the input.
  new.value := btrim(coalesce(new.value, ''));

  if new.kind = 'numeric' then
    if new.value !~ '^-?[0-9]+(\.[0-9]+)?$' then
      raise exception 'invalid_setting_value:% must be a number, got "%"', new.key, new.value;
    end if;
    v_num := new.value::numeric;
    if new.min_value is not null and v_num < new.min_value then
      raise exception 'invalid_setting_value:% must be at least %', new.key, new.min_value;
    end if;
    if new.max_value is not null and v_num > new.max_value then
      raise exception 'invalid_setting_value:% must be at most %', new.key, new.max_value;
    end if;
  elsif new.kind = 'boolean' then
    if new.value not in ('true','false') then
      raise exception 'invalid_setting_value:% must be true or false, got "%"', new.key, new.value;
    end if;
  end if;

  return new;
end $fn$;

drop trigger if exists validate_setting_trg on settings;
create trigger validate_setting_trg before insert or update on settings
  for each row execute function private.validate_setting();

-- ---------------------------------------------------------------------------
-- 4. A required row cannot be deleted. D2, made unreachable rather than removed.
-- ---------------------------------------------------------------------------
create or replace function private.protect_required_setting()
returns trigger language plpgsql as $fn$
begin
  if old.required then
    raise exception 'setting_required:% cannot be deleted -- it governs money or dispatch policy', old.key;
  end if;
  return old;
end $fn$;

drop trigger if exists protect_required_setting_trg on settings;
create trigger protect_required_setting_trg before delete on settings
  for each row execute function private.protect_required_setting();

-- ---------------------------------------------------------------------------
-- 5. One accessor. No magic numbers beyond this point.
-- ---------------------------------------------------------------------------
create or replace function private.setting_num(p_key text, p_default numeric default null)
returns numeric language plpgsql stable as $fn$
declare v settings%rowtype;
begin
  select * into v from settings where key = p_key;

  if not found or v.value is null or v.value = '' then
    -- CLASS A: refuse to invent a policy. A checkout that fails loudly is recoverable;
    -- one that quietly charges the wrong amount is not.
    if p_default is null then
      raise exception 'setting_unavailable:%', p_key;
    end if;
    return p_default;
  end if;

  return v.value::numeric;
end $fn$;

create or replace function private.setting_bool(p_key text, p_default boolean default null)
returns boolean language plpgsql stable as $fn$
declare v text;
begin
  select value into v from settings where key = p_key;
  if v is null or v = '' then
    if p_default is null then raise exception 'setting_unavailable:%', p_key; end if;
    return p_default;
  end if;
  return v = 'true';
end $fn$;

revoke all on function private.setting_num(text, numeric) from public;
revoke all on function private.setting_bool(text, boolean) from public;

-- ---------------------------------------------------------------------------
-- 6. The three policy numbers, wired to their settings.
-- ---------------------------------------------------------------------------
-- Bodies below are the EXACT live definitions from pg_get_functiondef with only the
-- hardcoded number replaced -- generated and asserted rather than retyped, because
-- place_order is 13,306 characters and a transcription slip there is how checkout
-- died for two hours on 13 August.
--
-- The deposit is least(ceil(total * pct/100), total): 50% by default, and never more
-- than the customer actually owes.
--
-- The 4-order cap was written NINE times across EIGHT functions. All nine convert
-- together, or the setting would be a lie in whichever was left behind.
--
-- NOT converted, deliberately: push_nudge_sweep's interval '5 minutes' is an
-- order-AGE nudge, not the no-answer wait. Same number, different rule.

-- private.place_order
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
end; $function$
;

-- private.apply_order_promo
CREATE OR REPLACE FUNCTION private.apply_order_promo(p_order_id integer, p_code text, p_customer_id integer DEFAULT NULL::integer, p_customer_phone text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order orders%rowtype; v_promo promo_codes%rowtype; v_code text;
  v_key text; v_used integer; v_discount numeric;
  v_threshold numeric; v_deposit numeric; v_total numeric;
begin
  v_code := upper(trim(coalesce(p_code,'')));
  if v_code = '' then return 0; end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' then raise exception 'invalid_promo_code'; end if;
  select * into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  select * into v_promo from promo_codes where code = v_code for update;
  if not found or not v_promo.active then raise exception 'promo_invalid'; end if;
  if (v_promo.starts_at is not null and now() < v_promo.starts_at)
     or (v_promo.ends_at is not null and now() >= v_promo.ends_at) then raise exception 'promo_expired'; end if;
  if v_promo.restaurant_id is not null and v_promo.restaurant_id <> v_order.restaurant_id then raise exception 'promo_not_available'; end if;
  if v_promo.compound_id is not null and v_promo.compound_id <> v_order.compound_id then raise exception 'promo_not_available'; end if;
  if v_order.subtotal < v_promo.minimum_subtotal_egp then raise exception 'promo_minimum_not_met'; end if;

  if v_promo.max_redemptions is not null
     and (select count(*) from promo_redemptions
           where promo_code_id = v_promo.id and released_at is null) >= v_promo.max_redemptions then
    raise exception 'promo_limit_reached';
  end if;

  v_key := 'phone:' || normalize_phone(coalesce(nullif(trim(coalesce(p_customer_phone,'')), ''), v_order.customer_phone));
  if v_key is null or right(v_key,1) = ':' then raise exception 'promo_customer_missing'; end if;
  select count(*) into v_used from promo_redemptions
    where promo_code_id = v_promo.id and customer_key = v_key and released_at is null;
  if v_used >= v_promo.max_redemptions_per_customer then raise exception 'promo_already_used'; end if;

  v_discount := private.promo_discount_for(
    v_promo, v_order.subtotal, coalesce(v_order.delivery_fee,0), coalesce(v_order.service_fee,0));
  if v_discount <= 0 then raise exception 'promo_nothing_to_discount (promo_invalid)'; end if;

  update orders set promo_code_id = v_promo.id where id = p_order_id;
  insert into promo_redemptions(promo_code_id, order_id, customer_key, discount_amount)
    values (v_promo.id, p_order_id, v_key, v_discount);

  perform private.reprice_order(p_order_id);

  select total into v_total from orders where id = p_order_id;
  select coalesce((select value::numeric from settings where key = 'cod_deposit_threshold_egp'),300)
    into v_threshold;
  v_deposit := case when v_order.payment_method = 'cod' and v_total > v_threshold
                    then least(ceil(v_total * private.setting_num('cod_deposit_percent') / 100.0), v_total) else null end;

  update orders
     set cod_deposit_amount = v_deposit,
         online_payment_status = case
           when (payment_method in ('online','instapay') and v_total > 0) or v_deposit is not null
           then 'pending' else null end,
         status = case when status = 'awaiting_payment' and v_total = 0 then 'pending' else status end
   where id = p_order_id;

  return v_discount;
end $function$
;

-- private.confirm_custom_order_price
CREATE OR REPLACE FUNCTION private.confirm_custom_order_price(p_order_id integer, p_subtotal numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
end $function$
;

-- private.staff_create_pickup_order
CREATE OR REPLACE FUNCTION private.staff_create_pickup_order(p_restaurant_id integer, p_customer_name text, p_customer_phone text, p_compound_id integer, p_unit_number text, p_address_notes text DEFAULT ''::text, p_collect_amount numeric DEFAULT 0, p_request_notes text DEFAULT ''::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fee numeric; v_km numeric; v_sla int; v_prep int; v_buffer int;
  v_ready timestamptz; v_dispatch timestamptz;
  v_vendor_type text; v_vendor_name text; v_total numeric;
  v_pct numeric; v_service numeric; v_threshold numeric; v_deposit_advice numeric;
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

  -- Same source, same base and same rounding as place_order.
  select coalesce((select value::numeric from settings where key = 'service_fee_percent'), 0) into v_pct;
  v_service := round(coalesce(p_collect_amount,0) * v_pct / 100.0);

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
end $function$
;

-- private.switch_to_cash
CREATE OR REPLACE FUNCTION private.switch_to_cash(p_token uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_o orders%rowtype;
  v_net numeric; v_threshold numeric; v_deposit numeric; v_status text;
begin
  select * into v_o from orders where public_token = p_token for update;
  if not found then raise exception 'order_not_found'; end if;

  if v_o.status <> 'awaiting_payment' then raise exception 'wrong_stage'; end if;
  if coalesce(v_o.payment_method, 'cod') = 'cod' then raise exception 'already_cash'; end if;
  if v_o.instapay_claimed_at is not null then raise exception 'payment_already_claimed'; end if;

  if exists (select 1 from delivery_assignments da
              where da.order_id = v_o.id
                and da.status in ('Offered','Accepted','Picked_Up','Out_for_Delivery')) then
    raise exception 'already_assigned';
  end if;

  -- orders.total IS the net total. Do not subtract wallet_used again.
  v_net := coalesce(v_o.total, 0);
  select coalesce((select value::numeric from settings where key = 'cod_deposit_threshold_egp'), 300)
    into v_threshold;

  v_deposit := case when v_net > v_threshold then least(ceil(v_net * private.setting_num('cod_deposit_percent') / 100.0), v_net) else null end;

  v_status := case
    when v_deposit is not null then 'awaiting_payment'
    when v_o.dispatch_at is not null and v_o.dispatch_at > now() then 'Scheduled'
    else 'pending'
  end;

  update orders
     set payment_method        = 'cod',
         online_payment_status = null,
         cod_deposit_amount    = v_deposit,
         status                = v_status
   where id = v_o.id;

  insert into order_status_events (order_id, from_status, to_status, actor)
  values (v_o.id, v_o.status, v_status, 'customer');

  return json_build_object('status', v_status, 'deposit_required', v_deposit, 'total', v_o.total);
end $function$
;

-- private.driver_report_no_answer
CREATE OR REPLACE FUNCTION private.driver_report_no_answer(p_assignment_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_driver int; v_order_id int; v_out_at timestamptz; v_called_at timestamptz; v_already timestamptz;
begin
  v_driver := my_driver_id();
  if v_driver is null then raise exception 'not_a_driver'; end if;

  select order_id, out_for_delivery_at, called_customer_at, no_answer_reported_at
    into v_order_id, v_out_at, v_called_at, v_already
    from delivery_assignments where id = p_assignment_id and driver_id = v_driver;
  if v_order_id is null then raise exception 'not_your_assignment'; end if;
  if v_called_at is null then raise exception 'must_call_customer_first'; end if;
  if v_out_at is null or now() - v_out_at < (private.setting_num('no_answer_wait_minutes') * interval '1 minute') then raise exception 'too_early'; end if;
  -- Idempotent: a second tap (or the client's built-in retry-on-network-failure)
  -- must not page admin a second time about the same no-answer event.
  if v_already is not null then return; end if;

  update delivery_assignments set no_answer_reported_at = now() where id = p_assignment_id;
  perform notify_admin('العميل ما ردش ☎️', 'طلب #' || v_order_id || ' — المندوب اتصل والعميل ما ردش، محتاج قرار',
    jsonb_build_object('order_id', v_order_id, 'type', 'no_answer'));
end; $function$
;

-- public.driver_can_take_order
CREATE OR REPLACE FUNCTION public.driver_can_take_order(p_driver_id integer, p_order_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_active_count int; v_existing_direction text; v_new_direction text;
  v_vendor_type text; v_vehicle text; v_subtotal numeric; v_pricing text; v_threshold numeric;
begin
  select c.direction into v_new_direction
  from orders o left join compounds c on c.id = o.compound_id where o.id = p_order_id;

  select count(*), (array_agg(c.direction))[1] into v_active_count, v_existing_direction
  from delivery_assignments da
    join orders o2 on o2.id = da.order_id
    left join compounds c on c.id = o2.compound_id
  where da.driver_id = p_driver_id
    and da.status in ('Accepted','Picked_Up','Out_for_Delivery');

  if v_active_count >= private.setting_num('driver_max_active_orders') then return false; end if;
  if v_active_count > 0 and v_existing_direction is not null and v_new_direction is not null
     and v_existing_direction <> v_new_direction then return false; end if;

  -- Vehicle rule, previously only in available_orders and claim_order.
  select r.vendor_type, o.subtotal, coalesce(o.pricing_status, 'n/a')
    into v_vendor_type, v_subtotal, v_pricing
  from orders o join restaurants r on r.id = o.restaurant_id where o.id = p_order_id;

  if v_vendor_type = 'supermarket' then
    -- 300, matching available_orders and claim_order. Was 800 here alone.
    select coalesce((select value::numeric from settings where key = 'van_required_subtotal_egp'), 300)
      into v_threshold;
    if v_pricing = 'pending_quote' or coalesce(v_subtotal, 0) >= v_threshold then
      select vehicle_type into v_vehicle from drivers where id = p_driver_id;
      if coalesce(v_vehicle, '') <> 'van' then return false; end if;
    end if;
  end if;

  return true;
end
$function$
;

-- private.available_orders
CREATE OR REPLACE FUNCTION private.available_orders()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when my_driver_id() is null then '[]'::json
    else coalesce((select json_agg(row_to_json(x)) from (
      select o.id, o.total, o.zone, o.kitchen_status, o.created_at,
             o.ready_at, o.dispatch_at, r.name as restaurant_name, r.vendor_type,
             c.latitude as dest_lat, c.longitude as dest_lng
      from orders o
      join restaurants r on r.id = o.restaurant_id
      left join compounds c on c.id = o.compound_id
      join drivers d on d.id = my_driver_id()
      where is_predispatch_status(o.status)
        and order_is_dispatchable(o.id)
        and o.is_test = d.is_test
        and coalesce(o.dispatch_at, o.created_at) <= now()
        and (
          r.vendor_type <> 'supermarket'
          or d.vehicle_type = 'van'
          or coalesce(o.subtotal, 0) <
             coalesce((select value::numeric from settings where key = 'van_required_subtotal_egp'), 300)
        )
        and not exists (select 1 from delivery_assignments da
          where da.order_id = o.id
            and da.status in ('Offered','Accepted','Picked_Up','Out_for_Delivery','Delivered'))
        and (select count(*) from delivery_assignments da2
             where da2.driver_id = my_driver_id()
               and da2.status in ('Accepted','Picked_Up','Out_for_Delivery')) < private.setting_num('driver_max_active_orders')
        and coalesce((
          select c2.direction from delivery_assignments da3
            join orders o3 on o3.id = da3.order_id
            left join compounds c2 on c2.id = o3.compound_id
          where da3.driver_id = my_driver_id()
            and da3.status in ('Accepted','Picked_Up','Out_for_Delivery')
          limit 1
        ), c.direction, c.direction) = c.direction
      order by coalesce(o.ready_at, o.created_at)
    ) x), '[]'::json) end;
$function$
;

-- private.claim_order
CREATE OR REPLACE FUNCTION private.claim_order(p_order_id integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_driver int; v_attempt int; v_id int; v_vendor_type text; v_vehicle text;
  v_active_count int; v_active boolean; v_drv_test boolean; v_ord_test boolean;
  v_subtotal numeric; v_pricing_status text; v_threshold numeric; v_needs_van boolean;
  v_dispatch_at timestamptz;
begin
  v_driver := my_driver_id();
  if v_driver is null then raise exception 'not_a_driver'; end if;

  perform pg_advisory_xact_lock(v_driver);

  select active, is_test into v_active, v_drv_test from drivers where id = v_driver;
  if not v_active then raise exception 'driver_suspended'; end if;

  select r.vendor_type, o.subtotal, o.pricing_status, coalesce(o.dispatch_at, o.created_at), o.is_test
    into v_vendor_type, v_subtotal, v_pricing_status, v_dispatch_at, v_ord_test
  from orders o join restaurants r on r.id = o.restaurant_id where o.id = p_order_id;

  if v_ord_test is distinct from v_drv_test then raise exception 'not_your_pool'; end if;

  if v_dispatch_at > now() then raise exception 'not_ready_yet'; end if;

  if not is_predispatch_status((select status from orders where id = p_order_id)) then
    raise exception 'already_taken';
  end if;

  if not order_is_dispatchable(p_order_id) then
    raise exception 'kitchen_not_accepted_yet';
  end if;

  select vehicle_type into v_vehicle from drivers where id = v_driver;

  select coalesce((select value::numeric from settings where key = 'van_required_subtotal_egp'), 300)
    into v_threshold;

  if v_pricing_status = 'pending_quote' then raise exception 'order_not_priced'; end if;

  v_needs_van := v_vendor_type = 'supermarket'
    and (v_pricing_status = 'pending_quote' or coalesce(v_subtotal, 0) >= v_threshold);

  if v_needs_van and v_vehicle <> 'van' then
    raise exception 'wrong_vehicle_type';
  end if;

  if not driver_can_take_order(v_driver, p_order_id) then
    raise exception 'dispatch_rule_blocked';
  end if;

  perform 1 from orders where id = p_order_id for update;

  if exists (select 1 from delivery_assignments
             where order_id = p_order_id
               and status in ('Offered','Accepted','Picked_Up','Out_for_Delivery','Delivered')) then
    raise exception 'already_taken';
  end if;

  select coalesce(max(attempt_number),0) + 1 into v_attempt
    from delivery_assignments where order_id = p_order_id;

  insert into delivery_assignments (order_id, driver_id, attempt_number, status,
                                    offered_at, responded_at)
  values (p_order_id, v_driver, v_attempt, 'Accepted', now(), now())
  returning id into v_id;

  select count(*) into v_active_count from delivery_assignments
    where driver_id = v_driver and status in ('Accepted','Picked_Up','Out_for_Delivery');

  update orders set status = 'Accepted' where id = p_order_id;
  update drivers set status = 'On_Delivery', available = (v_active_count < private.setting_num('driver_max_active_orders')) where id = v_driver;

  return json_build_object('assignment_id', v_id);
end; $function$
;

-- private.driver_accept_assignment
CREATE OR REPLACE FUNCTION private.driver_accept_assignment(p_assignment_id integer, p_order_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_driver int; v_active_count int; v_active boolean; v_status text; v_order int;
begin
  v_driver := my_driver_id();
  if v_driver is null then raise exception 'not_a_driver'; end if;

  perform pg_advisory_xact_lock(v_driver);

  select active into v_active from drivers where id = v_driver;
  if not v_active then raise exception 'driver_suspended'; end if;

  select status, order_id into v_status, v_order
    from delivery_assignments
   where id = p_assignment_id and driver_id = v_driver
   for update;
  if v_order is null then raise exception 'not_your_assignment'; end if;
  if v_status <> 'Offered' then raise exception 'wrong_stage'; end if;

  if not driver_can_take_order(v_driver, p_order_id) then
    raise exception 'dispatch_rule_blocked';
  end if;

  update delivery_assignments set status = 'Accepted', responded_at = now() where id = p_assignment_id;
  update orders set status = 'Accepted' where id = p_order_id;

  select count(*) into v_active_count from delivery_assignments
    where driver_id = v_driver and status in ('Accepted','Picked_Up','Out_for_Delivery');

  update drivers set status = 'On_Delivery', available = (v_active_count < private.setting_num('driver_max_active_orders')) where id = v_driver;
end $function$
;

-- private.admin_unassign_order
CREATE OR REPLACE FUNCTION private.admin_unassign_order(p_order_id integer, p_reason text DEFAULT 'admin_unassigned'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_driver int; v_active int;
begin
  if not supervisor_may_touch_order(p_order_id) then raise exception 'admin_only'; end if;

  select driver_id into v_driver from delivery_assignments
    where order_id = p_order_id
      and status in ('Offered','Accepted','Picked_Up','Out_for_Delivery')
    order by attempt_number desc limit 1;
  if v_driver is null then raise exception 'no_active_assignment'; end if;

  update delivery_assignments
     set status = 'Cancelled',
         rejection_reason = coalesce(nullif(trim(p_reason), ''), 'admin_unassigned')
   where order_id = p_order_id
     and status in ('Offered','Accepted','Picked_Up','Out_for_Delivery');

  update orders set status = 'Driver_Searching'
   where id = p_order_id and status not in ('Delivered','Cancelled','Failed_Delivery');

  select count(*) into v_active from delivery_assignments
    where driver_id = v_driver and status in ('Accepted','Picked_Up','Out_for_Delivery');
  update drivers
     set available = (v_active < private.setting_num('driver_max_active_orders')),
         status = case when v_active = 0 then 'Available' else status end
   where id = v_driver;
end $function$
;

-- private.cancel_order
CREATE OR REPLACE FUNCTION private.cancel_order(p_order_id integer, p_reason text DEFAULT ''::text, p_token uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text; v_kitchen text; v_public_token uuid; v_restaurant_id int;
  v_driver_id int; v_active_count int;
  v_wallet_used numeric; v_customer_phone text; v_wallet_id int;
  v_payment_method text; v_online_status text; v_instapay_claimed boolean; v_total numeric;
  v_cod_deposit numeric; v_is_vendor boolean; v_is_admin boolean; v_reason text;
begin
  select status, kitchen_status, public_token, restaurant_id, wallet_used, customer_phone,
         payment_method, online_payment_status, instapay_claimed_at is not null, total, cod_deposit_amount
    into v_status, v_kitchen, v_public_token, v_restaurant_id, v_wallet_used, v_customer_phone,
         v_payment_method, v_online_status, v_instapay_claimed, v_total, v_cod_deposit
    from orders where id = p_order_id for update;
  if v_status is null then raise exception 'order_not_found'; end if;

  v_is_admin  := is_admin() or supervisor_may_touch_order(p_order_id);
  v_is_vendor := my_restaurant_id() is not null and my_restaurant_id() = v_restaurant_id;

  if not (
    (p_token is not null and p_token = v_public_token)
    or v_is_vendor
    or v_is_admin
  ) then
    raise exception 'not_authorized';
  end if;

  if v_status in ('Delivered','Cancelled') then raise exception 'order_closed'; end if;

  if not v_is_admin and not v_is_vendor then
    if not is_customer_cancellable_status(v_status) then
      raise exception 'too_late_to_cancel';
    end if;
    if coalesce(v_kitchen, 'new') <> 'new' then
      raise exception 'too_late_to_cancel';
    end if;
  elsif v_is_vendor and not v_is_admin then
    if v_status not in ('pending','awaiting_payment','awaiting_quote','Scheduled','Driver_Searching','No_Driver_Found') then
      raise exception 'too_late_to_cancel';
    end if;
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if not v_is_admin and not v_is_vendor
     and v_reason not in (
       'customer_waiting_too_long',
       'customer_price_too_high',
       'customer_payment_problem',
       'customer_ordered_by_mistake',
       'customer_changed_mind',
       'customer_other'
     ) then
    v_reason := 'customer_other';
  end if;

  update orders set status = 'Cancelled',
    cancel_reason = v_reason,
    cancelled_at  = now(),
    refund_status = case
      when v_payment_method in ('instapay','online')
           and (v_instapay_claimed or v_online_status = 'paid')
           and v_total > 0
      then 'pending'
      when v_payment_method = 'cod' and v_cod_deposit is not null
           and (v_instapay_claimed or v_online_status = 'paid')
      then 'pending'
      else refund_status
    end
  where id = p_order_id;

  -- Give the promo redemption back. A cancelled order used to hold its
  -- redemption forever: it counted against max_redemptions and against the
  -- customer's own allowance, so a code could exhaust itself on orders that
  -- never happened and a customer whose order was cancelled could not retry.
  -- The row stays, with its discount_amount, for reporting.
  update promo_redemptions set released_at = now()
   where order_id = p_order_id and released_at is null;

  if v_wallet_used is not null and v_wallet_used > 0 then
    select id into v_wallet_id from customer_wallets where phone = normalize_phone(v_customer_phone) for update;
    if v_wallet_id is not null then
      update customer_wallets set balance = balance + v_wallet_used where id = v_wallet_id;
      insert into wallet_transactions (wallet_id, amount, reason, order_id)
        values (v_wallet_id, v_wallet_used, 'استرداد بسبب إلغاء الطلب #' || p_order_id, p_order_id);
    end if;
  end if;

  select driver_id into v_driver_id from delivery_assignments
    where order_id = p_order_id and status in ('Offered','Accepted','Picked_Up','Out_for_Delivery')
    limit 1;

  update delivery_assignments set status = 'Cancelled',
    rejection_reason = coalesce(v_reason, 'order_cancelled')
  where order_id = p_order_id and status in ('Offered','Accepted','Picked_Up','Out_for_Delivery');

  if v_driver_id is not null then
    select count(*) into v_active_count from delivery_assignments
      where driver_id = v_driver_id and status in ('Accepted','Picked_Up','Out_for_Delivery');
    update drivers set available = (v_active_count < private.setting_num('driver_max_active_orders')),
      status = case when v_active_count = 0 then 'Available' else status end
    where id = v_driver_id;
  end if;
end $function$
;

-- private.mark_delivered
CREATE OR REPLACE FUNCTION private.mark_delivered(p_assignment_id integer, p_order_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_driver int; v_status text; v_total numeric; v_fee numeric;
  v_driver_earning numeric; v_admin_amount numeric;
  v_payment_method text; v_cod_deposit numeric; v_cash_due numeric;
  v_cash_confirmed timestamptz; v_remaining int; v_is_test boolean;
begin
  select driver_id, status, cash_confirmed_at into v_driver, v_status, v_cash_confirmed
    from delivery_assignments where id = p_assignment_id;
  if v_driver is null or v_driver <> my_driver_id() then raise exception 'not_your_assignment'; end if;
  if v_status <> 'Out_for_Delivery' then raise exception 'wrong_stage'; end if;

  select total, delivery_fee, payment_method, cod_deposit_amount, is_test
    into v_total, v_fee, v_payment_method, v_cod_deposit, v_is_test
    from orders where id = p_order_id;

  v_cash_due := case
    when v_payment_method = 'instapay' then 0
    when v_cod_deposit is not null then v_total - v_cod_deposit
    else v_total
  end;

  if v_cash_due > 0 and v_cash_confirmed is null then
    raise exception 'must_confirm_cash_first';
  end if;

  update delivery_assignments set status = 'Delivered', delivered_at = now() where id = p_assignment_id;
  update orders set status = 'Delivered' where id = p_order_id;

  select count(*) into v_remaining from delivery_assignments
    where driver_id = v_driver and status in ('Accepted','Picked_Up','Out_for_Delivery');

  if v_is_test then
    update drivers set
      status    = case when v_remaining = 0 then 'Available' else status end,
      available = (v_remaining < private.setting_num('driver_max_active_orders'))
    where id = v_driver;
    return;
  end if;

  v_fee := coalesce(v_fee, 65);

  select coalesce((select value::numeric from settings where key = 'driver_flat_earning_egp'), 10)
    into v_driver_earning;
  v_driver_earning := least(greatest(v_driver_earning, 0), v_fee);
  v_admin_amount := v_fee - v_driver_earning;

  insert into driver_earnings (driver_id, order_id, assignment_id, delivery_fee, driver_earning, admin_amount)
  values (v_driver, p_order_id, p_assignment_id, v_fee, v_driver_earning, v_admin_amount)
  on conflict (assignment_id) do nothing;

  update drivers set
    status           = case when v_remaining = 0 then 'Available' else status end,
    available        = (v_remaining < private.setting_num('driver_max_active_orders')),
    total_deliveries = coalesce(total_deliveries, 0) + 1,
    cash_held        = coalesce(cash_held, 0) + greatest(coalesce(v_cash_due, 0), 0)
  where id = v_driver;
end; $function$
;

-- private.mark_delivery_failed
CREATE OR REPLACE FUNCTION private.mark_delivery_failed(p_assignment_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_order_id int; v_driver int; v_active_count int; v_fee numeric; v_earn numeric;
begin
  if not supervisor_may_touch_order((select order_id from delivery_assignments where id = p_assignment_id)) then raise exception 'admin_only'; end if;

  select order_id, driver_id into v_order_id, v_driver
  from delivery_assignments where id = p_assignment_id for update;
  if v_driver is null then raise exception 'assignment_not_found'; end if;

  select coalesce(delivery_fee, 50) into v_fee from orders where id = v_order_id;

  select coalesce((select value::numeric from settings where key = 'driver_flat_earning_egp'), 10)
    into v_earn;
  v_earn := least(greatest(v_earn, 0), v_fee);

  update delivery_assignments set status = 'Failed' where id = p_assignment_id;
  update orders set status = 'Failed_Delivery' where id = v_order_id;

  insert into driver_earnings (driver_id, order_id, assignment_id, delivery_fee, driver_earning, admin_amount)
  values (v_driver, v_order_id, p_assignment_id, v_fee, v_earn, v_fee - v_earn)
  on conflict (assignment_id) do nothing;

  select count(*) into v_active_count from delivery_assignments
    where driver_id = v_driver and status in ('Accepted','Picked_Up','Out_for_Delivery');

  update drivers set status = case when v_active_count = 0 then 'Available' else status end,
    available = (v_active_count < private.setting_num('driver_max_active_orders'))
  where id = v_driver;
end; $function$
;
