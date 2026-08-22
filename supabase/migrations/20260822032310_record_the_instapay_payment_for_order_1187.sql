-- The customer sent the 2392 EGP InstaPay transfer for #1187 and it was
-- received. admin_confirm_instapay_payment cannot record it: that function
-- requires status = 'awaiting_payment', and the order was closed as Delivered
-- once أشرف's hand delivery was recorded. This writes the same two fields it
-- would have written, and nothing else.
--
-- No cash and no driver float change: the money came by transfer, not through
-- the courier.
do $$
declare v_paid text;
begin
  select online_payment_status into v_paid
    from orders
   where id = 1187 and payment_method = 'instapay' and status = 'Delivered'
   for update;

  if v_paid is null then
    raise notice 'order 1187 not in the expected state; nothing done';
    return;
  end if;
  if v_paid = 'paid' then
    raise notice 'order 1187 already marked paid; nothing done';
    return;
  end if;

  update orders
     set online_payment_status = 'paid',
         instapay_claimed_at = coalesce(instapay_claimed_at, now())
   where id = 1187;

  insert into order_status_events (order_id, from_status, to_status, actor)
  values (1187, 'payment:' || v_paid, 'payment:paid', 'admin');
end $$;
