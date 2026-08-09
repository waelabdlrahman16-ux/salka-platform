-- Batch 6: customer accounts, shift swaps, settlement requests, staff reads.
--
-- Fourteen cores move into `private`; `public` keeps service-role-only wrappers
-- that take p_auth_user_id and set request.jwt.claim.sub, so auth.uid() inside
-- the core resolves to the caller the Edge Function already authenticated. The
-- ownership rules themselves are untouched: my_customer_id() and my_driver_id()
-- still decide who owns what, they just read an impersonated claim now.
--
-- NOT INCLUDED, DELIBERATELY: is_supervisor(), my_restaurant_id(),
-- supervisor_may_touch_order() and my_customer_id(). The advisor flags all four,
-- but they are called from 8 RLS policies and from 9-12 other functions each.
-- An RLS policy is evaluated as the calling role, so `authenticated` MUST keep
-- execute on them; revoking would silently deny vendor and supervisor reads of
-- orders, order_items, delivery_assignments, drivers, restaurants and compounds.
-- They belong in batch 7's documented allowlist, not here.
--
-- APPLY ONLY AFTER THE FRONTEND IN THIS PR IS LIVE. Every wrapper gains a
-- trailing uuid argument, so an old bundle calls a signature that no longer
-- exists in `public`.

create schema if not exists private;
revoke all on schema private from public;

alter function public.add_customer_address(text,integer,text,text,boolean) set schema private;
alter function public.update_customer_address(integer,text,integer,text,text) set schema private;
alter function public.delete_customer_address(integer) set schema private;
alter function public.set_default_address(integer) set schema private;
alter function public.my_customer_addresses() set schema private;
alter function public.my_customer_profile() set schema private;
alter function public.my_customer_orders() set schema private;
alter function public.update_my_customer_name(text) set schema private;
alter function public.request_swap(integer,text) set schema private;
alter function public.accept_swap(integer) set schema private;
alter function public.escalate_swap(integer) set schema private;
alter function public.open_swaps() set schema private;
alter function public.request_early_settlement() set schema private;
alter function public.staff_vendor_open_states() set schema private;

revoke all on function
  private.add_customer_address(text,integer,text,text,boolean),
  private.update_customer_address(integer,text,integer,text,text),
  private.delete_customer_address(integer),
  private.set_default_address(integer),
  private.my_customer_addresses(),
  private.my_customer_profile(),
  private.my_customer_orders(),
  private.update_my_customer_name(text),
  private.request_swap(integer,text),
  private.accept_swap(integer),
  private.escalate_swap(integer),
  private.open_swaps(),
  private.request_early_settlement(),
  private.staff_vendor_open_states()
from public, anon, authenticated;

create function public.add_customer_address(p_label text, p_compound_id integer, p_unit_number text, p_notes text default null, p_is_default boolean default false, p_auth_user_id uuid default null)
returns integer language plpgsql security definer set search_path='public' as $f$
declare r integer; begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true);
  select private.add_customer_address(p_label,p_compound_id,p_unit_number,p_notes,p_is_default) into r; return r; end $f$;

create function public.update_customer_address(p_id integer, p_label text, p_compound_id integer, p_unit_number text, p_notes text, p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path='public' as $f$
begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true);
  perform private.update_customer_address(p_id,p_label,p_compound_id,p_unit_number,p_notes); end $f$;

create function public.delete_customer_address(p_id integer, p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path='public' as $f$
begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true);
  perform private.delete_customer_address(p_id); end $f$;

create function public.set_default_address(p_id integer, p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path='public' as $f$
begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true);
  perform private.set_default_address(p_id); end $f$;

create function public.my_customer_addresses(p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path='public' as $f$
declare r json; begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true);
  select private.my_customer_addresses() into r; return r; end $f$;

create function public.my_customer_profile(p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path='public' as $f$
declare r json; begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true);
  select private.my_customer_profile() into r; return r; end $f$;

create function public.my_customer_orders(p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path='public' as $f$
declare r json; begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true);
  select private.my_customer_orders() into r; return r; end $f$;

