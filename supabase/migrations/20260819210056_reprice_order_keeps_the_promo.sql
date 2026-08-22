-- Make a promo discount survive a change to the order's price.
--
-- WHY. promo_discount was written once, when the order was created, and never
-- revisited. Two functions can change what an order costs afterwards --
-- admin_adjust_order and confirm_custom_order_price -- and BOTH computed the
-- new total as:
--
--     total = subtotal + delivery_fee + service_fee - wallet_used
--
-- with no promo term at all. So the fault was worse than a stale number: an
-- adjustment did not shrink the discount, it DELETED it from the total.
--
-- Found on production, 19 August, across the fourteen orders that used
-- SOKHNA30:
--
--   order 427  charged 448.00, should have been 420.10   discount lost entirely
--   order 277  charged 801.50, should have been 784.70   discount too small
--   order 251  charged 758.50, should have been 742.60   discount too small
--   order 203  charged 861.50, should have been 843.50   discount too small
--   order 275  charged 499.50, should have been 489.30   discount too small
--   order 200  charged 407.50, should have been 399.40   discount too small
--   order 215  charged 196.00, should have been 194.50   discount too small
--
-- 98.40 EGP overcharged in total, every case against the customer. Five of the
-- seven were given exactly 19.50 -- 30% of the delivery fee with the service fee
-- still at zero -- because the discount was fixed before the service fee was set
-- and never looked at again.
--
-- THE SHAPE OF THE FIX. The rule "what does this order cost, given its promo"
-- was written in three places and disagreed in all three. It now lives in ONE:
-- private.reprice_order. The two functions that move the price stop computing a
-- total at all and call it. apply_order_promo keeps its own job -- validating
-- the code, enforcing the caps, recording the redemption -- but hands the
-- arithmetic over too, so first-time application and later repricing can never
-- diverge. That is the same class of fault as 20260819200000 closed, arriving
-- through a different door.
--
-- DELIBERATELY NOT CHANGED: the cash-on-delivery deposit is not recomputed when
-- an admin adjusts an order. Raising a deposit on an order the customer already
-- placed would demand more money mid-flight. confirm_custom_order_price still
-- sets its deposit, because that is the moment the customer is first told the
-- price -- but it now sets it from the DISCOUNTED total, which is what they
-- actually owe.
--
-- Bodies below are authored in full, explicitly. Never patch a function body
-- with replace() -- see 20260813172545, two hours of dead checkout.
--
-- ORDERING DEPENDENCY, and it matters because these are applied by hand.
-- 20260819200000_close_rule_drift.sql ALSO replaces apply_order_promo. Apply
-- that one FIRST. If it lands after this file, it reinstates the pre-refactor
-- body and silently undoes the fix. The apply_order_promo below already carries
-- that migration's 300 threshold, so in the right order the two agree.
--
-- ROLLBACK: restore the four functions from the migrations named against each,
-- and drop private.promo_split and private.reprice_order. No schema changes, no
-- data is rewritten by this file.

-- ---------------------------------------------------------------------------
-- 1. The split rule, in one place.
-- ---------------------------------------------------------------------------
-- Which pot a discount comes out of. Lifted verbatim from apply_order_promo,
-- which was its only home; it is now shared with reprice_order so the two
-- cannot drift.
create or replace function private.promo_split(
  p_applies_to text, p_discount numeric, p_delivery numeric, p_service numeric,
  out cut_service numeric, out cut_delivery numeric, out cut_vendor numeric
) language plpgsql immutable as $fn$
begin
  cut_service := 0; cut_delivery := 0; cut_vendor := 0;
  if p_applies_to = 'delivery' then
    cut_delivery := p_discount;
  elsif p_applies_to = 'service' then
    cut_service := p_discount;
  elsif p_applies_to = 'vendor' then
    cut_vendor := p_discount;
  elsif p_applies_to = 'platform' then
    cut_service  := least(p_discount, p_service);
    cut_delivery := p_discount - cut_service;
  else
    -- 'all' waterfalls: drain both platform fees before touching the vendor.
    cut_service  := least(p_discount, p_service);
    cut_delivery := least(p_discount - cut_service, p_delivery);
    cut_vendor   := p_discount - cut_service - cut_delivery;
  end if;
end $fn$;

