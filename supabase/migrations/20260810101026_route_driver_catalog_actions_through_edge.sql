-- Batch 9 (final batch): the remaining 23 functions flagged by the advisor --
-- SECURITY DEFINER, 0 RLS policies, 0 internal callers -- meaning any signed-in
-- client could call them directly via PostgREST. Same pattern as the previous
-- two batches: move each body into `private`, revoke it there, then re-create a
-- thin service-role-only wrapper in `public` that forwards the caller's
-- auth.uid() via set_config('request.jwt.claim.sub', ...) so my_driver_id(),
-- is_admin(), my_restaurant_id() etc keep resolving exactly as before, just now
-- evaluated inside the SECURITY DEFINER wrapper instead of for an arbitrary
-- signed-in client calling the RPC directly.
--
-- None of these 23 call each other by unqualified name, and none call any other
-- function that is moving to `private` in this migration. They call public
-- helper predicates (my_driver_id, is_admin, is_catalog_manager,
-- my_restaurant_id, driver_can_take_order, order_is_dispatchable,
-- is_predispatch_status, notify_admin) which all stay in `public` and
-- unchanged -- so, like the admin-panel batch and unlike the account/driver
-- batch, no search_path fixups are needed here.

alter function public.apply_library_addon(integer,integer[],text) set schema private;
alter function public.available_orders() set schema private;
alter function public.check_discount_conflict(integer,text,integer,text,integer) set schema private;
alter function public.claim_order(integer) set schema private;
alter function public.clear_my_location() set schema private;
alter function public.driver_accept_assignment(integer,integer) set schema private;
alter function public.driver_arrived_at_customer(integer) set schema private;
alter function public.driver_arrived_at_restaurant(integer) set schema private;
alter function public.driver_called_customer(integer) set schema private;
alter function public.driver_claim_device(text,text) set schema private;
alter function public.driver_confirm_cash_received(integer) set schema private;
alter function public.driver_mark_out_for_delivery(integer) set schema private;
alter function public.driver_mark_picked_up(integer) set schema private;
alter function public.driver_reject_assignment(integer,text) set schema private;
alter function public.driver_report_no_answer(integer) set schema private;
alter function public.driver_report_problem(integer,text) set schema private;
alter function public.driver_set_available(boolean) set schema private;
alter function public.mark_delivered(integer,integer) set schema private;
alter function public.my_driver_stats() set schema private;
alter function public.restaurant_reliability(integer) set schema private;
alter function public.restaurants_reliability_all() set schema private;
alter function public.save_my_push_token(text,text) set schema private;
alter function public.update_my_location(numeric,numeric) set schema private;

revoke all on function private.apply_library_addon(integer,integer[],text) from public,anon,authenticated;
revoke all on function private.available_orders() from public,anon,authenticated;
revoke all on function private.check_discount_conflict(integer,text,integer,text,integer) from public,anon,authenticated;
revoke all on function private.claim_order(integer) from public,anon,authenticated;
revoke all on function private.clear_my_location() from public,anon,authenticated;
revoke all on function private.driver_accept_assignment(integer,integer) from public,anon,authenticated;
revoke all on function private.driver_arrived_at_customer(integer) from public,anon,authenticated;
revoke all on function private.driver_arrived_at_restaurant(integer) from public,anon,authenticated;
revoke all on function private.driver_called_customer(integer) from public,anon,authenticated;
revoke all on function private.driver_claim_device(text,text) from public,anon,authenticated;
revoke all on function private.driver_confirm_cash_received(integer) from public,anon,authenticated;
revoke all on function private.driver_mark_out_for_delivery(integer) from public,anon,authenticated;
revoke all on function private.driver_mark_picked_up(integer) from public,anon,authenticated;
revoke all on function private.driver_reject_assignment(integer,text) from public,anon,authenticated;
revoke all on function private.driver_report_no_answer(integer) from public,anon,authenticated;
revoke all on function private.driver_report_problem(integer,text) from public,anon,authenticated;
revoke all on function private.driver_set_available(boolean) from public,anon,authenticated;
revoke all on function private.mark_delivered(integer,integer) from public,anon,authenticated;
revoke all on function private.my_driver_stats() from public,anon,authenticated;
revoke all on function private.restaurant_reliability(integer) from public,anon,authenticated;
revoke all on function private.restaurants_reliability_all() from public,anon,authenticated;
revoke all on function private.save_my_push_token(text,text) from public,anon,authenticated;
revoke all on function private.update_my_location(numeric,numeric) from public,anon,authenticated;

