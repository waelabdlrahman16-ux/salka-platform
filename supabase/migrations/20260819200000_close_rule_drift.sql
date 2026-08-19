-- Close the four places where one rule is written twice.
--
-- WHY. A full inventory of the surface on 2026-08-19 (18 screens, 26 edge
-- functions, 303 database functions) was searched deliberately for ONE fault:
-- a rule copied into a second place that then drifted from the first. That is
-- what took checkout down for two hours on 13 August, and it is the shape of
-- both promo bugs found on 19 August. Four instances exist. This closes all
-- four.
--
-- NONE OF THE FOUR IS CAUSING A PROBLEM TODAY, and this migration is therefore
-- BEHAVIOUR-NEUTRAL on the live database. Every fallback below is only ever
-- read when its settings row is missing, and all the rows exist. The point is
-- to remove traps that spring later, not to change what happens now. Anything
-- here that DID change live behaviour would be a bug in this migration.
--
-- THE ONE RULE THAT MATTERS WHILE READING THIS: the corrected function bodies
-- below are authored in full, explicitly. They are NOT produced by patching the
-- old text. Migration 20260813172545 patched three function bodies with a
-- string replace(), 'compound_id,' also matched inside 'p_compound_id,', the
-- replacement fired twice, and every order-creation call raised
-- `column "kitchen_id" does not exist` for two hours. Never again.
--
-- ROLLBACK. Each section names its own reversal inline.

-- ---------------------------------------------------------------------------
-- 1. The van rule had two fallbacks: 300 in two functions, 800 in a third.
-- ---------------------------------------------------------------------------
-- available_orders and claim_order both fall back to 300; driver_can_take_order
-- fell back to 800. The live setting is 9000, so all three agree today and
-- nothing changes. If that row were ever deleted they would disagree, and
-- because admin_assign_order consults ONLY driver_can_take_order, an admin
-- could put a motorbike on an order the same driver could never have claimed
-- himself -- the assignment would succeed and the claim would have been
-- refused. Aligning on 300 matches the majority and is the stricter of the two
-- (a van is required sooner, not later), which is the safer way to be wrong.
--
-- Only the number changes. The body is otherwise identical to the live one.
--
-- ROLLBACK: the same CREATE OR REPLACE with 800 in place of 300.

CREATE OR REPLACE FUNCTION public.driver_can_take_order(p_driver_id integer, p_order_id integer)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

  if v_active_count >= 4 then return false; end if;
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
$function$;

-- ---------------------------------------------------------------------------
-- 2. The cash-deposit threshold had two fallbacks, ten times apart.
-- ---------------------------------------------------------------------------
-- place_order, confirm_custom_order_price, staff_create_pickup_order and
-- switch_to_cash all fall back to 300. apply_order_promo fell back to 3000.
-- The live setting is 2000, so all five agree today.
--
-- The divergence is not mysterious: apply_order_promo was authored fresh in
-- 20260814105924 and picked its own number, while place_order's 300 predates
-- it. That is the whole fingerprint of this class of fault -- a later author
-- writing the same rule again rather than reading the existing one.
--
-- If the settings row were deleted, whether a customer is asked for a cash
-- deposit would depend on whether they used a promo code. Aligning on 300
-- matches the four and is again the stricter direction.
--
-- Only the number changes. This body is otherwise identical to the live one
-- installed by 20260819170100.
--
-- ROLLBACK: the same CREATE OR REPLACE with 3000 in place of 300.

