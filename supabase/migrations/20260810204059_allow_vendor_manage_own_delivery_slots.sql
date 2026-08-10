-- Vendors could not manage their own restaurant's delivery-slot windows at
-- all -- only admins could insert/update delivery_slots rows. Extends both
-- policies to also allow a vendor to write slots for their own restaurant.
-- Whether a restaurant uses slots at all (restaurants.uses_delivery_slots)
-- stays admin-only via setVendorSlots -- that's closer to a contract term
-- than day-to-day slot-time/capacity management.
drop policy if exists "manage slots insert" on public.delivery_slots;
create policy "manage slots insert" on public.delivery_slots for insert
  with check (is_admin() or restaurant_id = my_restaurant_id());

drop policy if exists "manage slots update" on public.delivery_slots;
create policy "manage slots update" on public.delivery_slots for update
  using (is_admin() or restaurant_id = my_restaurant_id())
  with check (is_admin() or restaurant_id = my_restaurant_id());
