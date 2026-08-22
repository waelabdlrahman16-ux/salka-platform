
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

  -- addons link via group_id -> menu_item_addon_groups.menu_item_id, not directly
  update menu_item_addons
    set price = round(base_price * (1 + v_pct))
    where base_price is not null and group_id in (
      select g.id from menu_item_addon_groups g
      join menu_items mi on mi.id = g.menu_item_id
      where mi.restaurant_id = p_restaurant_id
    );

  update menu_item_combos
    set price = round(base_price * (1 + v_pct))
    where base_price is not null and menu_item_id in (select id from menu_items where restaurant_id = p_restaurant_id);
end;
$$;
