
-- The apply_restaurant_service_fee helper I created earlier was a plain public
-- function with no is_admin() gate -- a real gap given this project's established
-- pattern (route_admin_panel_actions_through_edge). Fixing it now: move the
-- helper to private, and expose control only through a properly-gated
-- admin_set_restaurant_service_fee, same shape as admin_set_compound_fee.

drop function if exists public.apply_restaurant_service_fee(integer);

create or replace function private.apply_restaurant_service_fee(p_restaurant_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_pct numeric;
begin
  select service_fee_pct into v_pct from restaurants where id = p_restaurant_id;
  if v_pct is null then v_pct := 0; end if;

  update menu_items
    set price = round(base_price * (1 + v_pct))
    where restaurant_id = p_restaurant_id and base_price is not null;

  update menu_item_sizes
    set price = round(base_price * (1 + v_pct))
    where base_price is not null and menu_item_id in (select id from menu_items where restaurant_id = p_restaurant_id);

  update menu_item_addons
    set price = round(base_price * (1 + v_pct))
    where base_price is not null and menu_item_id in (select id from menu_items where restaurant_id = p_restaurant_id);

  update menu_item_combos
    set price = round(base_price * (1 + v_pct))
    where base_price is not null and menu_item_id in (select id from menu_items where restaurant_id = p_restaurant_id);
end;
$$;
revoke all on function private.apply_restaurant_service_fee(integer) from public, anon, authenticated;

create or replace function private.admin_set_restaurant_service_fee(p_restaurant_id integer, p_pct numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 0.5 then raise exception 'invalid_pct'; end if;
  if not exists (select 1 from restaurants where id = p_restaurant_id) then raise exception 'restaurant_not_found'; end if;

  update restaurants set service_fee_pct = p_pct where id = p_restaurant_id;
  perform private.apply_restaurant_service_fee(p_restaurant_id);
end;
$$;
revoke all on function private.admin_set_restaurant_service_fee(integer, numeric) from public, anon, authenticated;

create or replace function public.admin_set_restaurant_service_fee(p_restaurant_id integer, p_pct numeric, p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $f$
begin
  perform set_config('request.jwt.claim.sub', p_auth_user_id::text, true);
  perform private.admin_set_restaurant_service_fee(p_restaurant_id, p_pct);
end $f$;
revoke all on function public.admin_set_restaurant_service_fee(integer, numeric, uuid) from public, anon, authenticated;
grant execute on function public.admin_set_restaurant_service_fee(integer, numeric, uuid) to service_role;

do $verification$
begin
  if has_function_privilege('authenticated','public.admin_set_restaurant_service_fee(integer,numeric,uuid)','execute')
     or not has_function_privilege('service_role','public.admin_set_restaurant_service_fee(integer,numeric,uuid)','execute') then
    raise exception 'invalid admin_set_restaurant_service_fee privilege';
  end if;
end $verification$;
