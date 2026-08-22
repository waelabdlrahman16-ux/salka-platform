
-- Order 149: driver 1 (كريم) actually delivered it off-app (phone call,
-- walk-up) after rejecting the in-app offer. Assignment 205 (his) sat as
-- Rejected, assignment 207 (driver 3, Offered) never got a response and is
-- now moot. Replaying mark_delivered()'s exact bookkeeping by hand since
-- that function requires the driver's own authenticated session and an
-- Out_for_Delivery assignment, neither of which exists here.

UPDATE delivery_assignments SET status = 'Delivered', delivered_at = now() WHERE id = 205;
UPDATE delivery_assignments SET status = 'Cancelled' WHERE id = 207;
UPDATE orders SET status = 'Delivered' WHERE id = 149;

-- cash_due: payment_method='cod', no deposit -> full total (400) is owed back
-- from the driver. driver_flat_earning_egp is currently 0, so admin_amount
-- takes the whole 65 EGP delivery fee -- same split mark_delivered() would apply.
INSERT INTO driver_earnings (driver_id, order_id, assignment_id, delivery_fee, driver_earning, admin_amount)
VALUES (1, 149, 205, 65, 0, 65)
ON CONFLICT (assignment_id) DO NOTHING;

UPDATE drivers SET
  total_deliveries = coalesce(total_deliveries, 0) + 1,
  cash_held = coalesce(cash_held, 0) + 400
WHERE id = 1;
