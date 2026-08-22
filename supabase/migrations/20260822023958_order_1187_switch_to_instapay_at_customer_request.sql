-- Order #1187 moved to InstaPay because the customer asked, by phone.
--
-- habiba ibrahim, 2,392 EGP, two 18L water bottles. The courier delivered it
-- around 02:50 UTC; she then called and asked to pay by InstaPay rather than
-- cash at the door, and no cash was collected.
--
-- WHY THIS NEEDED A MIGRATION RATHER THAN A BUTTON. #1187 was priced through
-- confirm_custom_order_price, which sets a price but never issues a quote, so
-- quote_state stayed 'pending' with current_quote_id null and no row in
-- order_quotes. The quote guards then blocked every forward action, and the
-- portal's "سجّله كمُسلَّم" is rendered per delivery assignment -- of which this
-- order has none, because it could never be dispatched. Staff were left with
-- one button: cancel an order that had already been delivered.
--
-- The path that produced that state is fixed separately, in the migration that
-- makes confirm_custom_order_price refuse instead of bricking an order.
--
-- awaiting_payment + online_payment_status 'pending' is the state the tracking
-- page reads to show InstaPay details and the "حوّلت المبلغ ✓" button, so from
-- here the normal flow works: she taps it, admin_confirm_instapay_payment
-- verifies, and the order returns to 'pending' as paid. Closing it as Delivered
-- comes after that, deliberately -- admin_confirm_instapay_payment requires
-- status = 'awaiting_payment' and will not run on a delivered order.
--
-- Scoped to this order and to the exact state described, so if anything moved
-- in the meantime this matches nothing rather than overwriting someone's work.
update orders
   set payment_method        = 'instapay',
       status                = 'awaiting_payment',
       online_payment_status = 'pending'
 where id = 1187
   and order_type = 'custom_request'
   and payment_method = 'cod'
   and status = 'pending'
   and total = 2392.00;
