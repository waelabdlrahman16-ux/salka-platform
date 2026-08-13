-- Route add-on library writes through the authenticated server action. This
-- keeps the app useful under restrictive RLS while enforcing restaurant scope.

create or replace function private.admin_create_addon_library_item(p_restaurant_id integer,p_name text,p_price numeric,p_image_url text default null)
returns public.vendor_addon_library language plpgsql security definer set search_path to 'public' as $$
declare v_row vendor_addon_library%rowtype;
begin
  if not (is_admin() or is_catalog_manager() or p_restaurant_id = my_restaurant_id()) then raise exception 'not_authorized'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'name_required'; end if;
  if p_price is null or p_price < 0 then raise exception 'invalid_price'; end if;
  insert into vendor_addon_library(restaurant_id,name,price,image_url)
  values(p_restaurant_id,btrim(p_name),p_price,nullif(btrim(coalesce(p_image_url,'')),''))
  returning * into v_row;
  return v_row;
exception when unique_violation then raise exception 'library_item_exists';
end $$;

create or replace function private.admin_update_addon_library_item(p_item_id integer,p_price numeric)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_restaurant_id integer;
begin
  if p_price is null or p_price < 0 then raise exception 'invalid_price'; end if;
  select restaurant_id into v_restaurant_id from vendor_addon_library where id=p_item_id;
  if not found then raise exception 'library_item_not_found'; end if;
  if not (is_admin() or is_catalog_manager() or v_restaurant_id = my_restaurant_id()) then raise exception 'not_authorized'; end if;
  update vendor_addon_library set price=p_price where id=p_item_id;
end $$;

create or replace function private.admin_delete_addon_library_item(p_item_id integer)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_restaurant_id integer;
begin
  select restaurant_id into v_restaurant_id from vendor_addon_library where id=p_item_id;
  if not found then raise exception 'library_item_not_found'; end if;
  if not (is_admin() or is_catalog_manager() or v_restaurant_id = my_restaurant_id()) then raise exception 'not_authorized'; end if;
  delete from vendor_addon_library where id=p_item_id;
end $$;

create or replace function public.admin_create_addon_library_item(p_restaurant_id integer,p_name text,p_price numeric,p_image_url text default null,p_auth_user_id uuid default null)
returns public.vendor_addon_library language plpgsql security definer set search_path to 'public' as $$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_create_addon_library_item(p_restaurant_id,p_name,p_price,p_image_url); end $$;
create or replace function public.admin_update_addon_library_item(p_item_id integer,p_price numeric,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.admin_update_addon_library_item(p_item_id,p_price); end $$;
create or replace function public.admin_delete_addon_library_item(p_item_id integer,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.admin_delete_addon_library_item(p_item_id); end $$;

revoke all on function private.admin_create_addon_library_item(integer,text,numeric,text),private.admin_update_addon_library_item(integer,numeric),private.admin_delete_addon_library_item(integer) from public,anon,authenticated;
revoke all on function public.admin_create_addon_library_item(integer,text,numeric,text,uuid),public.admin_update_addon_library_item(integer,numeric,uuid),public.admin_delete_addon_library_item(integer,uuid) from public,anon,authenticated;
grant execute on function public.admin_create_addon_library_item(integer,text,numeric,text,uuid),public.admin_update_addon_library_item(integer,numeric,uuid),public.admin_delete_addon_library_item(integer,uuid) to service_role;
