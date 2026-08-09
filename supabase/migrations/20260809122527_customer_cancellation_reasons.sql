-- Record consistent customer cancellation reasons without restricting the
-- existing free-text reasons used by vendors, supervisors, and admins.
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id integer, p_reason text DEFAULT ''::text, p_token uuid DEFAULT NULL::uuid)
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
    update drivers set available = (v_active_count < 3),
      status = case when v_active_count = 0 then 'Available' else status end
    where id = v_driver_id;
  end if;
end $function$;
