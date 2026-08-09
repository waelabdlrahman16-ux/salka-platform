-- Security hardening batch 3.
--
-- These SECURITY DEFINER routines are implementation details invoked by
-- triggers, cron, trusted Edge Functions, or other guarded database functions.
-- None is a browser-facing RPC. Removing direct client execution narrows the
-- exposed API without changing the order, staff, customer, or notification
-- workflows that call them through their intended entry points.

revoke execute on function public.check_and_award_shift_bonus(integer) from public, anon, authenticated;
revoke execute on function public.check_late_unclaimed_orders() from public, anon, authenticated;
revoke execute on function public.check_rate_limit(text, integer, interval) from public, anon, authenticated;
revoke execute on function public.current_actor_label() from public, anon, authenticated;
revoke execute on function public.driver_can_take_order(integer, integer) from public, anon, authenticated;
revoke execute on function public.log_order_status_change() from public, anon, authenticated;
revoke execute on function public.notify_admin_new_complaint() from public, anon, authenticated;
revoke execute on function public.notify_admin_new_order() from public, anon, authenticated;
revoke execute on function public.notify_admin_order_trouble() from public, anon, authenticated;
revoke execute on function public.notify_admin(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.notify_customer_driver_arrived() from public, anon, authenticated;
revoke execute on function public.notify_driver_assignment_change() from public, anon, authenticated;
revoke execute on function public.notify_driver_order_ready() from public, anon, authenticated;
revoke execute on function public.notify_new_order_for(integer) from public, anon, authenticated;
revoke execute on function public.notify_new_order() from public, anon, authenticated;
revoke execute on function public.notify_order_delivered_receipt() from public, anon, authenticated;
revoke execute on function public.notify_order_status_change() from public, anon, authenticated;
revoke execute on function public.notify_vendor_order_now_due() from public, anon, authenticated;
revoke execute on function public.order_is_dispatchable(integer) from public, anon, authenticated;
revoke execute on function public.record_push_result(text, boolean, integer, text, text) from public, anon, authenticated;
revoke execute on function public.set_order_is_test() from public, anon, authenticated;
revoke execute on function public.supervisor_may_touch_order(integer) from public, anon, authenticated;

-- The two Edge Function helpers authenticate with the service key. Preserve
-- that explicit route after removing PostgreSQL's implicit PUBLIC grant.
grant execute on function public.check_rate_limit(text, integer, interval) to service_role;
grant execute on function public.record_push_result(text, boolean, integer, text, text) to service_role;

do $permissions_check$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.check_and_award_shift_bonus(integer)',
    'public.check_late_unclaimed_orders()',
    'public.check_rate_limit(text,integer,interval)',
    'public.current_actor_label()',
    'public.driver_can_take_order(integer,integer)',
    'public.log_order_status_change()',
    'public.notify_admin_new_complaint()',
    'public.notify_admin_new_order()',
    'public.notify_admin_order_trouble()',
    'public.notify_admin(text,text,jsonb)',
    'public.notify_customer_driver_arrived()',
    'public.notify_driver_assignment_change()',
    'public.notify_driver_order_ready()',
    'public.notify_new_order_for(integer)',
    'public.notify_new_order()',
    'public.notify_order_delivered_receipt()',
    'public.notify_order_status_change()',
    'public.notify_vendor_order_now_due()',
    'public.order_is_dispatchable(integer)',
    'public.record_push_result(text,boolean,integer,text,text)',
    'public.set_order_is_test()',
    'public.supervisor_may_touch_order(integer)'
  ] loop
    if has_function_privilege('anon', v_signature, 'execute')
       or has_function_privilege('authenticated', v_signature, 'execute') then
      raise exception 'client role still has EXECUTE on internal function %', v_signature;
    end if;
  end loop;

  foreach v_signature in array array[
    'public.check_rate_limit(text,integer,interval)',
    'public.record_push_result(text,boolean,integer,text,text)'
  ] loop
    if not has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'service_role lost EXECUTE on Edge helper %', v_signature;
    end if;
  end loop;

  -- Representative public and signed-in entry points must remain callable.
  if not has_function_privilege('anon', 'public.place_order(integer,text,text,text,text,text,numeric,json,integer,date,integer,text,boolean,uuid,text)', 'execute') then
    raise exception 'public order placement lost EXECUTE';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_daily_report(date)', 'execute') then
    raise exception 'staff reporting lost EXECUTE';
  end if;
  if not has_function_privilege('authenticated', 'public.claim_order(integer)', 'execute') then
    raise exception 'driver claiming lost EXECUTE';
  end if;
end
$permissions_check$;
