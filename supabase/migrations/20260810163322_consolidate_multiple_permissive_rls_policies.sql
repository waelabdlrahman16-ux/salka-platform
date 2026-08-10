-- Consolidate RLS policies flagged by the Supabase performance linter as
-- "multiple_permissive_policies": several tables had 2-3 permissive policies
-- covering the same (role, action) pair, forcing Postgres to evaluate all of
-- them on every query. Where two write policies only differed in which role
-- check they used (is_admin() vs is_catalog_manager()), they are merged into
-- write-only policies (INSERT/UPDATE/DELETE) so a separate, single public-read
-- SELECT policy is the only one left for reads. Where a narrower policy
-- (supervisor/admin) was already fully covered by a broader one, the narrower
-- one is dropped. Where two SELECT policies had genuinely different
-- conditions, they are OR'd into a single policy so the semantics are
-- unchanged but only one policy is evaluated per query.

-- 1. Catalog tables: admin + catalog-manager both get ALL, public gets SELECT.
--    Split admin/catalog ALL into write-only actions so the public SELECT
--    policy is the sole SELECT policy.
drop policy if exists "admin writes categories" on public.menu_categories;
drop policy if exists "catalog writes categories" on public.menu_categories;
create policy "manage categories insert" on public.menu_categories for insert with check (is_admin() or is_catalog_manager());
create policy "manage categories update" on public.menu_categories for update using (is_admin() or is_catalog_manager()) with check (is_admin() or is_catalog_manager());
create policy "manage categories delete" on public.menu_categories for delete using (is_admin() or is_catalog_manager());

drop policy if exists "admin writes addon groups" on public.menu_item_addon_groups;
drop policy if exists "catalog writes addon groups" on public.menu_item_addon_groups;
create policy "manage addon groups insert" on public.menu_item_addon_groups for insert with check (is_admin() or is_catalog_manager());
create policy "manage addon groups update" on public.menu_item_addon_groups for update using (is_admin() or is_catalog_manager()) with check (is_admin() or is_catalog_manager());
create policy "manage addon groups delete" on public.menu_item_addon_groups for delete using (is_admin() or is_catalog_manager());

drop policy if exists "admin writes addons" on public.menu_item_addons;
drop policy if exists "catalog writes addons" on public.menu_item_addons;
create policy "manage addons insert" on public.menu_item_addons for insert with check (is_admin() or is_catalog_manager());
create policy "manage addons update" on public.menu_item_addons for update using (is_admin() or is_catalog_manager()) with check (is_admin() or is_catalog_manager());
create policy "manage addons delete" on public.menu_item_addons for delete using (is_admin() or is_catalog_manager());

drop policy if exists "admin writes combos" on public.menu_item_combos;
drop policy if exists "catalog writes combos" on public.menu_item_combos;
create policy "manage combos insert" on public.menu_item_combos for insert with check (is_admin() or is_catalog_manager());
create policy "manage combos update" on public.menu_item_combos for update using (is_admin() or is_catalog_manager()) with check (is_admin() or is_catalog_manager());
create policy "manage combos delete" on public.menu_item_combos for delete using (is_admin() or is_catalog_manager());

drop policy if exists "admin writes menu sizes" on public.menu_item_sizes;
drop policy if exists "catalog writes menu sizes" on public.menu_item_sizes;
create policy "manage sizes insert" on public.menu_item_sizes for insert with check (is_admin() or is_catalog_manager());
create policy "manage sizes update" on public.menu_item_sizes for update using (is_admin() or is_catalog_manager()) with check (is_admin() or is_catalog_manager());
create policy "manage sizes delete" on public.menu_item_sizes for delete using (is_admin() or is_catalog_manager());

drop policy if exists "admin writes menu" on public.menu_items;
drop policy if exists "catalog writes menu" on public.menu_items;
create policy "manage menu insert" on public.menu_items for insert with check (is_admin() or is_catalog_manager());
create policy "manage menu update" on public.menu_items for update using (is_admin() or is_catalog_manager()) with check (is_admin() or is_catalog_manager());
create policy "manage menu delete" on public.menu_items for delete using (is_admin() or is_catalog_manager());

