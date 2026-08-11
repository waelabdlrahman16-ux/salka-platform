-- The vendor menu editor shares the catalog delete action. Keep the historical
-- order guard, but allow a vendor to delete an unused item belonging to their
-- own restaurant. The public wrapper remains service-role-only and forwards
-- the authenticated user's id before this function evaluates ownership.

create or replace function private.admin_delete_menu_item(p_item_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_restaurant_id integer;
begin
  select restaurant_id into v_restaurant_id
  from menu_items
  where id = p_item_id;

  if v_restaurant_id is null then
    raise exception 'item_not_found';
  end if;

  if not (
    is_admin()
    or is_catalog_manager()
    or v_restaurant_id = my_restaurant_id()
  ) then
    raise exception 'not_authorized';
  end if;

  if exists (select 1 from order_items where menu_item_id = p_item_id) then
    raise exception 'item_has_order_history';
  end if;

  delete from menu_items where id = p_item_id;
end;
$function$;

revoke all on function private.admin_delete_menu_item(integer)
from public, anon, authenticated;

-- Vendor menu photos use an ownership-bearing second path segment:
--   menu-items/{restaurant_id}/...
--   addon-library/{restaurant_id}/...
--   menu-addon-options/{restaurant_id}/...
-- Catalog managers and admins keep their existing policies. Vendors may only
-- create objects inside the directory for the restaurant attached to their
-- authenticated profile. Uploads use unique keys and never upsert.
drop policy if exists "vendor writes own vendor-assets" on storage.objects;
create policy "vendor writes own vendor-assets"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'vendor-assets'
  and case
    when name ~ '^(menu-items|addon-library|menu-addon-options)/[0-9]+/'
      then split_part(name, '/', 2)::integer = my_restaurant_id()
    else false
  end
);
