-- ============================================================
-- Talah Platform - Launch increment
-- Prep times, dispatch clock, supermarket slots, settings
-- Run ONCE in Supabase SQL Editor, after ops.sql
-- ============================================================

-- 1. Vendor type + preparation time
alter table restaurants add column if not exists vendor_type text default 'restaurant';
alter table restaurants add column if not exists prep_minutes int default 20;

-- 2. Platform settings (editable from /admin)
create table if not exists settings (
  key text primary key,
  value text not null,
  label text default ''
);
alter table settings enable row level security;
drop policy if exists "public read settings" on settings;
create policy "public read settings" on settings for select using (true);
drop policy if exists "admin writes settings" on settings;
create policy "admin writes settings" on settings for all
  using (is_admin()) with check (is_admin());

insert into settings (key, value, label) values
  ('travel_buffer_minutes', '10', 'وقت وصول المندوب للمطعم (دقيقة)'),
  ('slot_cutoff_minutes', '60', 'إقفال الحجز قبل بداية الفترة (دقيقة)'),
  ('escalate_after_minutes', '15', 'تنبيه الإدارة لو محدش استلم الطلب (دقيقة)'),
  ('delivery_fee', '50', 'رسوم التوصيل (ج.م)')
on conflict (key) do nothing;

-- 3. Delivery slots (supermarkets and anyone scheduling)
create table if not exists delivery_slots (
  id serial primary key,
  restaurant_id int references restaurants(id) on delete cascade,
  start_time time not null,
  end_time time not null,
  capacity int not null default 6,
  active boolean default true
);
alter table delivery_slots enable row level security;
drop policy if exists "public read slots" on delivery_slots;
create policy "public read slots" on delivery_slots for select using (true);
drop policy if exists "admin writes slots" on delivery_slots;
create policy "admin writes slots" on delivery_slots for all
  using (is_admin()) with check (is_admin());

-- 4. The dispatch clock - one field drives the driver pool
alter table orders add column if not exists dispatch_at timestamptz;
alter table orders add column if not exists slot_id int references delivery_slots(id);
alter table orders add column if not exists scheduled_date date;
alter table orders add column if not exists ready_at timestamptz;

-- 5. Slot availability for the customer (respects capacity and cutoff)
create or replace function open_slots(p_restaurant_id int)
returns json language sql security definer stable as $$
  with cutoff as (
    select coalesce((select value::int from settings where key = 'slot_cutoff_minutes'), 60) as m
  )
  select coalesce(json_agg(row_to_json(x)), '[]'::json) from (
    select s.id, s.start_time, s.end_time, s.capacity, d.day as scheduled_date,
           s.capacity - (
             select count(*) from orders o
             where o.slot_id = s.id and o.scheduled_date = d.day
               and o.status <> 'Cancelled'
           ) as remaining
    from delivery_slots s
    cross join (select current_date as day union all select current_date + 1) d
    cross join cutoff c
    where s.restaurant_id = p_restaurant_id and s.active
      and (d.day + s.start_time) > (now() + make_interval(mins => c.m))
    order by d.day, s.start_time
  ) x
  where x.remaining > 0;
$$;

-- 6. Order placement now computes the dispatch clock
create or replace function place_order(
  p_restaurant_id int, p_customer_name text, p_customer_phone text,
  p_zone text, p_unit_number text, p_address_notes text,
  p_delivery_fee numeric, p_items json,
  p_slot_id int default null, p_scheduled_date date default null
) returns json language plpgsql security definer as $$
declare
  v_order_id int; v_token uuid; v_subtotal numeric := 0; v_item json;
  v_prep int; v_buffer int; v_ready timestamptz; v_dispatch timestamptz;
  v_slot delivery_slots%rowtype; v_used int;
