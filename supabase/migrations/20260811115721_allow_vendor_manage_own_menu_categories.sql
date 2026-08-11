-- Reconciled from production migration history. Already applied in project pqpnwxyevrsipklzmwex.
-- Do not apply this file to production again.

create or replace function private.admin_add_menu_category(p_restaurant_id integer, p_name text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_name text := btrim(p_name); v_id int;
begin
  if not (is_admin() or is_catalog_manager() or p_restaurant_id = my_restaurant_id()) then raise exception 'not_authorized'; end if;
  if coalesce(v_name,'') = '' then raise exception 'name_required'; end if;
  if exists (select 1 from menu_categories
              where restaurant_id = p_restaurant_id and lower(btrim(name)) = lower(v_name)) then
    raise exception 'category_exists';
  end if;
  insert into menu_categories (restaurant_id, name, display_order)
  values (p_restaurant_id, v_name,
          coalesce((select max(display_order)+1 from menu_categories where restaurant_id = p_restaurant_id), 1))
  returning id into v_id;
  return v_id;
end $function$;
create or replace function private.admin_delete_menu_category(p_restaurant_id integer, p_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n int;
begin
  if not (is_admin() or is_catalog_manager() or p_restaurant_id = my_restaurant_id()) then raise exception 'not_authorized'; end if;
  select count(*) into v_n from menu_items
   where restaurant_id = p_restaurant_id and lower(btrim(category)) = lower(btrim(p_name));
  if v_n > 0 then raise exception 'category_not_empty:%', v_n; end if;
  delete from menu_categories
   where restaurant_id = p_restaurant_id and lower(btrim(name)) = lower(btrim(p_name));
end $function$;

create or replace function private.admin_rename_menu_category(p_restaurant_id integer, p_old text, p_new text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_new text := btrim(p_new);
begin
  if not (is_admin() or is_catalog_manager() or p_restaurant_id = my_restaurant_id()) then raise exception 'not_authorized'; end if;
  if coalesce(v_new,'') = '' then raise exception 'name_required'; end if;
  if exists (select 1 from menu_categories
              where restaurant_id = p_restaurant_id
                and lower(btrim(name)) = lower(v_new)
                and lower(btrim(name)) <> lower(btrim(p_old))) then
    raise exception 'category_exists';
  end if;

  update menu_categories set name = v_new
   where restaurant_id = p_restaurant_id and lower(btrim(name)) = lower(btrim(p_old));
  update menu_items set category = v_new
   where restaurant_id = p_restaurant_id and lower(btrim(category)) = lower(btrim(p_old));
end $function$;

create or replace function private.admin_reorder_menu_categories(p_restaurant_id integer, p_names text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (is_admin() or is_catalog_manager() or p_restaurant_id = my_restaurant_id()) then raise exception 'not_authorized'; end if;
  update menu_categories c set display_order = t.ord
    from (select unnest(p_names) as nm, generate_subscripts(p_names,1) as ord) t
   where c.restaurant_id = p_restaurant_id
     and lower(btrim(c.name)) = lower(btrim(t.nm));
end $function$;

create or replace function private.admin_set_vendor_hours(p_restaurant_id integer, p_days jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare d jsonb; v_day int; v_o time; v_c time; v_closed boolean;
begin
  if not (is_admin() or p_restaurant_id = my_restaurant_id()) then raise exception 'admin_only'; end if;
  if not exists (select 1 from restaurants where id = p_restaurant_id and not archived) then
    raise exception 'restaurant_not_found';
  end if;

  delete from vendor_hours where restaurant_id = p_restaurant_id;
  if p_days is null or jsonb_array_length(p_days) = 0 then return; end if;

  for d in select * from jsonb_array_elements(p_days) loop
    v_day    := (d->>'day')::int;
    v_closed := coalesce((d->>'closed')::boolean, false);
    v_o      := nullif(d->>'opens','')::time;
    v_c      := nullif(d->>'closes','')::time;

    if v_day is null or v_day < 0 or v_day > 6 then
      raise exception 'invalid_day';
    end if;
    if not v_closed and ((v_o is null) <> (v_c is null)) then
      raise exception 'hours_incomplete';
    end if;
    if not v_closed and v_o is null then
      continue;
    end if;

    insert into vendor_hours (restaurant_id, day_of_week, opens_at, closes_at, closed)
    values (p_restaurant_id, v_day,
            case when v_closed then null else v_o end,
            case when v_closed then null else v_c end,
            v_closed);
  end loop;
end $function$;