CREATE OR REPLACE FUNCTION private.apply_order_promo(p_order_id integer, p_code text, p_customer_id integer DEFAULT NULL::integer, p_customer_phone text DEFAULT NULL::text)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_order orders%rowtype; v_promo promo_codes%rowtype; v_code text;
  v_key text; v_used integer; v_discount numeric; v_gross numeric; v_final_gross numeric;
  v_new_wallet numeric; v_wallet_refund numeric := 0; v_threshold numeric; v_deposit numeric;
  v_service numeric; v_delivery numeric; v_cut_service numeric := 0;
  v_cut_delivery numeric := 0; v_cut_vendor numeric := 0;
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

  v_service  := coalesce(v_order.service_fee, 0);
  v_delivery := coalesce(v_order.delivery_fee, 0);
  v_discount := private.promo_discount_for(v_promo, v_order.subtotal, v_delivery, v_service);
  if v_discount <= 0 then raise exception 'promo_nothing_to_discount (promo_invalid)'; end if;

  if v_promo.applies_to = 'delivery' then
    v_cut_delivery := v_discount;
  elsif v_promo.applies_to = 'service' then
    v_cut_service := v_discount;
  elsif v_promo.applies_to = 'vendor' then
    v_cut_vendor := v_discount;
  elsif v_promo.applies_to = 'platform' then
    v_cut_service  := least(v_discount, v_service);
    v_cut_delivery := v_discount - v_cut_service;
  else
    v_cut_service  := least(v_discount, v_service);
    v_cut_delivery := least(v_discount - v_cut_service, v_delivery);
    v_cut_vendor   := v_discount - v_cut_service - v_cut_delivery;
  end if;

  v_gross := v_order.subtotal + v_delivery + v_service;
  v_final_gross := greatest(0, v_gross - v_discount);
  v_new_wallet := least(coalesce(v_order.wallet_used,0), v_final_gross);
  v_wallet_refund := coalesce(v_order.wallet_used,0) - v_new_wallet;
  if v_wallet_refund > 0 then
    update customer_wallets set balance = balance + v_wallet_refund
      where phone = normalize_phone(v_order.customer_phone);
    insert into wallet_transactions(wallet_id, amount, reason, order_id)
      select id, v_wallet_refund, 'استرجاع رصيد بعد كود خصم', p_order_id
      from customer_wallets where phone = normalize_phone(v_order.customer_phone);
  end if;
  -- 300, matching place_order, confirm_custom_order_price,
  -- staff_create_pickup_order and switch_to_cash. Was 3000 here alone.
  select coalesce((select value::numeric from settings where key = 'cod_deposit_threshold_egp'),300) into v_threshold;
  v_deposit := case when v_order.payment_method = 'cod' and v_final_gross - v_new_wallet > v_threshold
    then ceil((v_final_gross - v_new_wallet) * .5) else null end;
  update orders set promo_code_id=v_promo.id, promo_discount=v_discount,
    promo_discount_service=v_cut_service, promo_discount_delivery=v_cut_delivery, promo_discount_vendor=v_cut_vendor,
    wallet_used=v_new_wallet,
    total=v_final_gross-v_new_wallet, cod_deposit_amount=v_deposit,
    online_payment_status=case when (payment_method in ('online','instapay') and v_final_gross-v_new_wallet > 0) or v_deposit is not null then 'pending' else null end,
    status=case when status='awaiting_payment' and v_final_gross-v_new_wallet=0 then 'pending' else status end
  where id=p_order_id;
  insert into promo_redemptions(promo_code_id,order_id,customer_key,discount_amount)
    values(v_promo.id,p_order_id,v_key,v_discount);
  return v_discount;
end $function$;

-- ---------------------------------------------------------------------------
-- 3. Drop the orphaned four-argument private.quote_promo_code.
-- ---------------------------------------------------------------------------
-- It was created by 20260813190000 and orphaned the next day by
-- 20260814105924, which rewired the public four-argument wrapper to derive the
-- fees and call the SIX-argument private version instead. Nothing has called it
-- since.
--
-- It matters because its body predates promo_discount_for: it computes the
-- discount off the subtotal and ignores applies_to entirely. Under it a
-- delivery promo would come off the whole basket. It is a wrong answer waiting
-- for a caller.
--
-- THE PUBLIC FOUR-ARGUMENT VERSION STAYS. It is not a duplicate -- it is a
-- deliberate compatibility shim for already-installed app bundles, added by
-- 20260814105924 after turning it into an "update your app" stub took promo
-- quoting offline for every installed client during a live campaign. It
-- delegates to the six-argument private version and is correct. Do not remove
-- it: the Capacitor shells load the web bundle at their own pace.
--
-- Verified before dropping: no database function body references it, no edge
-- function references it, the frontend calls the six-argument public version,
-- and PostgREST cannot reach the private schema at all.
--
-- ROLLBACK: recreate from 20260813190000 lines 131-143. Nothing calls it, so
-- restoring it is only ever needed to undo this file cleanly.

drop function if exists private.quote_promo_code(text, integer, integer, numeric);

-- ---------------------------------------------------------------------------
-- 4. Give stall_quote_minutes the settings row it never had.
-- ---------------------------------------------------------------------------
-- Of the fifteen tunable settings the code reads, this is the only one with no
-- row. stalled_orders falls back to its built-in 10 minutes and works
-- correctly -- so this is not a bug, it is the one number on that screen the
-- admin panel cannot change.
--
-- Inserted at 10 to match the fallback exactly, so nothing moves.
--
-- ROLLBACK: delete from settings where key = 'stall_quote_minutes';

insert into settings (key, value, label)
values ('stall_quote_minutes', '10', 'دقائق قبل اعتبار الطلب المخصص متأخرًا في التسعير')
on conflict (key) do nothing;
