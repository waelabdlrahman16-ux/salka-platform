create schema if not exists private;
revoke all on schema private from public;

alter function public.admin_adjust_order(integer,numeric,text,boolean) set schema private;
alter function public.admin_confirm_cod_deposit(integer) set schema private;
alter function public.admin_confirm_instapay_payment(integer,boolean) set schema private;
alter function public.credit_wallet(text,numeric,text,integer) set schema private;
alter function public.mark_refunded(integer) set schema private;
alter function public.settle_driver_cash(integer) set schema private;
alter function public.settle_driver_earnings(integer) set schema private;

revoke all on function private.admin_adjust_order(integer,numeric,text,boolean) from public,anon,authenticated;
revoke all on function private.admin_confirm_cod_deposit(integer) from public,anon,authenticated;
revoke all on function private.admin_confirm_instapay_payment(integer,boolean) from public,anon,authenticated;
revoke all on function private.credit_wallet(text,numeric,text,integer) from public,anon,authenticated;
revoke all on function private.mark_refunded(integer) from public,anon,authenticated;
revoke all on function private.settle_driver_cash(integer) from public,anon,authenticated;
revoke all on function private.settle_driver_earnings(integer) from public,anon,authenticated;

create function public.admin_adjust_order(p_order_id integer,p_amount numeric,p_reason text,p_charge_service_fee boolean default false,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_adjust_order(p_order_id,p_amount,p_reason,p_charge_service_fee); end $f$;
create function public.admin_confirm_cod_deposit(p_order_id integer,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.admin_confirm_cod_deposit(p_order_id); end $f$;
create function public.admin_confirm_instapay_payment(p_order_id integer,p_force boolean default false,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.admin_confirm_instapay_payment(p_order_id,p_force); end $f$;
create function public.credit_wallet(p_phone text,p_amount numeric,p_reason text,p_order_id integer default null,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.credit_wallet(p_phone,p_amount,p_reason,p_order_id); end $f$;
create function public.mark_refunded(p_order_id integer,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.mark_refunded(p_order_id); end $f$;
create function public.settle_driver_cash(p_driver_id integer,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.settle_driver_cash(p_driver_id); end $f$;
create function public.settle_driver_earnings(p_driver_id integer,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.settle_driver_earnings(p_driver_id); end $f$;

revoke all on function public.admin_adjust_order(integer,numeric,text,boolean,uuid) from public,anon,authenticated;
revoke all on function public.admin_confirm_cod_deposit(integer,uuid) from public,anon,authenticated;
revoke all on function public.admin_confirm_instapay_payment(integer,boolean,uuid) from public,anon,authenticated;
revoke all on function public.credit_wallet(text,numeric,text,integer,uuid) from public,anon,authenticated;
revoke all on function public.mark_refunded(integer,uuid) from public,anon,authenticated;
revoke all on function public.settle_driver_cash(integer,uuid) from public,anon,authenticated;
revoke all on function public.settle_driver_earnings(integer,uuid) from public,anon,authenticated;
grant execute on function public.admin_adjust_order(integer,numeric,text,boolean,uuid) to service_role;
grant execute on function public.admin_confirm_cod_deposit(integer,uuid) to service_role;
grant execute on function public.admin_confirm_instapay_payment(integer,boolean,uuid) to service_role;
grant execute on function public.credit_wallet(text,numeric,text,integer,uuid) to service_role;
grant execute on function public.mark_refunded(integer,uuid) to service_role;
grant execute on function public.settle_driver_cash(integer,uuid) to service_role;
grant execute on function public.settle_driver_earnings(integer,uuid) to service_role;

do $verification$
declare s text;
begin
 foreach s in array array['public.admin_adjust_order(integer,numeric,text,boolean,uuid)','public.admin_confirm_cod_deposit(integer,uuid)','public.admin_confirm_instapay_payment(integer,boolean,uuid)','public.credit_wallet(text,numeric,text,integer,uuid)','public.mark_refunded(integer,uuid)','public.settle_driver_cash(integer,uuid)','public.settle_driver_earnings(integer,uuid)'] loop
  if has_function_privilege('authenticated',s,'execute') or not has_function_privilege('service_role',s,'execute') then raise exception 'invalid financial wrapper privilege for %',s; end if;
 end loop;
end $verification$;
