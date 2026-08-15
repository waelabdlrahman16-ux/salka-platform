-- Raise the driver concurrent-hold limit from 3 to 4. The threshold was
-- hardcoded in eight places: the one real enforcement gate
-- (driver_can_take_order), the offer-filtering query (available_orders),
-- and six places that recompute a driver's `available` flag after their
-- active-order count changes. Every one of those flag-recompute call sites
-- must match the gate or a driver could sit "unavailable" one order early,
-- or "available" one order late.

create or replace function public.driver_can_take_order(p_driver_id integer, p_order_id integer)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
    select coalesce((select value::numeric from settings where key = 'van_required_subtotal_egp'), 800)
      into v_threshold;
    if v_pricing = 'pending_quote' or coalesce(v_subtotal, 0) >= v_threshold then
      select vehicle_type into v_vehicle from drivers where id = p_driver_id;
      if coalesce(v_vehicle, '') <> 'van' then return false; end if;
    end if;
  end if;

  return true;
end $function$;

create or replace function private.available_orders()
 returns json
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
               and da2.status in ('Accepted','Picked_Up','Out_for_Delivery')) < 4
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
$function$;

create or replace function private.claim_order(p_order_id integer)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  update drivers set status = 'On_Delivery', available = (v_active_count < 4) where id = v_driver;

  return json_build_object('assignment_id', v_id);
end; $function$;

create or replace function private.driver_accept_assignment(p_assignment_id integer, p_order_id integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  update drivers set status = 'On_Delivery', available = (v_active_count < 4) where id = v_driver;
end $function$;

create or replace function private.cancel_order(p_order_id integer, p_reason text DEFAULT ''::text, p_token uuid DEFAULT NULL::uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    update drivers set available = (v_active_count < 4),
      status = case when v_active_count = 0 then 'Available' else status end
    where id = v_driver_id;
  end if;
end $function$;

create or replace function private.mark_delivery_failed(p_assignment_id integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    available = (v_active_count < 4)
  where id = v_driver;
end; $function$;

create or replace function private.admin_unassign_order(p_order_id integer, p_reason text DEFAULT 'admin_unassigned'::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
     set available = (v_active < 4),
         status = case when v_active = 0 then 'Available' else status end
   where id = v_driver;
end $function$;

create or replace function private.mark_delivered(p_assignment_id integer, p_order_id integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      available = (v_remaining < 4)
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
    available        = (v_remaining < 4),
    total_deliveries = coalesce(total_deliveries, 0) + 1,
    cash_held        = coalesce(cash_held, 0) + greatest(coalesce(v_cash_due, 0), 0)
  where id = v_driver;
end; $function$;
