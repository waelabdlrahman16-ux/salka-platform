-- Reconciled from production migration history. Already applied in project pqpnwxyevrsipklzmwex.
-- Do not apply this file to production again.

-- menu_items: direct-table writes currently is_admin() OR is_catalog_manager() only.
-- Add restaurant ownership, mirroring the delivery_slots precedent (PR #82).
drop policy if exists "manage menu delete" on menu_items;
create policy "manage menu delete" on menu_items for delete
  using (is_admin() or is_catalog_manager() or restaurant_id = my_restaurant_id());
drop policy if exists "manage menu insert" on menu_items;
create policy "manage menu insert" on menu_items for insert
  with check (is_admin() or is_catalog_manager() or restaurant_id = my_restaurant_id());
drop policy if exists "manage menu update" on menu_items;
create policy "manage menu update" on menu_items for update
  using (is_admin() or is_catalog_manager() or restaurant_id = my_restaurant_id())
  with check (is_admin() or is_catalog_manager() or restaurant_id = my_restaurant_id());
-- menu_item_sizes: no restaurant_id column, join through menu_items.
drop policy if exists "manage sizes delete" on menu_item_sizes;
create policy "manage sizes delete" on menu_item_sizes for delete
  using (is_admin() or is_catalog_manager() or exists (
    select 1 from menu_items mi where mi.id = menu_item_sizes.menu_item_id and mi.restaurant_id = my_restaurant_id()));
drop policy if exists "manage sizes insert" on menu_item_sizes;
create policy "manage sizes insert" on menu_item_sizes for insert
  with check (is_admin() or is_catalog_manager() or exists (
    select 1 from menu_items mi where mi.id = menu_item_sizes.menu_item_id and mi.restaurant_id = my_restaurant_id()));
drop policy if exists "manage sizes update" on menu_item_sizes;
create policy "manage sizes update" on menu_item_sizes for update
  using (is_admin() or is_catalog_manager() or exists (
    select 1 from menu_items mi where mi.id = menu_item_sizes.menu_item_id and mi.restaurant_id = my_restaurant_id()))
  with check (is_admin() or is_catalog_manager() or exists (
    select 1 from menu_items mi where mi.id = menu_item_sizes.menu_item_id and mi.restaurant_id = my_restaurant_id()));

-- menu_item_combos: same join pattern as sizes.
drop policy if exists "manage combos delete" on menu_item_combos;
create policy "manage combos delete" on menu_item_combos for delete
  using (is_admin() or is_catalog_manager() or exists (
    select 1 from menu_items mi where mi.id = menu_item_combos.menu_item_id and mi.restaurant_id = my_restaurant_id()));
drop policy if exists "manage combos insert" on menu_item_combos;
create policy "manage combos insert" on menu_item_combos for insert
  with check (is_admin() or is_catalog_manager() or exists (
    select 1 from menu_items mi where mi.id = menu_item_combos.menu_item_id and mi.restaurant_id = my_restaurant_id()));
drop policy if exists "manage combos update" on menu_item_combos;
create policy "manage combos update" on menu_item_combos for update
  using (is_admin() or is_catalog_manager() or exists (
    select 1 from menu_items mi where mi.id = menu_item_combos.menu_item_id and mi.restaurant_id = my_restaurant_id()))
  with check (is_admin() or is_catalog_manager() or exists (
    select 1 from menu_items mi where mi.id = menu_item_combos.menu_item_id and mi.restaurant_id = my_restaurant_id()));

-- menu_item_addon_groups: joins through menu_items via menu_item_id.
drop policy if exists "manage addon groups delete" on menu_item_addon_groups;
create policy "manage addon groups delete" on menu_item_addon_groups for delete
  using (is_admin() or is_catalog_manager() or exists (
    select 1 from menu_items mi where mi.id = menu_item_addon_groups.menu_item_id and mi.restaurant_id = my_restaurant_id()));
drop policy if exists "manage addon groups insert" on menu_item_addon_groups;
create policy "manage addon groups insert" on menu_item_addon_groups for insert
  with check (is_admin() or is_catalog_manager() or exists (
    select 1 from menu_items mi where mi.id = menu_item_addon_groups.menu_item_id and mi.restaurant_id = my_restaurant_id()));
drop policy if exists "manage addon groups update" on menu_item_addon_groups;
create policy "manage addon groups update" on menu_item_addon_groups for update
  using (is_admin() or is_catalog_manager() or exists (
    select 1 from menu_items mi where mi.id = menu_item_addon_groups.menu_item_id and mi.restaurant_id = my_restaurant_id()))
  with check (is_admin() or is_catalog_manager() or exists (
    select 1 from menu_items mi where mi.id = menu_item_addon_groups.menu_item_id and mi.restaurant_id = my_restaurant_id()));

-- menu_item_addons: joins through menu_item_addon_groups -> menu_items.
drop policy if exists "manage addons delete" on menu_item_addons;
create policy "manage addons delete" on menu_item_addons for delete
  using (is_admin() or is_catalog_manager() or exists (
    select 1 from menu_item_addon_groups g join menu_items mi on mi.id = g.menu_item_id
     where g.id = menu_item_addons.group_id and mi.restaurant_id = my_restaurant_id()));
drop policy if exists "manage addons insert" on menu_item_addons;
create policy "manage addons insert" on menu_item_addons for insert
  with check (is_admin() or is_catalog_manager() or exists (
    select 1 from menu_item_addon_groups g join menu_items mi on mi.id = g.menu_item_id
     where g.id = menu_item_addons.group_id and mi.restaurant_id = my_restaurant_id()));
drop policy if exists "manage addons update" on menu_item_addons;
create policy "manage addons update" on menu_item_addons for update
  using (is_admin() or is_catalog_manager() or exists (
    select 1 from menu_item_addon_groups g join menu_items mi on mi.id = g.menu_item_id
     where g.id = menu_item_addons.group_id and mi.restaurant_id = my_restaurant_id()))
  with check (is_admin() or is_catalog_manager() or exists (
    select 1 from menu_item_addon_groups g join menu_items mi on mi.id = g.menu_item_id
     where g.id = menu_item_addons.group_id and mi.restaurant_id = my_restaurant_id()));

-- discounts: has restaurant_id directly.
drop policy if exists "manage discounts delete" on discounts;
create policy "manage discounts delete" on discounts for delete
  using (is_admin() or restaurant_id = my_restaurant_id());
drop policy if exists "manage discounts insert" on discounts;
create policy "manage discounts insert" on discounts for insert
  with check (is_admin() or restaurant_id = my_restaurant_id());
drop policy if exists "manage discounts update" on discounts;
create policy "manage discounts update" on discounts for update
  using (is_admin() or restaurant_id = my_restaurant_id())
  with check (is_admin() or restaurant_id = my_restaurant_id());

-- vendor_addon_library: has restaurant_id directly.
drop policy if exists "manage addon library delete" on vendor_addon_library;
create policy "manage addon library delete" on vendor_addon_library for delete
  using (is_admin() or is_catalog_manager() or restaurant_id = my_restaurant_id());
drop policy if exists "manage addon library insert" on vendor_addon_library;
create policy "manage addon library insert" on vendor_addon_library for insert
  with check (is_admin() or is_catalog_manager() or restaurant_id = my_restaurant_id());
drop policy if exists "manage addon library update" on vendor_addon_library;
create policy "manage addon library update" on vendor_addon_library for update
  using (is_admin() or is_catalog_manager() or restaurant_id = my_restaurant_id())
  with check (is_admin() or is_catalog_manager() or restaurant_id = my_restaurant_id());
