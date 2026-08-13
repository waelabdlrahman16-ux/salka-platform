-- Safe, server-side bulk catalogue pricing.  The two operations are separate:
-- selected-category price adjustments never change the restaurant-wide markup,
-- while baking a markup always covers the entire restaurant before clearing it.

create or replace function private.admin_adjust_restaurant_prices(p_restaurant_id integer, p_categories text[], p_percent numeric)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_factor numeric; v_pct numeric; v_items integer := 0; v_sizes integer := 0; v_combos integer := 0; v_addons integer := 0;
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  if p_percent is null or p_percent < -50 or p_percent > 100 then raise exception 'invalid_pct'; end if;
  if p_categories is not null and cardinality(p_categories) = 0 then raise exception 'categories_required'; end if;
  select service_fee_pct into v_pct from restaurants where id = p_restaurant_id for update;
  if not found then raise exception 'restaurant_not_found'; end if;
  v_factor := 1 + p_percent / 100.0;

  update menu_items mi set base_price = round(coalesce(mi.base_price, mi.price) * v_factor), price = round(coalesce(mi.base_price, mi.price) * v_factor * (1 + coalesce(v_pct,0)))
    where mi.restaurant_id=p_restaurant_id and (p_categories is null or mi.category = any(p_categories));
  get diagnostics v_items = row_count;
  update menu_item_sizes s set base_price = round(coalesce(s.base_price,s.price)*v_factor), price = round(coalesce(s.base_price,s.price)*v_factor*(1+coalesce(v_pct,0)))
    from menu_items mi where s.menu_item_id=mi.id and mi.restaurant_id=p_restaurant_id and (p_categories is null or mi.category=any(p_categories));
  get diagnostics v_sizes = row_count;
  update menu_item_combos c set base_price = round(coalesce(c.base_price,c.price)*v_factor), price = round(coalesce(c.base_price,c.price)*v_factor*(1+coalesce(v_pct,0)))
    from menu_items mi where c.menu_item_id=mi.id and mi.restaurant_id=p_restaurant_id and (p_categories is null or mi.category=any(p_categories));
  get diagnostics v_combos = row_count;
  update menu_item_addons a set base_price = round(coalesce(a.base_price,a.price)*v_factor), price = round(coalesce(a.base_price,a.price)*v_factor*(1+coalesce(v_pct,0)))
    from menu_item_addon_groups g join menu_items mi on mi.id=g.menu_item_id
    where a.group_id=g.id and mi.restaurant_id=p_restaurant_id and (p_categories is null or mi.category=any(p_categories));
  get diagnostics v_addons = row_count;
  return json_build_object('items',v_items,'sizes',v_sizes,'combos',v_combos,'addons',v_addons);
end $$;

create or replace function private.admin_bake_restaurant_service_fee(p_restaurant_id integer)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_pct numeric; v_items integer := 0; v_sizes integer := 0; v_combos integer := 0; v_addons integer := 0;
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  select service_fee_pct into v_pct from restaurants where id=p_restaurant_id for update;
  if not found then raise exception 'restaurant_not_found'; end if;
  if coalesce(v_pct,0)=0 then raise exception 'service_fee_not_enabled'; end if;
  -- Price is today's customer-facing amount. Make it the base before clearing
  -- the fee, so the catalogue total cannot change as a side effect.
  update menu_items set base_price=price where restaurant_id=p_restaurant_id; get diagnostics v_items = row_count;
  update menu_item_sizes s set base_price=s.price where s.menu_item_id in (select id from menu_items where restaurant_id=p_restaurant_id); get diagnostics v_sizes = row_count;
  update menu_item_combos c set base_price=c.price where c.menu_item_id in (select id from menu_items where restaurant_id=p_restaurant_id); get diagnostics v_combos = row_count;
  update menu_item_addons a set base_price=a.price where a.group_id in (select g.id from menu_item_addon_groups g join menu_items mi on mi.id=g.menu_item_id where mi.restaurant_id=p_restaurant_id); get diagnostics v_addons = row_count;
  update restaurants set service_fee_pct=0 where id=p_restaurant_id;
  perform private.apply_restaurant_service_fee(p_restaurant_id);
  return json_build_object('previous_pct',v_pct,'items',v_items,'sizes',v_sizes,'combos',v_combos,'addons',v_addons);
end $$;

create or replace function public.admin_adjust_restaurant_prices(p_restaurant_id integer,p_categories text[],p_percent numeric,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_adjust_restaurant_prices(p_restaurant_id,p_categories,p_percent); end $$;
create or replace function public.admin_bake_restaurant_service_fee(p_restaurant_id integer,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_bake_restaurant_service_fee(p_restaurant_id); end $$;
revoke all on function private.admin_adjust_restaurant_prices(integer,text[],numeric), private.admin_bake_restaurant_service_fee(integer) from public,anon,authenticated;
revoke all on function public.admin_adjust_restaurant_prices(integer,text[],numeric,uuid), public.admin_bake_restaurant_service_fee(integer,uuid) from public,anon,authenticated;
grant execute on function public.admin_adjust_restaurant_prices(integer,text[],numeric,uuid), public.admin_bake_restaurant_service_fee(integer,uuid) to service_role;
