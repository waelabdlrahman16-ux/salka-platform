-- Batch 8: the 20 admin-panel functions. Same pattern as
-- route_admin_account_driver_actions_through_edge: move each function's body
-- into `private`, revoke it there, then re-create a thin service-role-only
-- wrapper in `public` that forwards the caller's auth.uid() via
-- set_config('request.jwt.claim.sub', ...) so is_admin()/is_supervisor()/
-- is_catalog_manager() keep working exactly as before, just now evaluated
-- inside the SECURITY DEFINER wrapper rather than for an arbitrary signed-in
-- client calling the RPC directly.
--
-- None of these 20 call each other or any other private function by
-- unqualified name (admin_stalled_orders calls the separate stalled_orders()
-- set-returning function, which stays public and unchanged), so no
-- search_path fixups are needed here, unlike admin_delete_customer_by_phone
-- in the earlier account/driver batch.

alter function public.admin_add_menu_category(integer,text) set schema private;
alter function public.admin_customer_detail(text) set schema private;
alter function public.admin_customers() set schema private;
alter function public.admin_daily_report(date) set schema private;
alter function public.admin_delete_menu_category(integer,text) set schema private;
alter function public.admin_delete_menu_item(integer) set schema private;
alter function public.admin_flag_driver_dispute(integer,text) set schema private;
alter function public.admin_funnel(integer) set schema private;
alter function public.admin_list_accounts() set schema private;
alter function public.admin_live_deliveries() set schema private;
alter function public.admin_pending_refunds() set schema private;
alter function public.admin_push_health() set schema private;
alter function public.admin_rename_menu_category(integer,text,text) set schema private;
alter function public.admin_reorder_menu_categories(integer,text[]) set schema private;
alter function public.admin_set_compound_fee(integer,numeric) set schema private;
alter function public.admin_set_restaurant_rank(integer,integer,boolean) set schema private;
alter function public.admin_set_vendor_hours(integer,jsonb) set schema private;
alter function public.admin_stalled_orders() set schema private;
alter function public.admin_upsert_compound(integer,text,integer,numeric,numeric,text,numeric,numeric,boolean) set schema private;
alter function public.admin_vendors_without_items() set schema private;

revoke all on function private.admin_add_menu_category(integer,text) from public,anon,authenticated;
revoke all on function private.admin_customer_detail(text) from public,anon,authenticated;
revoke all on function private.admin_customers() from public,anon,authenticated;
revoke all on function private.admin_daily_report(date) from public,anon,authenticated;
revoke all on function private.admin_delete_menu_category(integer,text) from public,anon,authenticated;
revoke all on function private.admin_delete_menu_item(integer) from public,anon,authenticated;
revoke all on function private.admin_flag_driver_dispute(integer,text) from public,anon,authenticated;
revoke all on function private.admin_funnel(integer) from public,anon,authenticated;
revoke all on function private.admin_list_accounts() from public,anon,authenticated;
revoke all on function private.admin_live_deliveries() from public,anon,authenticated;
revoke all on function private.admin_pending_refunds() from public,anon,authenticated;
revoke all on function private.admin_push_health() from public,anon,authenticated;
revoke all on function private.admin_rename_menu_category(integer,text,text) from public,anon,authenticated;
revoke all on function private.admin_reorder_menu_categories(integer,text[]) from public,anon,authenticated;
revoke all on function private.admin_set_compound_fee(integer,numeric) from public,anon,authenticated;
revoke all on function private.admin_set_restaurant_rank(integer,integer,boolean) from public,anon,authenticated;
revoke all on function private.admin_set_vendor_hours(integer,jsonb) from public,anon,authenticated;
revoke all on function private.admin_stalled_orders() from public,anon,authenticated;
revoke all on function private.admin_upsert_compound(integer,text,integer,numeric,numeric,text,numeric,numeric,boolean) from public,anon,authenticated;
revoke all on function private.admin_vendors_without_items() from public,anon,authenticated;

