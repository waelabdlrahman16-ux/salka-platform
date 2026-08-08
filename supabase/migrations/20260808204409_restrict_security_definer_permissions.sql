-- Restrict privileged RPCs that were inheriting PostgreSQL's default EXECUTE
-- grant to PUBLIC. In Supabase, anon inherits PUBLIC, so an internal role check
-- was the only barrier between an unsigned request and each SECURITY DEFINER
-- function below.
--
-- Customer-token RPCs deliberately remain anonymous. That allowlist includes
-- place_order, submit_custom_order, track_order, cancel_order,
-- mark_instapay_claimed, switch_to_cash, append_request_items, my_orders,
-- my_last_request, session_whoami/session_logout, delivery_quote, open_slots,
-- restaurant/catalog discovery, wallet lookup, ratings, complaints and tips.

-- Staff-facing RPCs: signed-in users may reach the function, whose body then
-- enforces the exact admin/vendor role. Anonymous callers cannot reach it.
revoke execute on function public.admin_add_menu_category(integer, text) from public, anon;
revoke execute on function public.admin_daily_report(date) from public, anon;
revoke execute on function public.admin_delete_menu_category(integer, text) from public, anon;
revoke execute on function public.admin_push_health() from public, anon;
revoke execute on function public.admin_rename_menu_category(integer, text, text) from public, anon;
revoke execute on function public.admin_reorder_menu_categories(integer, text[]) from public, anon;
revoke execute on function public.admin_set_restaurant_rank(integer, integer, boolean) from public, anon;
revoke execute on function public.request_pickup(integer, text, text, text, text, text, numeric, text, numeric, text, integer, uuid) from public, anon;
revoke execute on function public.save_my_push_token(text, text) from public, anon;

grant execute on function public.admin_add_menu_category(integer, text) to authenticated;
grant execute on function public.admin_daily_report(date) to authenticated;
grant execute on function public.admin_delete_menu_category(integer, text) to authenticated;
grant execute on function public.admin_push_health() to authenticated;
grant execute on function public.admin_rename_menu_category(integer, text, text) to authenticated;
grant execute on function public.admin_reorder_menu_categories(integer, text[]) to authenticated;
grant execute on function public.admin_set_restaurant_rank(integer, integer, boolean) to authenticated;
grant execute on function public.request_pickup(integer, text, text, text, text, text, numeric, text, numeric, text, integer, uuid) to authenticated;
grant execute on function public.save_my_push_token(text, text) to authenticated;

-- Trigger and implementation helpers are not API endpoints. They run as their
-- owner from trusted functions/triggers and should be unreachable through RPC
-- for both anonymous and ordinary signed-in clients.
revoke execute on function public.delivery_fee_for_distance(numeric) from public, anon, authenticated;
revoke execute on function public.ensure_menu_category() from public, anon, authenticated;
revoke execute on function public.is_banned(text) from public, anon, authenticated;
revoke execute on function public.notify_customer_driver_arrived() from public, anon, authenticated;
revoke execute on function public.notify_vendor_order_now_due() from public, anon, authenticated;
revoke execute on function public.order_is_dispatchable(integer) from public, anon, authenticated;
revoke execute on function public.set_order_is_test() from public, anon, authenticated;
revoke execute on function public.vendor_covers_compound(integer, integer) from public, anon, authenticated;

-- Fail the migration if a later edit accidentally restores broad access or
-- removes the authenticated grant required by the application.
do $permissions_check$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.admin_add_menu_category(integer,text)',
    'public.admin_daily_report(date)',
    'public.admin_delete_menu_category(integer,text)',
    'public.admin_push_health()',
    'public.admin_rename_menu_category(integer,text,text)',
    'public.admin_reorder_menu_categories(integer,text[])',
    'public.admin_set_restaurant_rank(integer,integer,boolean)',
    'public.request_pickup(integer,text,text,text,text,text,numeric,text,numeric,text,integer,uuid)',
    'public.save_my_push_token(text,text)'
  ] loop
    if has_function_privilege('anon', v_signature, 'execute') then
      raise exception 'anon still has EXECUTE on %', v_signature;
    end if;
    if not has_function_privilege('authenticated', v_signature, 'execute') then
      raise exception 'authenticated lost EXECUTE on %', v_signature;
    end if;
  end loop;

  foreach v_signature in array array[
    'public.delivery_fee_for_distance(numeric)',
    'public.ensure_menu_category()',
    'public.is_banned(text)',
    'public.notify_customer_driver_arrived()',
    'public.notify_vendor_order_now_due()',
    'public.order_is_dispatchable(integer)',
    'public.set_order_is_test()',
    'public.vendor_covers_compound(integer,integer)'
  ] loop
    if has_function_privilege('anon', v_signature, 'execute')
       or has_function_privilege('authenticated', v_signature, 'execute') then
      raise exception 'client role still has EXECUTE on internal function %', v_signature;
    end if;
  end loop;

  -- Representative public flows must remain available without signing in.
  foreach v_signature in array array[
    'public.place_order(integer,text,text,text,text,text,numeric,json,integer,date,integer,text,boolean,uuid,text)',
    'public.delivery_quote(integer,integer)',
    'public.track_order(uuid)',
    'public.cancel_order(integer,text,uuid)',
    'public.my_last_request(integer,uuid)'
  ] loop
    if not has_function_privilege('anon', v_signature, 'execute') then
      raise exception 'public customer flow lost EXECUTE on %', v_signature;
    end if;
  end loop;
end
$permissions_check$;
