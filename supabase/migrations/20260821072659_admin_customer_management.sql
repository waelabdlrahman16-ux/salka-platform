-- Admin-only customer management. Saved-profile changes deliberately do not
-- rewrite historic orders; updating an active order is a separate, explicit
-- operation so an address correction cannot silently change delivery work.

create or replace function private.admin_customer_management(p_phone text)
returns json language plpgsql security definer set search_path = public as $f$
declare v_phone text := normalize_phone(p_phone); v_customer_id integer;
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  select id into v_customer_id from customers where phone = v_phone;
  return json_build_object(
    'customer_id', v_customer_id,
    'addresses', coalesce((
      select json_agg(json_build_object(
        'id', a.id, 'label', a.label, 'compound_id', a.compound_id,
        'compound_name', co.name, 'unit_number', a.unit_number,
        'notes', a.notes, 'is_default', a.is_default
      ) order by a.is_default desc, a.id desc)
      from customer_addresses a join compounds co on co.id = a.compound_id
      where a.customer_id = v_customer_id
    ), '[]'::json)
  );
end $f$;

create or replace function private.admin_update_customer_future(p_phone text, p_name text)
returns void language plpgsql security definer set search_path = public as $f$
declare v_phone text := normalize_phone(p_phone); v_name text := nullif(trim(p_name), '');
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  if v_phone is null or length(v_phone) < 8 then raise exception 'invalid_phone'; end if;
  if v_name is null or length(v_name) > 60 then raise exception 'invalid_name'; end if;
  insert into customers(phone, name) values (v_phone, v_name)
  on conflict (phone) do update set name = excluded.name;
end $f$;

create or replace function private.admin_update_customer_address(
  p_phone text, p_address_id integer, p_label text, p_compound_id integer, p_unit_number text, p_notes text
) returns void language plpgsql security definer set search_path = public as $f$
declare v_phone text := normalize_phone(p_phone); v_customer_id integer;
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  select id into v_customer_id from customers where phone = v_phone;
  if v_customer_id is null then raise exception 'customer_not_found'; end if;
  if nullif(trim(p_label), '') is null or length(trim(p_label)) > 60 then raise exception 'invalid_label'; end if;
  if not exists (select 1 from compounds where id=p_compound_id) then raise exception 'compound_not_found'; end if;
  if nullif(trim(p_unit_number), '') is null or length(trim(p_unit_number)) > 120 then raise exception 'unit_number_required'; end if;
  if p_notes is not null and length(trim(p_notes)) > 500 then raise exception 'invalid_notes'; end if;
  update customer_addresses set label=trim(p_label), compound_id=p_compound_id, unit_number=trim(p_unit_number), notes=nullif(trim(coalesce(p_notes,'')), '')
  where id=p_address_id and customer_id=v_customer_id;
  if not found then raise exception 'address_not_found'; end if;
end $f$;

create or replace function private.admin_apply_customer_address_to_order(p_phone text, p_order_id integer, p_address_id integer)
returns void language plpgsql security definer set search_path = public as $f$
declare v_phone text := normalize_phone(p_phone); v_customer_id integer; v_address record;
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  select id into v_customer_id from customers where phone = v_phone;
  select a.*, co.name as compound_name into v_address
    from customer_addresses a join compounds co on co.id=a.compound_id
    where a.id=p_address_id and a.customer_id=v_customer_id;
  if not found then raise exception 'address_not_found'; end if;
  update orders set compound_id=v_address.compound_id, zone=v_address.compound_name,
    unit_number=v_address.unit_number, address_notes=v_address.notes
  where id=p_order_id and normalize_phone(customer_phone)=v_phone
    and coalesce(status,'') not in ('Delivered','Cancelled');
  if not found then raise exception 'order_not_editable'; end if;
end $f$;

revoke all on function private.admin_customer_management(text), private.admin_update_customer_future(text,text), private.admin_update_customer_address(text,integer,text,integer,text,text), private.admin_apply_customer_address_to_order(text,integer,integer) from public, anon, authenticated;

create or replace function public.admin_customer_management(p_phone text, p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path=public as $f$
begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_customer_management(p_phone); end $f$;
create or replace function public.admin_update_customer_future(p_phone text,p_name text,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path=public as $f$
begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.admin_update_customer_future(p_phone,p_name); end $f$;
create or replace function public.admin_update_customer_address(p_phone text,p_address_id integer,p_label text,p_compound_id integer,p_unit_number text,p_notes text,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path=public as $f$
begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.admin_update_customer_address(p_phone,p_address_id,p_label,p_compound_id,p_unit_number,p_notes); end $f$;
create or replace function public.admin_apply_customer_address_to_order(p_phone text,p_order_id integer,p_address_id integer,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path=public as $f$
begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.admin_apply_customer_address_to_order(p_phone,p_order_id,p_address_id); end $f$;

revoke all on function public.admin_customer_management(text,uuid), public.admin_update_customer_future(text,text,uuid), public.admin_update_customer_address(text,integer,text,integer,text,text,uuid), public.admin_apply_customer_address_to_order(text,integer,integer,uuid) from public, anon, authenticated;
grant execute on function public.admin_customer_management(text,uuid), public.admin_update_customer_future(text,text,uuid), public.admin_update_customer_address(text,integer,text,integer,text,text,uuid), public.admin_apply_customer_address_to_order(text,integer,integer,uuid) to service_role;

-- Archive is the normal lifecycle for a vendor with history. Permanent deletion
-- is allowed only for an empty vendor with no attached staff login, preserving
-- accounting records and avoiding an orphaned account.
create or replace function private.admin_delete_empty_restaurant(p_restaurant_id integer)
returns void language plpgsql security definer set search_path = public as $f$
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  if exists (select 1 from orders where restaurant_id=p_restaurant_id) then raise exception 'restaurant_has_orders'; end if;
  if exists (select 1 from profiles where restaurant_id=p_restaurant_id) then raise exception 'restaurant_has_login'; end if;
  delete from restaurants where id=p_restaurant_id;
  if not found then raise exception 'restaurant_not_found'; end if;
end $f$;
revoke all on function private.admin_delete_empty_restaurant(integer) from public, anon, authenticated;
create or replace function public.admin_delete_empty_restaurant(p_restaurant_id integer,p_auth_user_id uuid default null)
returns void language plpgsql security definer set search_path=public as $f$
begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); perform private.admin_delete_empty_restaurant(p_restaurant_id); end $f$;
revoke all on function public.admin_delete_empty_restaurant(integer,uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_empty_restaurant(integer,uuid) to service_role;
