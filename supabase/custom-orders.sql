-- ============================================================
-- Salka - Custom Order (pharmacy/supermarket) + Pickup Request
-- (McDonald's/KFC/Pizza Hut style "own system" vendors)
-- Run ONCE in Supabase SQL Editor.
--
-- Does not guess at which specific restaurants are "own system" —
-- vendor_type already tells us pharmacy/supermarket reliably, but
-- there's no reliable existing signal for "own system" vendors, so
-- that stays an admin toggle (see Admin > vendor order_mode selector).
-- ============================================================

-- 1. How a vendor takes orders
alter table restaurants add column if not exists order_mode text not null default 'catalog';
alter table restaurants add constraint restaurants_order_mode_check
  check (order_mode in ('catalog','custom_request','pickup_request'));

-- pharmacy/supermarket are reliably identified by vendor_type already
update restaurants set order_mode = 'custom_request' where vendor_type in ('pharmacy','supermarket');

-- 2. New order shape for both flows
alter table orders add column if not exists order_type text not null default 'catalog';
alter table orders add constraint orders_order_type_check
  check (order_type in ('catalog','custom_request','pickup_request'));

alter table orders add column if not exists request_items jsonb;      -- custom_request: [{name, qty}] suggested-from-catalog lines
alter table orders add column if not exists request_notes text;       -- custom_request free text, or pickup_request instructions
alter table orders add column if not exists pricing_status text not null default 'n/a';
alter table orders add constraint orders_pricing_status_check
  check (pricing_status in ('n/a','pending_quote','confirmed'));

alter table orders add column if not exists payment_mode text;        -- pickup_request only: 'prepaid' | 'driver_pays'
alter table orders add constraint orders_payment_mode_check
  check (payment_mode is null or payment_mode in ('prepaid','driver_pays'));
alter table orders add column if not exists collect_amount numeric;   -- pickup_request/driver_pays: cash driver collects for the vendor

-- 3. Customer submits a pharmacy/supermarket request — no price shown,
--    admin calls to quote afterwards.
create or replace function submit_custom_order(
  p_restaurant_id int, p_customer_name text, p_customer_phone text,
  p_zone text, p_unit_number text, p_address_notes text,
  p_delivery_fee numeric, p_request_items json, p_request_notes text
) returns json language plpgsql security definer as $$
declare
  v_order_id int; v_token uuid; v_prep int; v_buffer int; v_ready timestamptz; v_dispatch timestamptz;
  v_mode text;
begin
  if coalesce(trim(p_customer_name),'') = '' or coalesce(trim(p_customer_phone),'') = ''
     or coalesce(trim(p_zone),'') = '' or coalesce(trim(p_unit_number),'') = '' then
    raise exception 'missing_customer_details';
  end if;

  select order_mode, coalesce(prep_minutes, 20) into v_mode, v_prep
    from restaurants where id = p_restaurant_id;
  if v_mode is distinct from 'custom_request' then raise exception 'not_a_custom_order_vendor'; end if;

  select coalesce((select value::int from settings where key = 'travel_buffer_minutes'), 10) into v_buffer;
  v_ready := now() + make_interval(mins => v_prep);
  v_dispatch := greatest(now(), v_ready - make_interval(mins => v_buffer));

  insert into orders (restaurant_id, customer_name, customer_phone, zone, unit_number,
                      address_notes, subtotal, delivery_fee, total,
                      order_type, request_items, request_notes, pricing_status,
                      ready_at, dispatch_at)
  values (p_restaurant_id, trim(p_customer_name), trim(p_customer_phone), p_zone,
          trim(p_unit_number), coalesce(p_address_notes,''), 0, p_delivery_fee, p_delivery_fee,
          'custom_request', p_request_items, coalesce(p_request_notes,''), 'pending_quote',
          v_ready, v_dispatch)
  returning id, public_token into v_order_id, v_token;

  return json_build_object('id', v_order_id, 'token', v_token);
end; $$;

-- 4. Customer requests a driver for an order placed directly with a
--    "own system" vendor (McDonald's/KFC/Pizza Hut and future vendors
--    flagged the same way).
create or replace function request_pickup(
  p_restaurant_id int, p_customer_name text, p_customer_phone text,
  p_zone text, p_unit_number text, p_address_notes text,
  p_delivery_fee numeric, p_payment_mode text, p_collect_amount numeric,
  p_request_notes text
) returns json language plpgsql security definer as $$
declare
  v_order_id int; v_token uuid; v_prep int; v_buffer int; v_ready timestamptz; v_dispatch timestamptz;
  v_mode text; v_total numeric;
begin
  if coalesce(trim(p_customer_name),'') = '' or coalesce(trim(p_customer_phone),'') = ''
     or coalesce(trim(p_zone),'') = '' or coalesce(trim(p_unit_number),'') = '' then
    raise exception 'missing_customer_details';
  end if;
  if p_payment_mode not in ('prepaid','driver_pays') then raise exception 'invalid_payment_mode'; end if;
  if p_payment_mode = 'driver_pays' and coalesce(p_collect_amount, 0) <= 0 then
    raise exception 'collect_amount_required';
  end if;

  select order_mode, coalesce(prep_minutes, 10) into v_mode, v_prep
    from restaurants where id = p_restaurant_id;
  if v_mode is distinct from 'pickup_request' then raise exception 'not_a_pickup_vendor'; end if;

  select coalesce((select value::int from settings where key = 'travel_buffer_minutes'), 10) into v_buffer;
  v_ready := now() + make_interval(mins => v_prep);
  v_dispatch := greatest(now(), v_ready - make_interval(mins => v_buffer));
  v_total := p_delivery_fee + (case when p_payment_mode = 'driver_pays' then p_collect_amount else 0 end);

  insert into orders (restaurant_id, customer_name, customer_phone, zone, unit_number,
                      address_notes, subtotal, delivery_fee, total,
                      order_type, request_notes, pricing_status,
                      payment_mode, collect_amount, ready_at, dispatch_at)
  values (p_restaurant_id, trim(p_customer_name), trim(p_customer_phone), p_zone,
          trim(p_unit_number), coalesce(p_address_notes,''),
          coalesce(p_collect_amount, 0), p_delivery_fee, v_total,
          'pickup_request', coalesce(p_request_notes,''), 'n/a',
          p_payment_mode, p_collect_amount, v_ready, v_dispatch)
  returning id, public_token into v_order_id, v_token;

  return json_build_object('id', v_order_id, 'token', v_token);
end; $$;

-- 5. Admin confirms the phone-quoted price for a custom_request order
create or replace function confirm_custom_order_price(p_order_id int, p_subtotal numeric)
returns void language plpgsql security definer as $$
begin
  if not is_admin() then raise exception 'not_authorized'; end if;
  update orders set subtotal = p_subtotal, total = p_subtotal + delivery_fee, pricing_status = 'confirmed'
  where id = p_order_id and order_type = 'custom_request';
end; $$;

-- 6. Surface the new fields to the tracking page and customer order history
create or replace function track_order(p_token uuid)
returns json language sql security definer stable as $$
  select json_build_object(
    'order', (select row_to_json(o) from (
        select o.id, o.status, o.subtotal, o.delivery_fee, o.total,
               o.zone, o.unit_number, o.address_notes,
               o.ready_at, o.scheduled_date,
               o.order_type, o.request_items, o.request_notes, o.pricing_status,
               o.payment_mode, o.collect_amount,
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

grant execute on function submit_custom_order(int,text,text,text,text,text,numeric,json,text) to anon, authenticated;
grant execute on function request_pickup(int,text,text,text,text,text,numeric,text,numeric,text) to anon, authenticated;
grant execute on function confirm_custom_order_price(int,numeric) to authenticated;
grant execute on function track_order(uuid) to anon, authenticated;