create function public.admin_add_menu_category(p_restaurant_id integer,p_name text,p_auth_user_id uuid default null)
returns integer language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_add_menu_category(p_restaurant_id,p_name); end $f$;
create function public.admin_customer_detail(p_phone text,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_customer_detail(p_phone); end $f$;
create function public.admin_customers(p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_customers(); end $f$;
create function public.admin_daily_report(p_date date default null,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_daily_report(p_date); end $f$;
create function public.admin_delete_menu_category(p_restaurant_id integer,p_name text,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.admin_delete_menu_category(p_restaurant_id,p_name); end $f$;
create function public.admin_delete_menu_item(p_item_id integer,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.admin_delete_menu_item(p_item_id); end $f$;
create function public.admin_flag_driver_dispute(p_complaint_id integer,p_note text default '',p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.admin_flag_driver_dispute(p_complaint_id,p_note); end $f$;
create function public.admin_funnel(p_days integer default 7,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_funnel(p_days); end $f$;
create function public.admin_list_accounts(p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_list_accounts(); end $f$;
create function public.admin_live_deliveries(p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_live_deliveries(); end $f$;
create function public.admin_pending_refunds(p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_pending_refunds(); end $f$;
create function public.admin_push_health(p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_push_health(); end $f$;
create function public.admin_rename_menu_category(p_restaurant_id integer,p_old text,p_new text,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.admin_rename_menu_category(p_restaurant_id,p_old,p_new); end $f$;
create function public.admin_reorder_menu_categories(p_restaurant_id integer,p_names text[],p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.admin_reorder_menu_categories(p_restaurant_id,p_names); end $f$;
create function public.admin_set_compound_fee(p_compound_id integer,p_fee numeric,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.admin_set_compound_fee(p_compound_id,p_fee); end $f$;
create function public.admin_set_restaurant_rank(p_restaurant_id integer,p_display_order integer,p_featured boolean default null,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.admin_set_restaurant_rank(p_restaurant_id,p_display_order,p_featured); end $f$;
create function public.admin_set_vendor_hours(p_restaurant_id integer,p_days jsonb,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.admin_set_vendor_hours(p_restaurant_id,p_days); end $f$;
create function public.admin_stalled_orders(p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_stalled_orders(); end $f$;
create function public.admin_upsert_compound(p_id integer,p_name text,p_region_id integer,p_delivery_fee numeric,p_distance_km numeric default null,p_direction text default null,p_latitude numeric default null,p_longitude numeric default null,p_active boolean default true,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_upsert_compound(p_id,p_name,p_region_id,p_delivery_fee,p_distance_km,p_direction,p_latitude,p_longitude,p_active); end $f$;
create function public.admin_vendors_without_items(p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_vendors_without_items(); end $f$;

revoke all on function public.admin_add_menu_category(integer,text,uuid) from public,anon,authenticated;
revoke all on function public.admin_customer_detail(text,uuid) from public,anon,authenticated;
revoke all on function public.admin_customers(uuid) from public,anon,authenticated;
revoke all on function public.admin_daily_report(date,uuid) from public,anon,authenticated;
revoke all on function public.admin_delete_menu_category(integer,text,uuid) from public,anon,authenticated;
revoke all on function public.admin_delete_menu_item(integer,uuid) from public,anon,authenticated;
revoke all on function public.admin_flag_driver_dispute(integer,text,uuid) from public,anon,authenticated;
revoke all on function public.admin_funnel(integer,uuid) from public,anon,authenticated;
revoke all on function public.admin_list_accounts(uuid) from public,anon,authenticated;
revoke all on function public.admin_live_deliveries(uuid) from public,anon,authenticated;
revoke all on function public.admin_pending_refunds(uuid) from public,anon,authenticated;
revoke all on function public.admin_push_health(uuid) from public,anon,authenticated;
revoke all on function public.admin_rename_menu_category(integer,text,text,uuid) from public,anon,authenticated;
revoke all on function public.admin_reorder_menu_categories(integer,text[],uuid) from public,anon,authenticated;
revoke all on function public.admin_set_compound_fee(integer,numeric,uuid) from public,anon,authenticated;
revoke all on function public.admin_set_restaurant_rank(integer,integer,boolean,uuid) from public,anon,authenticated;
revoke all on function public.admin_set_vendor_hours(integer,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.admin_stalled_orders(uuid) from public,anon,authenticated;
revoke all on function public.admin_upsert_compound(integer,text,integer,numeric,numeric,text,numeric,numeric,boolean,uuid) from public,anon,authenticated;
revoke all on function public.admin_vendors_without_items(uuid) from public,anon,authenticated;

grant execute on function public.admin_add_menu_category(integer,text,uuid) to service_role;
grant execute on function public.admin_customer_detail(text,uuid) to service_role;
grant execute on function public.admin_customers(uuid) to service_role;
grant execute on function public.admin_daily_report(date,uuid) to service_role;
grant execute on function public.admin_delete_menu_category(integer,text,uuid) to service_role;
grant execute on function public.admin_delete_menu_item(integer,uuid) to service_role;
grant execute on function public.admin_flag_driver_dispute(integer,text,uuid) to service_role;
grant execute on function public.admin_funnel(integer,uuid) to service_role;
grant execute on function public.admin_list_accounts(uuid) to service_role;
grant execute on function public.admin_live_deliveries(uuid) to service_role;
grant execute on function public.admin_pending_refunds(uuid) to service_role;
grant execute on function public.admin_push_health(uuid) to service_role;
grant execute on function public.admin_rename_menu_category(integer,text,text,uuid) to service_role;
grant execute on function public.admin_reorder_menu_categories(integer,text[],uuid) to service_role;
grant execute on function public.admin_set_compound_fee(integer,numeric,uuid) to service_role;
grant execute on function public.admin_set_restaurant_rank(integer,integer,boolean,uuid) to service_role;
grant execute on function public.admin_set_vendor_hours(integer,jsonb,uuid) to service_role;
grant execute on function public.admin_stalled_orders(uuid) to service_role;
grant execute on function public.admin_upsert_compound(integer,text,integer,numeric,numeric,text,numeric,numeric,boolean,uuid) to service_role;
grant execute on function public.admin_vendors_without_items(uuid) to service_role;

do $verification$
declare s text;
begin
 foreach s in array array[
  'public.admin_add_menu_category(integer,text,uuid)',
  'public.admin_customer_detail(text,uuid)',
  'public.admin_customers(uuid)',
  'public.admin_daily_report(date,uuid)',
  'public.admin_delete_menu_category(integer,text,uuid)',
  'public.admin_delete_menu_item(integer,uuid)',
  'public.admin_flag_driver_dispute(integer,text,uuid)',
  'public.admin_funnel(integer,uuid)',
  'public.admin_list_accounts(uuid)',
  'public.admin_live_deliveries(uuid)',
  'public.admin_pending_refunds(uuid)',
  'public.admin_push_health(uuid)',
  'public.admin_rename_menu_category(integer,text,text,uuid)',
  'public.admin_reorder_menu_categories(integer,text[],uuid)',
  'public.admin_set_compound_fee(integer,numeric,uuid)',
  'public.admin_set_restaurant_rank(integer,integer,boolean,uuid)',
  'public.admin_set_vendor_hours(integer,jsonb,uuid)',
  'public.admin_stalled_orders(uuid)',
  'public.admin_upsert_compound(integer,text,integer,numeric,numeric,text,numeric,numeric,boolean,uuid)',
  'public.admin_vendors_without_items(uuid)'
 ] loop
  if has_function_privilege('authenticated',s,'execute') or not has_function_privilege('service_role',s,'execute') then raise exception 'invalid admin panel wrapper privilege for %',s; end if;
 end loop;
end $verification$;