begin
  if coalesce(trim(p_customer_name),'') = '' or coalesce(trim(p_customer_phone),'') = ''
     or coalesce(trim(p_zone),'') = '' or coalesce(trim(p_unit_number),'') = '' then
    raise exception 'missing_customer_details';
  end if;

  for v_item in select * from json_array_elements(p_items) loop
    v_subtotal := v_subtotal + ((v_item->>'qty')::int * (v_item->>'unit_price')::numeric);
  end loop;

  select coalesce(prep_minutes, 20) into v_prep from restaurants where id = p_restaurant_id;
  select coalesce((select value::int from settings where key = 'travel_buffer_minutes'), 10)
    into v_buffer;

  if p_slot_id is not null then
    select * into v_slot from delivery_slots where id = p_slot_id for update;
    if not found or not v_slot.active then raise exception 'slot_unavailable'; end if;

    select count(*) into v_used from orders
      where slot_id = p_slot_id and scheduled_date = p_scheduled_date
        and status <> 'Cancelled';
    if v_used >= v_slot.capacity then raise exception 'slot_full'; end if;

    v_ready := (p_scheduled_date + v_slot.start_time)::timestamptz;
    v_dispatch := v_ready - make_interval(mins => v_buffer);
  else
    v_ready := now() + make_interval(mins => v_prep);
    v_dispatch := greatest(now(), v_ready - make_interval(mins => v_buffer));
  end if;

  insert into orders (restaurant_id, customer_name, customer_phone, zone, unit_number,
                      address_notes, subtotal, delivery_fee, total,
                      ready_at, dispatch_at, slot_id, scheduled_date)
  values (p_restaurant_id, trim(p_customer_name), trim(p_customer_phone), p_zone,
          trim(p_unit_number), coalesce(p_address_notes,''), v_subtotal, p_delivery_fee,
          v_subtotal + p_delivery_fee, v_ready, v_dispatch, p_slot_id, p_scheduled_date)
  returning id, public_token into v_order_id, v_token;

  for v_item in select * from json_array_elements(p_items) loop
    insert into order_items (order_id, menu_item_id, name, qty, unit_price, total)
    values (v_order_id, (v_item->>'menu_item_id')::int, v_item->>'name',
            (v_item->>'qty')::int, (v_item->>'unit_price')::numeric,
            (v_item->>'qty')::int * (v_item->>'unit_price')::numeric);
  end loop;

  return json_build_object('id', v_order_id, 'token', v_token,
                           'ready_at', v_ready, 'dispatch_at', v_dispatch);
end; $$;

-- 7. Driver pool respects the dispatch clock
create or replace function available_orders()
returns json language sql security definer stable as $$
  select case when my_driver_id() is null then '[]'::json
    else coalesce((select json_agg(row_to_json(x)) from (
      select o.id, o.total, o.zone, o.kitchen_status, o.created_at,
             o.ready_at, o.dispatch_at, r.name as restaurant_name
      from orders o join restaurants r on r.id = o.restaurant_id
      where o.status = 'pending'
        and coalesce(o.dispatch_at, o.created_at) <= now()
        and not exists (select 1 from delivery_assignments da
          where da.order_id = o.id
            and da.status in ('Offered','Accepted','Picked_Up','Out_for_Delivery','Delivered'))
      order by coalesce(o.ready_at, o.created_at)
    ) x), '[]'::json) end;
$$;

-- 8. Vendor controls the clock: ready early, or running late
create or replace function vendor_ready(p_order_id int)
returns void language plpgsql security definer as $$
begin
  if not exists (select 1 from orders where id = p_order_id
                 and restaurant_id = my_restaurant_id()) then
    raise exception 'not_your_order';
  end if;
  update orders set kitchen_status = 'ready', ready_at = now(), dispatch_at = now()
  where id = p_order_id;
end; $$;

create or replace function vendor_delay(p_order_id int, p_minutes int default 10)
returns void language plpgsql security definer as $$
begin
  if not exists (select 1 from orders where id = p_order_id
                 and restaurant_id = my_restaurant_id()) then
    raise exception 'not_your_order';
  end if;
  update orders
  set ready_at = coalesce(ready_at, now()) + make_interval(mins => p_minutes),
      dispatch_at = coalesce(dispatch_at, now()) + make_interval(mins => p_minutes)
  where id = p_order_id;
end; $$;

-- 9. Customer recovers their tracking links by phone
create or replace function my_orders(p_phone text)
returns json language sql security definer stable as $$
  select coalesce(json_agg(row_to_json(x)), '[]'::json) from (
    select o.id, o.public_token, o.total, o.status, o.created_at,
           r.name as restaurant_name
    from orders o join restaurants r on r.id = o.restaurant_id
    where regexp_replace(o.customer_phone, '[^0-9]', '', 'g')
        = regexp_replace(p_phone, '[^0-9]', '', 'g')
      and o.created_at > now() - interval '30 days'
    order by o.id desc limit 20
  ) x;
$$;

grant execute on function open_slots(int) to anon, authenticated;
grant execute on function my_orders(text) to anon, authenticated;
grant execute on function vendor_ready(int) to authenticated;
grant execute on function vendor_delay(int, int) to authenticated;
grant execute on function place_order(int,text,text,text,text,text,numeric,json,int,date)
  to anon, authenticated;

-- 10. Backfill existing rows so nothing is stuck
update orders set dispatch_at = created_at where dispatch_at is null;

-- 11. Seed data cleanup: drop the trademarked name
update restaurants set name = 'كافيه تلال', description = 'قهوة ومشروبات وحلويات'
where name = 'ستاربكس السخنة';

-- 12. Sensible starting prep times (edit these in /admin)
update restaurants set prep_minutes = 45 where name like '%أبو ربيع%';
update restaurants set prep_minutes = 35 where name like '%الحسيني%';
update restaurants set prep_minutes = 25 where name like '%بورتوفينو%';
update restaurants set prep_minutes = 10 where name like '%كافيه%';
update restaurants set prep_minutes = 20 where name like '%فطاطري%';
