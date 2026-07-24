-- ============================================================
-- Talah Platform - Auth & Roles increment
-- Run ONCE in Supabase SQL Editor AFTER schema.sql
-- ============================================================

-- 1. Private tracking token on orders (so /track cannot be enumerated)
alter table orders add column if not exists public_token uuid default gen_random_uuid();
create unique index if not exists orders_public_token_idx on orders(public_token);

-- 2. Profiles: links a logged-in user to a role (and to a driver row)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','driver')),
  driver_id int references drivers(id),
  name text default ''
);
alter table profiles enable row level security;
drop policy if exists "read own profile" on profiles;
create policy "read own profile" on profiles for select using (auth.uid() = id);

-- 3. Helper functions
create or replace function is_admin() returns boolean
  language sql security definer stable as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function my_driver_id() returns int
  language sql security definer stable as $$
  select driver_id from profiles where id = auth.uid();
$$;

-- 4. Remove the open pilot policies
drop policy if exists "pilot open" on zones;
drop policy if exists "pilot open" on restaurants;
drop policy if exists "pilot open" on menu_items;
drop policy if exists "pilot open" on chalets;
drop policy if exists "pilot open" on orders;
drop policy if exists "pilot open" on order_items;
drop policy if exists "pilot open" on bookings;
drop policy if exists "pilot open" on drivers;
drop policy if exists "pilot open" on delivery_assignments;
drop policy if exists "pilot open" on driver_earnings;

-- 5. Public catalog: anyone may read (this is the storefront)
create policy "public read" on zones for select using (true);
create policy "public read" on restaurants for select using (true);
create policy "public read" on menu_items for select using (true);
create policy "public read" on chalets for select using (true);

-- 6. Orders: customers create via RPC only; admin + assigned driver may read/update
create policy "staff read orders" on orders for select
  using (is_admin() or exists(
    select 1 from delivery_assignments da
    where da.order_id = orders.id and da.driver_id = my_driver_id()));
create policy "staff update orders" on orders for update
  using (is_admin() or exists(
    select 1 from delivery_assignments da
    where da.order_id = orders.id and da.driver_id = my_driver_id()));

create policy "staff read order items" on order_items for select
  using (is_admin() or exists(
    select 1 from delivery_assignments da
    where da.order_id = order_items.order_id and da.driver_id = my_driver_id()));

-- 7. Bookings: anyone may request, only admin may read
create policy "anyone books" on bookings for insert with check (true);
create policy "admin reads bookings" on bookings for select using (is_admin());

-- 8. Drivers: admin sees all, driver sees only himself
create policy "read drivers" on drivers for select
  using (is_admin() or id = my_driver_id());
create policy "admin manages drivers" on drivers for update using (is_admin());
create policy "driver updates self" on drivers for update using (id = my_driver_id());

-- 9. Assignments: admin assigns, driver acts on his own only
create policy "read assignments" on delivery_assignments for select
  using (is_admin() or driver_id = my_driver_id());
create policy "admin creates assignments" on delivery_assignments for insert
  with check (is_admin());
create policy "act on assignments" on delivery_assignments for update
  using (is_admin() or driver_id = my_driver_id());

-- 10. Earnings: admin sees all, driver sees his own
create policy "read earnings" on driver_earnings for select
  using (is_admin() or driver_id = my_driver_id());
create policy "create earnings" on driver_earnings for insert
  with check (is_admin() or driver_id = my_driver_id());

-- 11. Customer order placement (no login) - RPC returns the private token
create or replace function place_order(
  p_restaurant_id int, p_customer_name text, p_customer_phone text,
  p_zone text, p_unit_number text, p_address_notes text,
  p_delivery_fee numeric, p_items json
) returns json language plpgsql security definer as $$
declare
  v_order_id int; v_token uuid; v_subtotal numeric := 0; v_item json;
begin
  if coalesce(trim(p_customer_name),'') = '' or coalesce(trim(p_customer_phone),'') = ''
     or coalesce(trim(p_zone),'') = '' or coalesce(trim(p_unit_number),'') = '' then
    raise exception 'missing_customer_details';
  end if;

  for v_item in select * from json_array_elements(p_items) loop
    v_subtotal := v_subtotal + ((v_item->>'qty')::int * (v_item->>'unit_price')::numeric);
  end loop;

  insert into orders (restaurant_id, customer_name, customer_phone, zone, unit_number,
                      address_notes, subtotal, delivery_fee, total)
  values (p_restaurant_id, trim(p_customer_name), trim(p_customer_phone), p_zone,
          trim(p_unit_number), coalesce(p_address_notes,''), v_subtotal, p_delivery_fee,
          v_subtotal + p_delivery_fee)
  returning id, public_token into v_order_id, v_token;

  for v_item in select * from json_array_elements(p_items) loop
    insert into order_items (order_id, menu_item_id, name, qty, unit_price, total)
    values (v_order_id, (v_item->>'menu_item_id')::int, v_item->>'name',
            (v_item->>'qty')::int, (v_item->>'unit_price')::numeric,
            (v_item->>'qty')::int * (v_item->>'unit_price')::numeric);
  end loop;

  return json_build_object('id', v_order_id, 'token', v_token);
end; $$;

-- 12. Customer tracking by token (no login, not enumerable)
create or replace function track_order(p_token uuid)
returns json language sql security definer stable as $$
  select json_build_object(
    'order', (select row_to_json(o) from (
        select o.id, o.status, o.subtotal, o.delivery_fee, o.total,
               o.zone, o.unit_number, o.address_notes,
               r.name as restaurant_name
        from orders o left join restaurants r on r.id = o.restaurant_id
        where o.public_token = p_token) o),
    'items', (select coalesce(json_agg(row_to_json(i)), '[]'::json) from (
        select oi.name, oi.qty, oi.total from order_items oi
        where oi.order_id = (select id from orders where public_token = p_token)) i),
    'assignment', (select row_to_json(a) from (
        select da.status, d.name as driver_name, d.phone as driver_phone
        from delivery_assignments da left join drivers d on d.id = da.driver_id
        where da.order_id = (select id from orders where public_token = p_token)
          and da.status not in ('Rejected','Failed','Cancelled')
        order by da.attempt_number desc limit 1) a)
  );
$$;

grant execute on function place_order(int,text,text,text,text,text,numeric,json) to anon, authenticated;
grant execute on function track_order(uuid) to anon, authenticated;

-- ============================================================
-- AFTER running this: create users in Authentication > Users,
-- then run supabase/link-users.sql to give them roles.
-- ============================================================
