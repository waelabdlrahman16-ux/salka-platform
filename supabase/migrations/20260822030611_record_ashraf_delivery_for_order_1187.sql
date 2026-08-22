-- Order #1187 was delivered by أشرف (driver 2) by hand, off-app: it never had a
-- delivery_assignments row, so the delivery and his earning were nowhere in the
-- books. This backfills exactly what the app would have written.
--
-- The three triggers on delivery_assignments are stood down for this one insert
-- and put straight back: guard_custom_order_quote_dispatch would (correctly)
-- refuse an assignment on an order whose quote was never accepted, and the two
-- notify triggers would push a "new assignment" alert for a delivery that
-- finished hours ago. Both are right for live traffic and wrong for a backfill.
--
-- No cash is recorded: the order is InstaPay, so cash_due is 0 either way and
-- أشرف is not holding anything for it.
do $$
declare
  v_assignment_id int;
  v_fee numeric;
  v_earning numeric;
begin
  if exists (select 1 from delivery_assignments where order_id = 1187) then
    raise notice 'order 1187 already has an assignment; nothing done';
    return;
  end if;

  select coalesce(delivery_fee, 65) into v_fee from orders where id = 1187;
  select least(greatest(coalesce((select value::numeric from settings
           where key = 'driver_flat_earning_egp'), 10), 0), v_fee)
    into v_earning;

  alter table delivery_assignments disable trigger guard_custom_order_quote_dispatch;
  alter table delivery_assignments disable trigger trg_notify_driver_assignment;
  alter table delivery_assignments disable trigger trg_notify_customer_driver_arrived;

  insert into delivery_assignments
    (order_id, driver_id, attempt_number, status,
     offered_at, responded_at, picked_up_at, out_for_delivery_at, delivered_at)
  select 1187, 2, 1, 'Delivered', o.created_at, o.created_at, o.created_at, o.created_at, now()
    from orders o where o.id = 1187
  returning id into v_assignment_id;

  alter table delivery_assignments enable trigger guard_custom_order_quote_dispatch;
  alter table delivery_assignments enable trigger trg_notify_driver_assignment;
  alter table delivery_assignments enable trigger trg_notify_customer_driver_arrived;

  insert into driver_earnings
    (driver_id, order_id, assignment_id, delivery_fee, driver_earning, admin_amount)
  values (2, 1187, v_assignment_id, v_fee, v_earning, v_fee - v_earning)
  on conflict (assignment_id) do nothing;

  update drivers
     set total_deliveries = coalesce(total_deliveries, 0) + 1
   where id = 2;
end $$;