create function public.apply_library_addon(p_library_id integer,p_item_ids integer[],p_group_name text default 'إضافات'::text,p_auth_user_id uuid default null)
returns integer language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.apply_library_addon(p_library_id,p_item_ids,p_group_name); end $f$;
create function public.available_orders(p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.available_orders(); end $f$;
create function public.check_discount_conflict(p_restaurant_id integer,p_scope text,p_menu_item_id integer default null,p_category text default null,p_exclude_id integer default null,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.check_discount_conflict(p_restaurant_id,p_scope,p_menu_item_id,p_category,p_exclude_id); end $f$;
create function public.claim_order(p_order_id integer,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.claim_order(p_order_id); end $f$;
create function public.clear_my_location(p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.clear_my_location(); end $f$;
create function public.driver_accept_assignment(p_assignment_id integer,p_order_id integer,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.driver_accept_assignment(p_assignment_id,p_order_id); end $f$;
create function public.driver_arrived_at_customer(p_assignment_id integer,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.driver_arrived_at_customer(p_assignment_id); end $f$;
create function public.driver_arrived_at_restaurant(p_assignment_id integer,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.driver_arrived_at_restaurant(p_assignment_id); end $f$;
create function public.driver_called_customer(p_assignment_id integer,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.driver_called_customer(p_assignment_id); end $f$;
create function public.driver_claim_device(p_device_id text,p_label text default null,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.driver_claim_device(p_device_id,p_label); end $f$;
create function public.driver_confirm_cash_received(p_assignment_id integer,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.driver_confirm_cash_received(p_assignment_id); end $f$;
create function public.driver_mark_out_for_delivery(p_assignment_id integer,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.driver_mark_out_for_delivery(p_assignment_id); end $f$;
create function public.driver_mark_picked_up(p_assignment_id integer,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.driver_mark_picked_up(p_assignment_id); end $f$;
create function public.driver_reject_assignment(p_assignment_id integer,p_reason text default ''::text,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.driver_reject_assignment(p_assignment_id,p_reason); end $f$;
create function public.driver_report_no_answer(p_assignment_id integer,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.driver_report_no_answer(p_assignment_id); end $f$;
create function public.driver_report_problem(p_assignment_id integer,p_reason text,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.driver_report_problem(p_assignment_id,p_reason); end $f$;
create function public.driver_set_available(p_available boolean,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.driver_set_available(p_available); end $f$;
create function public.mark_delivered(p_assignment_id integer,p_order_id integer,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.mark_delivered(p_assignment_id,p_order_id); end $f$;
create function public.my_driver_stats(p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.my_driver_stats(); end $f$;
create function public.restaurant_reliability(p_restaurant_id integer,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.restaurant_reliability(p_restaurant_id); end $f$;
create function public.restaurants_reliability_all(p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.restaurants_reliability_all(); end $f$;
create function public.save_my_push_token(p_push_token text,p_platform text default 'web'::text,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.save_my_push_token(p_push_token,p_platform); end $f$;
create function public.update_my_location(p_lat numeric,p_lng numeric,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.update_my_location(p_lat,p_lng); end $f$;

revoke all on function public.apply_library_addon(integer,integer[],text,uuid) from public,anon,authenticated;
revoke all on function public.available_orders(uuid) from public,anon,authenticated;
revoke all on function public.check_discount_conflict(integer,text,integer,text,integer,uuid) from public,anon,authenticated;
revoke all on function public.claim_order(integer,uuid) from public,anon,authenticated;
revoke all on function public.clear_my_location(uuid) from public,anon,authenticated;
revoke all on function public.driver_accept_assignment(integer,integer,uuid) from public,anon,authenticated;
revoke all on function public.driver_arrived_at_customer(integer,uuid) from public,anon,authenticated;
revoke all on function public.driver_arrived_at_restaurant(integer,uuid) from public,anon,authenticated;
revoke all on function public.driver_called_customer(integer,uuid) from public,anon,authenticated;
revoke all on function public.driver_claim_device(text,text,uuid) from public,anon,authenticated;
revoke all on function public.driver_confirm_cash_received(integer,uuid) from public,anon,authenticated;
revoke all on function public.driver_mark_out_for_delivery(integer,uuid) from public,anon,authenticated;
revoke all on function public.driver_mark_picked_up(integer,uuid) from public,anon,authenticated;
revoke all on function public.driver_reject_assignment(integer,text,uuid) from public,anon,authenticated;
revoke all on function public.driver_report_no_answer(integer,uuid) from public,anon,authenticated;
revoke all on function public.driver_report_problem(integer,text,uuid) from public,anon,authenticated;
revoke all on function public.driver_set_available(boolean,uuid) from public,anon,authenticated;
revoke all on function public.mark_delivered(integer,integer,uuid) from public,anon,authenticated;
revoke all on function public.my_driver_stats(uuid) from public,anon,authenticated;
revoke all on function public.restaurant_reliability(integer,uuid) from public,anon,authenticated;
revoke all on function public.restaurants_reliability_all(uuid) from public,anon,authenticated;
revoke all on function public.save_my_push_token(text,text,uuid) from public,anon,authenticated;
revoke all on function public.update_my_location(numeric,numeric,uuid) from public,anon,authenticated;

grant execute on function public.apply_library_addon(integer,integer[],text,uuid) to service_role;
grant execute on function public.available_orders(uuid) to service_role;
grant execute on function public.check_discount_conflict(integer,text,integer,text,integer,uuid) to service_role;
grant execute on function public.claim_order(integer,uuid) to service_role;
grant execute on function public.clear_my_location(uuid) to service_role;
grant execute on function public.driver_accept_assignment(integer,integer,uuid) to service_role;
grant execute on function public.driver_arrived_at_customer(integer,uuid) to service_role;
grant execute on function public.driver_arrived_at_restaurant(integer,uuid) to service_role;
grant execute on function public.driver_called_customer(integer,uuid) to service_role;
grant execute on function public.driver_claim_device(text,text,uuid) to service_role;
grant execute on function public.driver_confirm_cash_received(integer,uuid) to service_role;
grant execute on function public.driver_mark_out_for_delivery(integer,uuid) to service_role;
grant execute on function public.driver_mark_picked_up(integer,uuid) to service_role;
grant execute on function public.driver_reject_assignment(integer,text,uuid) to service_role;
grant execute on function public.driver_report_no_answer(integer,uuid) to service_role;
grant execute on function public.driver_report_problem(integer,text,uuid) to service_role;
grant execute on function public.driver_set_available(boolean,uuid) to service_role;
grant execute on function public.mark_delivered(integer,integer,uuid) to service_role;
grant execute on function public.my_driver_stats(uuid) to service_role;
grant execute on function public.restaurant_reliability(integer,uuid) to service_role;
grant execute on function public.restaurants_reliability_all(uuid) to service_role;
grant execute on function public.save_my_push_token(text,text,uuid) to service_role;
grant execute on function public.update_my_location(numeric,numeric,uuid) to service_role;

do $verification$
declare s text;
begin
 foreach s in array array[
  'public.apply_library_addon(integer,integer[],text,uuid)',
  'public.available_orders(uuid)',
  'public.check_discount_conflict(integer,text,integer,text,integer,uuid)',
  'public.claim_order(integer,uuid)',
  'public.clear_my_location(uuid)',
  'public.driver_accept_assignment(integer,integer,uuid)',
  'public.driver_arrived_at_customer(integer,uuid)',
  'public.driver_arrived_at_restaurant(integer,uuid)',
  'public.driver_called_customer(integer,uuid)',
  'public.driver_claim_device(text,text,uuid)',
  'public.driver_confirm_cash_received(integer,uuid)',
  'public.driver_mark_out_for_delivery(integer,uuid)',
  'public.driver_mark_picked_up(integer,uuid)',
  'public.driver_reject_assignment(integer,text,uuid)',
  'public.driver_report_no_answer(integer,uuid)',
  'public.driver_report_problem(integer,text,uuid)',
  'public.driver_set_available(boolean,uuid)',
  'public.mark_delivered(integer,integer,uuid)',
  'public.my_driver_stats(uuid)',
  'public.restaurant_reliability(integer,uuid)',
  'public.restaurants_reliability_all(uuid)',
  'public.save_my_push_token(text,text,uuid)',
  'public.update_my_location(numeric,numeric,uuid)'
 ] loop
  if has_function_privilege('authenticated',s,'execute') or not has_function_privilege('service_role',s,'execute') then raise exception 'invalid driver/catalog wrapper privilege for %',s; end if;
 end loop;
end $verification$;
