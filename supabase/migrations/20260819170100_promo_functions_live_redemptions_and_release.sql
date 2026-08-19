-- Applied to production 2026-08-19 via MCP; recorded here so the repo and the
-- database do not drift. Companion to
-- 20260819170000_promo_release_on_cancel_and_phone_identity.sql.
--
-- apply_order_promo: both caps count only rows with released_at is null, and
-- the per-customer key is ALWAYS the phone (it was 'customer:<id>' when signed
-- in, which handed the same human a second allowance on sign-in).
-- cancel_order: releases the redemption, beside the wallet refund it already did.

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
  select coalesce((select value::numeric from settings where key = 'cod_deposit_threshold_egp'),3000) into v_threshold;
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

CREATE OR REPLACE FUNCTION private.cancel_order(p_order_id integer, p_reason text DEFAULT ''::text, p_token uuid DEFAULT NULL::uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

  if not ((p_token is not null and p_token = v_public_token) or v_is_vendor or v_is_admin) then
    raise exception 'not_authorized';
  end if;

  if v_status in ('Delivered','Cancelled') then raise exception 'order_closed'; end if;

  if not v_is_admin and not v_is_vendor then
    if not is_customer_cancellable_status(v_status) then raise exception 'too_late_to_cancel'; end if;
    if coalesce(v_kitchen, 'new') <> 'new' then raise exception 'too_late_to_cancel'; end if;
  elsif v_is_vendor and not v_is_admin then
    if v_status not in ('pending','awaiting_payment','awaiting_quote','Scheduled','Driver_Searching','No_Driver_Found') then
      raise exception 'too_late_to_cancel';
    end if;
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if not v_is_admin and not v_is_vendor
     and v_reason not in ('customer_waiting_too_long','customer_price_too_high','customer_payment_problem',
                          'customer_ordered_by_mistake','customer_changed_mind','customer_other') then
    v_reason := 'customer_other';
  end if;

  update orders set status = 'Cancelled', cancel_reason = v_reason, cancelled_at = now(),
    refund_status = case
      when v_payment_method in ('instapay','online') and (v_instapay_claimed or v_online_status = 'paid') and v_total > 0 then 'pending'
      when v_payment_method = 'cod' and v_cod_deposit is not null and (v_instapay_claimed or v_online_status = 'paid') then 'pending'
      else refund_status end
  where id = p_order_id;

  -- Give the promo redemption back. A cancelled order used to hold it forever.
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
    where order_id = p_order_id and status in ('Offered','Accepted','Picked_Up','Out_for_Delivery') limit 1;

  update delivery_assignments set status = 'Cancelled', rejection_reason = coalesce(v_reason, 'order_cancelled')
  where order_id = p_order_id and status in ('Offered','Accepted','Picked_Up','Out_for_Delivery');

  if v_driver_id is not null then
    select count(*) into v_active_count from delivery_assignments
      where driver_id = v_driver_id and status in ('Accepted','Picked_Up','Out_for_Delivery');
    update drivers set available = (v_active_count < 4),
      status = case when v_active_count = 0 then 'Available' else status end
    where id = v_driver_id;
  end if;
end $function$;