drop policy if exists "admin writes addon library" on public.vendor_addon_library;
drop policy if exists "catalog writes addon library" on public.vendor_addon_library;
create policy "manage addon library insert" on public.vendor_addon_library for insert with check (is_admin() or is_catalog_manager());
create policy "manage addon library update" on public.vendor_addon_library for update using (is_admin() or is_catalog_manager()) with check (is_admin() or is_catalog_manager());
create policy "manage addon library delete" on public.vendor_addon_library for delete using (is_admin() or is_catalog_manager());

-- 2. Tables where a narrower supervisor/admin SELECT policy is fully
--    redundant with an already-public (true) SELECT policy: drop the
--    narrower one, and split the admin ALL policy into write-only actions.
drop policy if exists "supervisor reads compounds" on public.compounds;
drop policy if exists "admin writes compounds" on public.compounds;
create policy "manage compounds insert" on public.compounds for insert with check (is_admin());
create policy "manage compounds update" on public.compounds for update using (is_admin()) with check (is_admin());
create policy "manage compounds delete" on public.compounds for delete using (is_admin());

drop policy if exists "admin writes slots" on public.delivery_slots;
create policy "manage slots insert" on public.delivery_slots for insert with check (is_admin());
create policy "manage slots update" on public.delivery_slots for update using (is_admin()) with check (is_admin());
create policy "manage slots delete" on public.delivery_slots for delete using (is_admin());

drop policy if exists "admin writes discounts" on public.discounts;
create policy "manage discounts insert" on public.discounts for insert with check (is_admin());
create policy "manage discounts update" on public.discounts for update using (is_admin()) with check (is_admin());
create policy "manage discounts delete" on public.discounts for delete using (is_admin());

drop policy if exists "admin writes regions" on public.regions;
create policy "manage regions insert" on public.regions for insert with check (is_admin());
create policy "manage regions update" on public.regions for update using (is_admin()) with check (is_admin());
create policy "manage regions delete" on public.regions for delete using (is_admin());

drop policy if exists "supervisor reads restaurants" on public.restaurants;
drop policy if exists "admin writes restaurants" on public.restaurants;
create policy "manage restaurants insert" on public.restaurants for insert with check (is_admin());
create policy "manage restaurants update" on public.restaurants for update using (is_admin()) with check (is_admin());
create policy "manage restaurants delete" on public.restaurants for delete using (is_admin());

drop policy if exists "admin writes coverage" on public.vendor_coverage;
create policy "manage coverage insert" on public.vendor_coverage for insert with check (is_admin());
create policy "manage coverage update" on public.vendor_coverage for update using (is_admin()) with check (is_admin());
create policy "manage coverage delete" on public.vendor_coverage for delete using (is_admin());

-- 3. driver_settlements: the explicit read policy's OR clause already covers
--    the admin case, so the write policy only needs to cover writes.
drop policy if exists "admin writes settlements" on public.driver_settlements;
create policy "manage settlements insert" on public.driver_settlements for insert with check (is_admin());
create policy "manage settlements update" on public.driver_settlements for update using (is_admin()) with check (is_admin());
create policy "manage settlements delete" on public.driver_settlements for delete using (is_admin());

-- 4. delivery_assignments: fold the supervisor condition into the existing
--    read policy instead of a separate policy.
drop policy if exists "supervisor reads assignments" on public.delivery_assignments;
drop policy if exists "read assignments" on public.delivery_assignments;
create policy "read assignments" on public.delivery_assignments for select
  using (is_admin() or driver_id = my_driver_id() or is_supervisor());

-- 5. drivers: same fold.
drop policy if exists "supervisor reads drivers" on public.drivers;
drop policy if exists "read drivers" on public.drivers;
create policy "read drivers" on public.drivers for select
  using (is_admin() or id = my_driver_id() or is_supervisor());

