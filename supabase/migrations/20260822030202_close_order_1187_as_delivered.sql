-- Order #1187 was delivered by hand: the courier dropped it off, but the order
-- never had a delivery_assignments row and its quote was never accepted (it was
-- priced through the retired confirmPrice path), so no in-app button could close
-- it. This mirrors exactly what private.admin_force_delivered would have done
-- for a custom_request with no assignment and an unaccepted quote:
-- supersede the quote, mark Delivered, record why. No cash is recorded (there is
-- no assignment and no driver to hold it) and online_payment_status stays
-- 'pending' -- the 2392 EGP InstaPay transfer has not been received yet.
do $$
declare
  v_quote_state text;
  v_quote_id bigint;
begin
  select quote_state, current_quote_id into v_quote_state, v_quote_id
    from orders
   where id = 1187 and order_type = 'custom_request' and status = 'awaiting_payment'
   for update;

  if v_quote_state is null then
    raise notice 'order 1187 not in the expected state; nothing done';
    return;
  end if;

  update order_quotes set state = 'superseded'
   where order_id = 1187 and state = 'offered';
  update orders set quote_state = 'superseded' where id = 1187;

  insert into order_status_events (order_id, from_status, to_status, actor)
  values (1187, 'quote:' || v_quote_state, 'quote:superseded', 'admin');

  perform private.record_order_event(
    1187, 'quote.superseded', 'quote',
    jsonb_build_object('state', v_quote_state, 'quote_id', v_quote_id),
    jsonb_build_object('state', 'superseded', 'quote_id', v_quote_id,
                       'closed_outside_the_app', true,
                       'reason', 'اتسلّم بالفعل للعميلة والدفع إنستاباي لسه متحوّلش'),
    'admin', null, null);

  update orders
     set status = 'Delivered',
         cancel_reason = coalesce(nullif(trim(cancel_reason), ''),
           'أُغلق بواسطة الإدارة: اتسلّم بالفعل للعميلة، الدفع إنستاباي لسه متحوّلش')
   where id = 1187;
end $$;
