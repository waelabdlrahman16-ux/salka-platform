-- Pricing a هنجبلك order was impossible in production. Order #1000 sat
-- unpriced, and every attempt came back as a generic "في مشكلة عندنا دلوقتي".
--
-- TWO separate faults, one behind the other. The first was an edge function
-- deployed without the confirmPrice action; fixing that revealed this one:
--
--   permission denied for function confirm_custom_order_price   (SQLSTATE 42501)
--
-- public.confirm_custom_order_price(integer,numeric,uuid) had lost its EXECUTE
-- grant to service_role. Its six sibling wrappers -- created in the same
-- statement, granted in the same statement, by
-- 20260809212659_route_vendor_operations_through_edge -- all still had theirs:
--
--   vendor_accept_order          postgres=X/postgres | service_role=X/postgres
--   vendor_delay                 postgres=X/postgres | service_role=X/postgres
--   vendor_ready                 postgres=X/postgres | service_role=X/postgres
--   vendor_set_open              postgres=X/postgres | service_role=X/postgres
--   confirm_custom_order_price   postgres=X/postgres          <-- alone
--
-- No migration in this repository drops or recreates that wrapper, and the
-- migration that granted it ends with an assertion that would have raised had
-- the grant not taken. So the grant was lost OUTSIDE the migrations -- a hand
-- run drop-and-recreate in the SQL editor is the only thing that fits, and a
-- CREATE without a GRANT leaves exactly this ACL. Recorded rather than guessed
-- at: a checked query found this function is the ONLY public wrapper taking
-- p_auth_user_id that service_role cannot execute, so whatever happened
-- happened once, to one function.
--
-- Restoring the grant is therefore the whole fix. It is written as a migration
-- rather than a one-off statement so the repository and the database agree
-- about it, and so a rebuild from migrations does not silently reproduce the
-- outage.

revoke all on function public.confirm_custom_order_price(integer, numeric, uuid)
  from public, anon, authenticated;

grant execute on function public.confirm_custom_order_price(integer, numeric, uuid)
  to service_role;

-- The same assertion 20260809212659 ends with, over the same seven wrappers.
-- It is repeated deliberately: had it been re-run at any point since, this
-- outage would have been found by a migration instead of by a customer waiting
-- for a quote that could never be given.
do $v$
declare s text;
begin
  foreach s in array array[
    'public.confirm_custom_order_price(integer,numeric,uuid)',
    'public.vendor_accept_order(integer,integer,uuid)',
    'public.vendor_delay(integer,integer,uuid)',
    'public.vendor_delivery_overview(integer[],uuid)',
    'public.vendor_ready(integer,uuid)',
    'public.vendor_set_item_availability(integer,boolean,uuid)',
    'public.vendor_set_open(boolean,uuid)'
  ] loop
    if has_function_privilege('authenticated', s, 'execute')
       or not has_function_privilege('service_role', s, 'execute') then
      raise exception 'invalid vendor wrapper %', s;
    end if;
  end loop;
end $v$;