create function public.update_my_customer_name(p_name text, p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path='public' as $f$
begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true);
  perform private.update_my_customer_name(p_name); end $f$;

create function public.request_swap(p_shift_id integer, p_reason text default '', p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path='public' as $f$
declare r json; begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true);
  select private.request_swap(p_shift_id,p_reason) into r; return r; end $f$;

create function public.accept_swap(p_request_id integer, p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path='public' as $f$
declare r json; begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true);
  select private.accept_swap(p_request_id) into r; return r; end $f$;

create function public.escalate_swap(p_request_id integer, p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path='public' as $f$
begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true);
  perform private.escalate_swap(p_request_id); end $f$;

create function public.open_swaps(p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path='public' as $f$
declare r json; begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true);
  select private.open_swaps() into r; return r; end $f$;

create function public.request_early_settlement(p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path='public' as $f$
begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true);
  perform private.request_early_settlement(); end $f$;

create function public.staff_vendor_open_states(p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path='public' as $f$
declare r json; begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true);
  select private.staff_vendor_open_states() into r; return r; end $f$;

revoke all on function
  public.add_customer_address(text,integer,text,text,boolean,uuid),
  public.update_customer_address(integer,text,integer,text,text,uuid),
  public.delete_customer_address(integer,uuid),
  public.set_default_address(integer,uuid),
  public.my_customer_addresses(uuid),
  public.my_customer_profile(uuid),
  public.my_customer_orders(uuid),
  public.update_my_customer_name(text,uuid),
  public.request_swap(integer,text,uuid),
  public.accept_swap(integer,uuid),
  public.escalate_swap(integer,uuid),
  public.open_swaps(uuid),
  public.request_early_settlement(uuid),
  public.staff_vendor_open_states(uuid)
from public, anon, authenticated;

grant execute on function
  public.add_customer_address(text,integer,text,text,boolean,uuid),
  public.update_customer_address(integer,text,integer,text,text,uuid),
  public.delete_customer_address(integer,uuid),
  public.set_default_address(integer,uuid),
  public.my_customer_addresses(uuid),
  public.my_customer_profile(uuid),
  public.my_customer_orders(uuid),
  public.update_my_customer_name(text,uuid),
  public.request_swap(integer,text,uuid),
  public.accept_swap(integer,uuid),
  public.escalate_swap(integer,uuid),
  public.open_swaps(uuid),
  public.request_early_settlement(uuid),
  public.staff_vendor_open_states(uuid)
to service_role;

do $v$
declare s text;
begin
  foreach s in array array[
    'public.add_customer_address(text,integer,text,text,boolean,uuid)',
    'public.update_customer_address(integer,text,integer,text,text,uuid)',
    'public.delete_customer_address(integer,uuid)',
    'public.set_default_address(integer,uuid)',
    'public.my_customer_addresses(uuid)',
    'public.my_customer_profile(uuid)',
    'public.my_customer_orders(uuid)',
    'public.update_my_customer_name(text,uuid)',
    'public.request_swap(integer,text,uuid)',
    'public.accept_swap(integer,uuid)',
    'public.escalate_swap(integer,uuid)',
    'public.open_swaps(uuid)',
    'public.request_early_settlement(uuid)',
    'public.staff_vendor_open_states(uuid)'
  ] loop
    if has_function_privilege('authenticated', s, 'execute')
       or has_function_privilege('anon', s, 'execute')
       or not has_function_privilege('service_role', s, 'execute') then
      raise exception 'invalid batch 6 wrapper %', s;
    end if;
  end loop;

  -- The four predicates RLS depends on must still be reachable by authenticated,
  -- or vendor and supervisor reads go dark.
  foreach s in array array[
    'public.is_supervisor()','public.my_restaurant_id()',
    'public.supervisor_may_touch_order(integer)','public.my_customer_id()'
  ] loop
    if not has_function_privilege('authenticated', s, 'execute') then
      raise exception 'RLS predicate % lost authenticated execute', s;
    end if;
  end loop;
end $v$;
