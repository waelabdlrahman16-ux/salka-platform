-- Security audit finding H1/M1: ~65 policies across ~25 tables were left at
-- the default `public` role (which includes anon) while their USING/WITH
-- CHECK clause calls is_admin()/my_driver_id()/is_catalog_manager()/
-- is_supervisor()/supervisor_may_touch_order() -- functions anon has never
-- had execute on (deliberately, since the 2026-08-08 hardening batch).
-- Postgres checks function-call permissions for everything a policy clause
-- references at plan time, not lazily per row, so any anon request to these
-- tables gets a hard "permission denied for function is_admin" instead of a
-- clean empty/denied result. This is the exact bug that broke public
-- banner reads for a week (fixed in 20260814123220) -- turns out it was
-- never isolated to banners, just dormant everywhere else because the
-- frontend doesn't currently query these tables anonymously.
--
-- None of these policies were ever meant to allow anon at all (they're all
-- staff-only: admin/driver/vendor/supervisor/catalog-manager reads and
-- writes), so the fix is simply scoping each to `authenticated` explicitly
-- rather than leaving the implicit `public`. ALTER POLICY ... TO ... changes
-- only the role list; the USING/WITH CHECK logic is untouched.
--
-- Read policies with qual=true (no function call) on menu_items, compounds,
-- discounts, restaurants, etc. are deliberately left alone -- anon evaluating
-- a bare `true` is exactly the public catalogue read they're for.

alter policy "app_events_admin_read" on public.app_events to authenticated;
alter policy "admin manages complaints" on public.complaints to authenticated;
alter policy "manage compounds delete" on public.compounds to authenticated;
alter policy "manage compounds insert" on public.compounds to authenticated;
alter policy "manage compounds update" on public.compounds to authenticated;
alter policy "admin manages wallets" on public.customer_wallets to authenticated;
alter policy "admin creates assignments" on public.delivery_assignments to authenticated;
alter policy "admin updates assignments" on public.delivery_assignments to authenticated;
alter policy "read assignments" on public.delivery_assignments to authenticated;
alter policy "manage slots delete" on public.delivery_slots to authenticated;
alter policy "manage slots insert" on public.delivery_slots to authenticated;
alter policy "manage slots update" on public.delivery_slots to authenticated;
alter policy "manage discounts delete" on public.discounts to authenticated;
alter policy "manage discounts insert" on public.discounts to authenticated;
alter policy "manage discounts update" on public.discounts to authenticated;
alter policy "admin creates earnings" on public.driver_earnings to authenticated;
alter policy "read earnings" on public.driver_earnings to authenticated;
alter policy "manage settlements delete" on public.driver_settlements to authenticated;
alter policy "manage settlements insert" on public.driver_settlements to authenticated;
alter policy "manage settlements update" on public.driver_settlements to authenticated;
alter policy "read settlements" on public.driver_settlements to authenticated;
alter policy "read tips" on public.driver_tips to authenticated;
alter policy "admin creates drivers" on public.drivers to authenticated;
alter policy "admin manages drivers" on public.drivers to authenticated;
alter policy "read drivers" on public.drivers to authenticated;
alter policy "manage categories delete" on public.menu_categories to authenticated;
alter policy "manage categories insert" on public.menu_categories to authenticated;
alter policy "manage categories update" on public.menu_categories to authenticated;
alter policy "manage addon groups delete" on public.menu_item_addon_groups to authenticated;
alter policy "manage addon groups insert" on public.menu_item_addon_groups to authenticated;
alter policy "manage addon groups update" on public.menu_item_addon_groups to authenticated;
alter policy "manage addons delete" on public.menu_item_addons to authenticated;
alter policy "manage addons insert" on public.menu_item_addons to authenticated;
alter policy "manage addons update" on public.menu_item_addons to authenticated;
alter policy "manage combos delete" on public.menu_item_combos to authenticated;
alter policy "manage combos insert" on public.menu_item_combos to authenticated;
alter policy "manage combos update" on public.menu_item_combos to authenticated;
alter policy "manage sizes delete" on public.menu_item_sizes to authenticated;
alter policy "manage sizes insert" on public.menu_item_sizes to authenticated;
alter policy "manage sizes update" on public.menu_item_sizes to authenticated;
alter policy "manage menu delete" on public.menu_items to authenticated;
alter policy "manage menu insert" on public.menu_items to authenticated;
alter policy "manage menu update" on public.menu_items to authenticated;
alter policy "read order items" on public.order_items to authenticated;
alter policy "admin reads ratings" on public.order_ratings to authenticated;
alter policy "admin updates orders" on public.orders to authenticated;
alter policy "read orders" on public.orders to authenticated;
alter policy "manage regions delete" on public.regions to authenticated;
alter policy "manage regions insert" on public.regions to authenticated;
alter policy "manage regions update" on public.regions to authenticated;
alter policy "manage restaurants delete" on public.restaurants to authenticated;
alter policy "manage restaurants insert" on public.restaurants to authenticated;
alter policy "manage restaurants update" on public.restaurants to authenticated;
alter policy "admin updates requests" on public.settlement_requests to authenticated;
alter policy "driver creates request" on public.settlement_requests to authenticated;
alter policy "read own requests" on public.settlement_requests to authenticated;
alter policy "manage swap requests delete" on public.shift_swap_requests to authenticated;
alter policy "manage swap requests insert" on public.shift_swap_requests to authenticated;
alter policy "manage swap requests update" on public.shift_swap_requests to authenticated;
alter policy "manage shifts delete" on public.shifts to authenticated;
alter policy "manage shifts insert" on public.shifts to authenticated;
alter policy "manage shifts update" on public.shifts to authenticated;
alter policy "read shifts" on public.shifts to authenticated;
alter policy "manage addon library delete" on public.vendor_addon_library to authenticated;
alter policy "manage addon library insert" on public.vendor_addon_library to authenticated;
alter policy "manage addon library update" on public.vendor_addon_library to authenticated;
alter policy "manage coverage delete" on public.vendor_coverage to authenticated;
alter policy "manage coverage insert" on public.vendor_coverage to authenticated;
alter policy "manage coverage update" on public.vendor_coverage to authenticated;
alter policy "admin manages wallet tx" on public.wallet_transactions to authenticated;