-- ---------------------------------------------------------------------------
-- 2. What an order costs, given its promo. The single owner of that answer.
-- ---------------------------------------------------------------------------
-- Safe to call on an order with no promo: the discount is zero and it simply
-- recomputes the total, which is what admin_adjust_order and
-- confirm_custom_order_price used to do inline.
--
-- It does NOT validate the code or touch the caps. The redemption already
-- exists by the time this runs; re-checking would refuse the customer their own
-- discount on the second call.
create or replace function private.reprice_order(p_order_id integer)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_o orders%rowtype; v_promo promo_codes%rowtype;
  v_discount numeric := 0; v_cs numeric := 0; v_cd numeric := 0; v_cv numeric := 0;
  v_gross numeric; v_final numeric; v_wallet numeric; v_refund numeric;
begin
  select * into v_o from orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  if v_o.promo_code_id is not null then
    select * into v_promo from promo_codes where id = v_o.promo_code_id;
    if found then
      v_discount := private.promo_discount_for(
        v_promo, coalesce(v_o.subtotal,0), coalesce(v_o.delivery_fee,0), coalesce(v_o.service_fee,0));
      select cut_service, cut_delivery, cut_vendor into v_cs, v_cd, v_cv
        from private.promo_split(v_promo.applies_to, v_discount,
                                 coalesce(v_o.delivery_fee,0), coalesce(v_o.service_fee,0));
    end if;
  end if;

  v_gross  := coalesce(v_o.subtotal,0) + coalesce(v_o.delivery_fee,0) + coalesce(v_o.service_fee,0);
  v_final  := greatest(0, v_gross - v_discount);
  v_wallet := least(coalesce(v_o.wallet_used,0), v_final);

  -- If a bigger discount means less of the customer's wallet is needed, the
  -- difference goes back to them. apply_order_promo already did this on first
  -- application; without it here, a repriced order would quietly keep balance
  -- it no longer needs.
  v_refund := coalesce(v_o.wallet_used,0) - v_wallet;
  if v_refund > 0 then
    update customer_wallets set balance = balance + v_refund
      where phone = normalize_phone(v_o.customer_phone);
    insert into wallet_transactions (wallet_id, amount, reason, order_id)
      select id, v_refund, 'استرجاع رصيد بعد تعديل الطلب', p_order_id
        from customer_wallets where phone = normalize_phone(v_o.customer_phone);
  end if;

  update orders
     set promo_discount           = v_discount,
         promo_discount_service   = v_cs,
         promo_discount_delivery  = v_cd,
         promo_discount_vendor    = v_cv,
         wallet_used              = v_wallet,
         total                    = v_final - v_wallet
   where id = p_order_id;

  -- Reporting reads the redemption, not the order, so it has to agree.
  update promo_redemptions set discount_amount = v_discount
   where order_id = p_order_id and released_at is null;
end $fn$;

revoke all on function private.reprice_order(integer) from public;
revoke all on function private.promo_split(text,numeric,numeric,numeric) from public;

-- ---------------------------------------------------------------------------
-- 3. apply_order_promo hands the arithmetic to the shared owner.
-- ---------------------------------------------------------------------------
-- Keeps everything only it can do -- validating the code, the two caps, the
-- phone identity, recording the redemption -- and stops doing the sums itself.
-- Current body from 20260819170100, plus 20260819200000's threshold alignment.
CREATE OR REPLACE FUNCTION private.apply_order_promo(p_order_id integer, p_code text, p_customer_id integer DEFAULT NULL::integer, p_customer_phone text DEFAULT NULL::text)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

  -- Refuse a code that would be worth nothing BEFORE recording a redemption
  -- against it, so a zero-value attempt does not burn the customer's allowance.
  v_discount := private.promo_discount_for(
    v_promo, v_order.subtotal, coalesce(v_order.delivery_fee,0), coalesce(v_order.service_fee,0));
  if v_discount <= 0 then raise exception 'promo_nothing_to_discount (promo_invalid)'; end if;

  -- The redemption first, then the arithmetic: reprice_order reads
  -- orders.promo_code_id, so the link has to exist before it runs.
  update orders set promo_code_id = v_promo.id where id = p_order_id;
  insert into promo_redemptions(promo_code_id, order_id, customer_key, discount_amount)
    values (v_promo.id, p_order_id, v_key, v_discount);

  perform private.reprice_order(p_order_id);

  -- The deposit is half of what the customer actually owes, so it is read from
  -- the repriced total rather than recomputed from the parts.
  select total into v_total from orders where id = p_order_id;
  select coalesce((select value::numeric from settings where key = 'cod_deposit_threshold_egp'),300)
    into v_threshold;
  v_deposit := case when v_order.payment_method = 'cod' and v_total > v_threshold
                    then ceil(v_total * .5) else null end;

  update orders
     set cod_deposit_amount = v_deposit,
         online_payment_status = case
           when (payment_method in ('online','instapay') and v_total > 0) or v_deposit is not null
           then 'pending' else null end,
         status = case when status = 'awaiting_payment' and v_total = 0 then 'pending' else status end
   where id = p_order_id;

  return v_discount;
