-- Restrict the emergency delivery completion override to administrators.
-- The Supervisor portal has no matching control after this migration.
create or replace function private.admin_force_delivered(
  p_order_id integer,
  p_reason text,
  p_cash_collected boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment_id int; v_driver int; v_status text;
  v_total numeric; v_fee numeric; v_payment_method text; v_cod_deposit numeric;
  v_cash_due numeric; v_driver_earning numeric; v_is_test boolean;
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;

  select status into v_status from orders where id = p_order_id for update;
  if v_status is null then raise exception 'order_not_found'; end if;
  if v_status = 'Delivered' then return; end if;
  if v_status = 'Cancelled' then raise exception 'order_closed'; end if;

  select id, driver_id into v_assignment_id, v_driver
    from delivery_assignments
   where order_id = p_order_id and status in ('Accepted','Picked_Up','Out_for_Delivery')
   order by attempt_number desc limit 1;
  if v_assignment_id is null then raise exception 'no_active_assignment'; end if;

  select total, delivery_fee, payment_method, cod_deposit_amount, is_test
    into v_total, v_fee, v_payment_method, v_cod_deposit, v_is_test
    from orders where id = p_order_id;

  v_cash_due := case
    when v_payment_method = 'instapay' then 0
    when v_cod_deposit is not null then v_total - v_cod_deposit
    else v_total
  end;
  if not p_cash_collected then v_cash_due := 0; end if;

  update delivery_assignments
     set status = 'Delivered', delivered_at = now(),
         cash_confirmed_at = case when v_cash_due > 0 then coalesce(cash_confirmed_at, now()) else cash_confirmed_at end
   where id = v_assignment_id;

  update orders
     set status = 'Delivered',
         cancel_reason = coalesce(nullif(trim(cancel_reason), ''), 'أُغلق بواسطة الإدارة: ' || trim(p_reason))
   where id = p_order_id;

  if v_is_test then
    update drivers set status = 'Available', available = true where id = v_driver;
    return;
  end if;

  v_fee := coalesce(v_fee, 65);
  select coalesce((select value::numeric from settings where key = 'driver_flat_earning_egp'), 10)
    into v_driver_earning;
  v_driver_earning := least(greatest(v_driver_earning, 0), v_fee);

  insert into driver_earnings (driver_id, order_id, assignment_id, delivery_fee, driver_earning, admin_amount)
  values (v_driver, p_order_id, v_assignment_id, v_fee, v_driver_earning, v_fee - v_driver_earning)
  on conflict (assignment_id) do nothing;

  update drivers set
    status = 'Available',
    available = true,
    total_deliveries = coalesce(total_deliveries, 0) + 1,
    cash_held = coalesce(cash_held, 0) + greatest(coalesce(v_cash_due, 0), 0)
  where id = v_driver;
end;
$$;