-- 6. order_items: merge the three read policies (staff/supervisor/vendor)
--    into a single OR'd policy with identical semantics.
drop policy if exists "staff read order items" on public.order_items;
drop policy if exists "supervisor reads order items" on public.order_items;
drop policy if exists "vendor reads order items" on public.order_items;
create policy "read order items" on public.order_items for select
  using (
    is_admin()
    or exists (select 1 from delivery_assignments da where da.order_id = order_items.order_id and da.driver_id = my_driver_id())
    or (is_supervisor() and exists (select 1 from orders o where o.id = order_items.order_id))
    or exists (select 1 from orders o where o.id = order_items.order_id and o.restaurant_id = my_restaurant_id())
  );

-- 7. orders: same merge for its three read policies.
drop policy if exists "staff read orders" on public.orders;
drop policy if exists "supervisor reads orders" on public.orders;
drop policy if exists "vendor reads orders" on public.orders;
create policy "read orders" on public.orders for select
  using (
    is_admin()
    or exists (select 1 from delivery_assignments da where da.order_id = orders.id and da.driver_id = my_driver_id())
    or supervisor_may_touch_order(id)
    or restaurant_id = my_restaurant_id()
  );

-- 8. shift_swap_requests: the read policy's is_admin() clause already covers
--    the admin ALL policy's select component, so narrow it to writes only.
drop policy if exists "admin manages swap requests" on public.shift_swap_requests;
create policy "manage swap requests insert" on public.shift_swap_requests for insert with check (is_admin());
create policy "manage swap requests update" on public.shift_swap_requests for update using (is_admin()) with check (is_admin());
create policy "manage swap requests delete" on public.shift_swap_requests for delete using (is_admin());

-- 9. shifts: fold the "driver reads open swap shifts" condition into "read
--    shifts", then narrow the admin ALL policy to writes only.
drop policy if exists "driver reads open swap shifts" on public.shifts;
drop policy if exists "read shifts" on public.shifts;
create policy "read shifts" on public.shifts for select
  using (
    is_admin()
    or driver_id = my_driver_id()
    or (my_driver_id() is not null and exists (select 1 from shift_swap_requests r where r.shift_id = shifts.id and r.status = 'open'))
  );
drop policy if exists "admin writes shifts" on public.shifts;
create policy "manage shifts insert" on public.shifts for insert with check (is_admin());
create policy "manage shifts update" on public.shifts for update using (is_admin()) with check (is_admin());
create policy "manage shifts delete" on public.shifts for delete using (is_admin());

-- 10. banners: admin needs to see inactive/future banners that the public
--     policy excludes, so fold admin visibility into the read policy instead
--     of relying on a separate (fully redundant) admin-read policy.
drop policy if exists "banners_admin_read" on public.banners;
drop policy if exists "banners_public_read" on public.banners;
create policy "banners_read" on public.banners for select
  to anon, authenticated
  using (
    is_admin()
    or (active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()))
  );
drop policy if exists "banners_admin_write" on public.banners;
create policy "banners_admin_insert" on public.banners for insert to authenticated with check (is_admin());
create policy "banners_admin_update" on public.banners for update to authenticated using (is_admin()) with check (is_admin());
create policy "banners_admin_delete" on public.banners for delete to authenticated using (is_admin());

-- 11. settings: same pattern -- admin needs to see all keys, not just the
--     three public ones, so fold admin visibility into a single read policy.
drop policy if exists "public reads customer settings" on public.settings;
create policy "settings_read" on public.settings for select
  to anon, authenticated
  using (
    is_admin()
    or key = any (array['cod_deposit_threshold_egp','service_fee_percent','sms_login_enabled'])
  );
drop policy if exists "admin manages settings" on public.settings;
create policy "settings_admin_insert" on public.settings for insert to authenticated with check (is_admin());
create policy "settings_admin_update" on public.settings for update to authenticated using (is_admin()) with check (is_admin());
create policy "settings_admin_delete" on public.settings for delete to authenticated using (is_admin());