end $function$;

-- ---------------------------------------------------------------------------
-- 4. admin_adjust_order stops computing a total.
-- ---------------------------------------------------------------------------
-- It sets the subtotal and the service fee, which are its business, then asks
-- reprice_order what the order now costs. Everything else -- the actor check,
-- the adjustment line, the derived-from-lines rule, the waived-fee record, the
-- returned summary -- is unchanged.
--
-- The deposit is deliberately NOT recomputed here. See the header.
CREATE OR REPLACE FUNCTION private.admin_adjust_order(p_order_id integer, p_amount numeric, p_reason text, p_charge_service_fee boolean DEFAULT false)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_actor text; v_o orders%rowtype;
  v_pct numeric; v_new_subtotal numeric; v_new_fee numeric; v_waived numeric := null;
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

  insert into order_items (order_id, menu_item_id, name, qty, unit_price, total,
                           is_adjustment, created_by)
  values (p_order_id, null, trim(p_reason), 1, p_amount, p_amount, true, v_actor)
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

  select coalesce((select value::numeric from settings where key = 'service_fee_percent'), 0)
    into v_pct;

  if p_charge_service_fee then
    v_new_fee := round(v_new_subtotal * v_pct / 100.0);
  else
    v_new_fee := v_o.service_fee;
    v_waived  := round(v_new_subtotal * v_pct / 100.0) - coalesce(v_o.service_fee, 0);
    if v_waived <= 0 then v_waived := null; end if;
    update order_items set service_fee_waived = v_waived where id = v_line_id;
  end if;

  update orders
     set subtotal = v_new_subtotal, service_fee = v_new_fee
   where id = p_order_id;

  -- The total, and the promo that comes off it, are not this function's to
  -- compute. This is the whole fix: the discount used to vanish here.
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
    'actor',              v_actor
  );
end $function$;

-- ---------------------------------------------------------------------------
-- 5. confirm_custom_order_price stops computing a total.
-- ---------------------------------------------------------------------------
-- This is the moment a هنجبلك customer is first told the price, so the deposit
-- IS set here -- but from the discounted total, which is what they owe. Before,
-- a customer who applied a promo to a custom request was quoted the full price
-- and asked for a deposit on it.
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

  -- Same source, same base (subtotal only) and same rounding as place_order, so
  -- a supermarket run and a catalogue basket of equal value cost the customer
  -- the same.
  select coalesce((select value::numeric from settings where key = 'service_fee_percent'), 0) into v_pct;
  v_service := round(p_subtotal * v_pct / 100.0);

  update orders set subtotal = p_subtotal, service_fee = v_service, pricing_status = 'confirmed'
   where id = p_order_id;

  -- The total, and any promo on it, come from the one owner.
  perform private.reprice_order(p_order_id);
  select total into v_total from orders where id = p_order_id;

  -- Deposit on what is actually owed, computed AFTER the discount.
  v_deposit := null;
  if v_o.payment_method = 'cod' then
    select coalesce((select value::numeric from settings where key = 'cod_deposit_threshold_egp'), 300)
      into v_threshold;
    if v_total > v_threshold then v_deposit := ceil(v_total * 0.5); end if;
  end if;

  v_status := case
    when v_deposit is not null then 'awaiting_payment'
    when v_o.status = 'awaiting_quote' then
      -- 'Scheduled' only if the customer actually booked a slot. A non-slot
      -- custom order with a future dispatch_at is an ASAP order mid-prep.
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
