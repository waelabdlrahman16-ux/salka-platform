create schema if not exists private;
revoke all on schema private from public;

alter function public.admin_convert_staff_role(uuid,text) set schema private;
alter function public.admin_delete_customer(integer,boolean) set schema private;
alter function public.admin_delete_customer_by_phone(text,boolean) set schema private;
alter function public.admin_delete_staff(uuid,boolean) set schema private;
alter function public.admin_reset_driver_device(integer) set schema private;
alter function public.admin_set_customer_ban(text,boolean,text) set schema private;
alter function public.admin_upsert_driver(integer,text,text,text,text,text,text,boolean) set schema private;

-- This core calls admin_delete_customer() by its unqualified name. Once both
-- functions move out of the exposed schema, resolve that call to the private
-- core instead of the public service-only wrapper.
alter function private.admin_delete_customer_by_phone(text,boolean) set search_path to 'private','public';

revoke all on function private.admin_convert_staff_role(uuid,text) from public,anon,authenticated;
revoke all on function private.admin_delete_customer(integer,boolean) from public,anon,authenticated;
revoke all on function private.admin_delete_customer_by_phone(text,boolean) from public,anon,authenticated;
revoke all on function private.admin_delete_staff(uuid,boolean) from public,anon,authenticated;
revoke all on function private.admin_reset_driver_device(integer) from public,anon,authenticated;
revoke all on function private.admin_set_customer_ban(text,boolean,text) from public,anon,authenticated;
revoke all on function private.admin_upsert_driver(integer,text,text,text,text,text,text,boolean) from public,anon,authenticated;

create function public.admin_convert_staff_role(p_profile_id uuid,p_role text,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.admin_convert_staff_role(p_profile_id,p_role); end $f$;
create function public.admin_delete_customer(p_customer_id integer,p_force boolean default false,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_delete_customer(p_customer_id,p_force); end $f$;
create function public.admin_delete_customer_by_phone(p_phone text,p_force boolean default false,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_delete_customer_by_phone(p_phone,p_force); end $f$;
create function public.admin_delete_staff(p_profile_id uuid,p_force boolean default false,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_delete_staff(p_profile_id,p_force); end $f$;
create function public.admin_reset_driver_device(p_driver_id integer,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.admin_reset_driver_device(p_driver_id); end $f$;
create function public.admin_set_customer_ban(p_phone text,p_banned boolean,p_reason text default null,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_set_customer_ban(p_phone,p_banned,p_reason); end $f$;
create function public.admin_upsert_driver(p_id integer,p_name text,p_phone text,p_vehicle_type text default 'motorcycle',p_vehicle_plate text default '',p_instapay_number text default null,p_payout_schedule text default 'daily',p_active boolean default true,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_upsert_driver(p_id,p_name,p_phone,p_vehicle_type,p_vehicle_plate,p_instapay_number,p_payout_schedule,p_active); end $f$;

revoke all on function public.admin_convert_staff_role(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.admin_delete_customer(integer,boolean,uuid) from public,anon,authenticated;
revoke all on function public.admin_delete_customer_by_phone(text,boolean,uuid) from public,anon,authenticated;
revoke all on function public.admin_delete_staff(uuid,boolean,uuid) from public,anon,authenticated;
revoke all on function public.admin_reset_driver_device(integer,uuid) from public,anon,authenticated;
revoke all on function public.admin_set_customer_ban(text,boolean,text,uuid) from public,anon,authenticated;
revoke all on function public.admin_upsert_driver(integer,text,text,text,text,text,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.admin_convert_staff_role(uuid,text,uuid) to service_role;
grant execute on function public.admin_delete_customer(integer,boolean,uuid) to service_role;
grant execute on function public.admin_delete_customer_by_phone(text,boolean,uuid) to service_role;
grant execute on function public.admin_delete_staff(uuid,boolean,uuid) to service_role;
grant execute on function public.admin_reset_driver_device(integer,uuid) to service_role;
grant execute on function public.admin_set_customer_ban(text,boolean,text,uuid) to service_role;
grant execute on function public.admin_upsert_driver(integer,text,text,text,text,text,text,boolean,uuid) to service_role;

do $verification$
declare s text;
begin
 foreach s in array array[
  'public.admin_convert_staff_role(uuid,text,uuid)',
  'public.admin_delete_customer(integer,boolean,uuid)',
  'public.admin_delete_customer_by_phone(text,boolean,uuid)',
  'public.admin_delete_staff(uuid,boolean,uuid)',
  'public.admin_reset_driver_device(integer,uuid)',
  'public.admin_set_customer_ban(text,boolean,text,uuid)',
  'public.admin_upsert_driver(integer,text,text,text,text,text,text,boolean,uuid)'
 ] loop
  if has_function_privilege('authenticated',s,'execute') or not has_function_privilege('service_role',s,'execute') then raise exception 'invalid account wrapper privilege for %',s; end if;
 end loop;
end $verification$;
