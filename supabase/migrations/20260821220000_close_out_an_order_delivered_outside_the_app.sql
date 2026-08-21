-- An order fulfilled outside the app had no way to be closed.
--
-- Order #1000 was delivered by hand: the customer approved the price on the
-- phone to CS instead of in the app, and أشرف delivered it and took the cash.
-- Every exit from the portal was locked:
--
--   assign a driver     guard_custom_order_quote_dispatch -- quote not accepted
--   force delivered     no_active_assignment -- there was no assignment to find
--   mark delivered      guard_custom_order_quote_fulfilment -- same quote rule
--   archive             order_not_closed -- needs Delivered or Cancelled first
--   cancel              the ONLY thing that worked, and it is a lie about an
--                       order that really was delivered and really did take cash
--
-- Closing #1000 took five statements by hand, one of which wrote directly to
-- delivery_assignments because admin_force_delivered only recognises an
-- Accepted/Picked_Up/Out_for_Delivery row and the offer had never been tapped
-- through on the driver's phone. Nobody should have to do that again, and the
-- alternative -- cancelling a delivered order -- silently loses the revenue and
-- leaves the driver's cash unaccounted for.
--
-- THREE CHANGES, all inside admin_force_delivered, all still admin-only with a
-- mandatory reason:
--
--   1. An 'Offered' assignment counts. A driver who took the job without
--      tapping accept is the normal shape of an offline delivery.
--   2. No assignment at all is allowed. The order closes with no driver, no
--      earning and no cash movement -- the honest record when the vendor
--      delivered it themselves. Previously this raised.
--   3. A custom order whose quote was never accepted can be closed. The current
--      quote is marked 'superseded' and quote_state becomes 'superseded' too --
--      already permitted by orders_quote_state_check. It is NOT marked
--      'accepted': the customer never accepted it in the app, and recording
--      consent they did not give in the place the app looks for consent would
--      be a worse bug than the one this fixes. 'superseded' says what is true --
--      this quote no longer governs the order -- and record_order_event carries
--      the admin and the reason.
--
-- What is deliberately NOT changed: the money. Cash and earnings are recorded
-- exactly as before when there is a driver, and not at all when there is none.

do $guard$
begin
  -- Refuse to overwrite a body that is not the one this migration was written
  -- against. The quote system reached production without passing through this
  -- repository at all (see DRIFT-SWEEP-2026-08-21.md), so "the function here is
  -- the function there" is an assumption that has already been wrong once.
  if (select md5(prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname = 'admin_force_delivered')
     is distinct from '43baf1110794995a2abde8371751ad5f' then
    raise exception
      'private.admin_force_delivered is not the body this migration expects -- re-read it before replacing';
  end if;
end $guard$;

create or replace function private.admin_force_delivered(
  p_order_id integer,
  p_reason text,
  p_cash_collected boolean default true
) returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_assignment_id int; v_driver int; v_status text; v_total numeric; v_fee numeric;
  v_payment_method text; v_cod_deposit numeric; v_cash_due numeric;
  v_driver_earning numeric; v_is_test boolean;
  v_order_type text; v_quote_state text; v_quote_id bigint;
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;

  select status, order_type, quote_state, current_quote_id
    into v_status, v_order_type, v_quote_state, v_quote_id
    from orders where id = p_order_id for update;
  if v_status is null then raise exception 'order_not_found'; end if;
  if v_status = 'Delivered' then return; end if;
  if v_status = 'Cancelled' then raise exception 'order_closed'; end if;

  -- 'Offered' now counts: see note 1 above.
  select id, driver_id into v_assignment_id, v_driver
    from delivery_assignments
   where order_id = p_order_id
     and status in ('Offered','Accepted','Picked_Up','Out_for_Delivery')
   order by attempt_number desc limit 1;
  -- no_active_assignment is no longer raised: see note 2 above.

  -- See note 3. Done BEFORE the status update, because
  -- guard_custom_order_quote_fulfilment fires on that update and would refuse.
  if v_order_type = 'custom_request'
     and v_quote_state is not null and v_quote_state <> 'accepted' then
    update order_quotes set state = 'superseded'
     where order_id = p_order_id and state = 'offered';
    update orders set quote_state = 'superseded' where id = p_order_id;
    insert into order_status_events (order_id, from_status, to_status, actor, actor_uid)
    values (p_order_id, 'quote:' || v_quote_state, 'quote:superseded', 'admin', auth.uid());
    perform private.record_order_event(
      p_order_id, 'quote.superseded', 'quote',
      jsonb_build_object('state', v_quote_state, 'quote_id', v_quote_id),
      jsonb_build_object('state', 'superseded', 'quote_id', v_quote_id,
                         'closed_outside_the_app', true, 'reason', trim(p_reason)),
      'admin', null, null);
  end if;

  select total, delivery_fee, payment_method, cod_deposit_amount, is_test
    into v_total, v_fee, v_payment_method, v_cod_deposit, v_is_test
    from orders where id = p_order_id;

  v_cash_due := case
    when v_payment_method = 'instapay' then 0
    when v_cod_deposit is not null then v_total - v_cod_deposit
    else v_total end;
  if not p_cash_collected then v_cash_due := 0; end if;
  -- Nobody carried cash for a delivery no driver made.
  if v_assignment_id is null then v_cash_due := 0; end if;

  if v_assignment_id is not null then
    update delivery_assignments
       set status = 'Delivered', delivered_at = now(),
           cash_confirmed_at = case when v_cash_due > 0 then coalesce(cash_confirmed_at, now())
                                    else cash_confirmed_at end
     where id = v_assignment_id;
  end if;

  update orders
     set status = 'Delivered',
         cancel_reason = coalesce(nullif(trim(cancel_reason), ''),
                                  'أُغلق بواسطة الإدارة: ' || trim(p_reason))
   where id = p_order_id;

  if v_assignment_id is null then return; end if;
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
  update drivers
     set status = 'Available', available = true,
         total_deliveries = coalesce(total_deliveries, 0) + 1,
         cash_held = coalesce(cash_held, 0) + greatest(coalesce(v_cash_due, 0), 0)
   where id = v_driver;
end $function$;

-- The public wrapper and its grant are unchanged, but assert them rather than
-- assume: confirm_custom_order_price lost exactly this grant and nobody noticed
-- until pricing broke (see 20260821213000).
do $v$
begin
  if not has_function_privilege('service_role', 'public.admin_force_delivered(integer,text,boolean,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.admin_force_delivered(integer,text,boolean,uuid)', 'execute') then
    raise exception 'admin_force_delivered wrapper grants are wrong';
  end if;
end $v$;
