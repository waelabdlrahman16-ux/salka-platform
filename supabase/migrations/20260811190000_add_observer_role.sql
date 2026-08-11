-- Adds a read-only "observer" admin role: someone who can see everything an
-- admin sees in the panel but cannot perform any write action.
--
-- is_admin() itself is left untouched (protected predicate, backs 43 RLS
-- policies and every admin_* write function) so every mutating admin_*
-- function keeps rejecting an observer exactly like any other non-admin --
-- no write path was touched. A new is_admin_read() predicate (role in
-- ('admin','observer')) is swapped in only for the confirmed read-only
-- admin_* report functions (STABLE, no writes in their bodies): admin_customers,
-- admin_customer_detail, admin_funnel, admin_list_accounts, admin_live_deliveries,
-- admin_pending_refunds, admin_stalled_orders, admin_vendors_without_items,
-- admin_daily_report.
--
-- admin_convert_staff_role is widened so an admin can actually assign the
-- role (accounts start as 'catalog' via the admin-accounts edge function,
-- same as the existing catalog->supervisor conversion path).

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['admin','driver','vendor','catalog','supervisor','observer']));

create or replace function public.is_admin_read()
 returns boolean
 language sql stable security definer
 set search_path to 'public'
as $function$
  select exists(select 1 from profiles where id = auth.uid() and role in ('admin','observer'));
$function$;

create or replace function private.admin_customers()
 returns json
 language plpgsql stable security definer
 set search_path to 'public'
as $function$
begin
  if not is_admin_read() then raise exception 'admin_only'; end if;
  return coalesce((
    select json_agg(row_to_json(x)) from (
      with from_orders as (
        select normalize_phone(o.customer_phone)                             as ph,
               (array_agg(o.customer_name order by o.created_at desc))[1]    as nm,
               count(*)                                                      as orders_all,
               count(*) filter (where o.status = 'Delivered')                as delivered,
               count(*) filter (where o.status = 'Cancelled')                as cancelled,
               count(*) filter (where o.refund_status = 'pending')           as refunds_due,
               coalesce(sum(o.total) filter (where o.status = 'Delivered'), 0) as spend,
               min(o.created_at)                                             as first_at,
               max(o.created_at)                                             as last_at,
               (array_agg(o.zone          order by o.created_at desc))[1]    as last_zone,
               (array_agg(o.unit_number   order by o.created_at desc))[1]    as last_unit,
               (array_agg(o.payment_method order by o.created_at desc))[1]   as last_payment
          from orders o
         where coalesce(o.customer_phone, '') <> ''
         group by 1
      ),
      from_accounts as (
        select normalize_phone(c.phone) as ph,
               (array_agg(c.name  order by c.created_at desc))[1] as nm,
               (array_agg(c.email order by c.created_at desc))[1] as email,
               min(c.created_at) as signed_up_at
          from customers c
         where coalesce(c.phone, '') <> ''
         group by 1
      ),
      merged as (
        select coalesce(o.ph, a.ph)  as ph,
               coalesce(o.nm, a.nm)  as display_name,
               o.orders_all, o.delivered, o.cancelled, o.refunds_due, o.spend,
               o.first_at, o.last_at, o.last_zone, o.last_unit, o.last_payment,
               a.email, a.signed_up_at
          from from_orders o
          full join from_accounts a on a.ph = o.ph
      )
      select m.display_name                                as name,
             m.ph                                          as phone,
             m.email,
             coalesce(m.orders_all, 0)                     as orders_all,
             coalesce(m.delivered, 0)                      as delivered,
             coalesce(m.cancelled, 0)                      as cancelled,
             coalesce(m.refunds_due, 0)                    as refunds_due,
             coalesce(m.spend, 0)                          as spend,
             case when coalesce(m.delivered, 0) > 0
                  then round(m.spend / m.delivered) else 0 end as avg_order,
             m.last_zone, m.last_unit, m.last_payment,
             m.first_at, m.last_at, m.signed_up_at,
             case when m.last_at is null then null
                  else (current_date - m.last_at::date) end as days_quiet,
             coalesce(w.balance, 0)                        as wallet,
             (b.phone is not null)                         as banned,
             b.reason                                      as ban_reason,
             b.banned_at,
             (select count(*) from complaints cx
                join orders o2 on o2.id = cx.order_id
               where normalize_phone(o2.customer_phone) = m.ph) as complaints,
             (select round(avg(r.driver_rating), 1) from order_ratings r
                join orders o3 on o3.id = r.order_id
               where normalize_phone(o3.customer_phone) = m.ph
                 and r.driver_rating is not null)          as avg_rating_given,
             (select rs.name from orders o4
                join restaurants rs on rs.id = o4.restaurant_id
               where normalize_phone(o4.customer_phone) = m.ph
                 and o4.status = 'Delivered'
               group by rs.name order by count(*) desc, rs.name limit 1) as favourite_vendor
        from merged m
        left join customer_wallets w on normalize_phone(w.phone) = m.ph
        left join banned_customers b on b.phone = m.ph
       order by coalesce(m.spend, 0) desc, coalesce(m.delivered, 0) desc, m.ph
    ) x
  ), '[]'::json);
end $function$;

create or replace function private.admin_customer_detail(p_phone text)
 returns json
 language plpgsql stable security definer
 set search_path to 'public'
as $function$
declare v_ph text;
begin
  if not is_admin_read() then raise exception 'admin_only'; end if;
  v_ph := normalize_phone(p_phone);
  return json_build_object(
    'phone', v_ph,
    'orders', coalesce((
      select json_agg(row_to_json(y)) from (
        select o.id, o.created_at, o.status, o.total, o.delivery_fee, o.service_fee,
               o.payment_method, o.zone, o.unit_number, o.cancel_reason,
               o.refund_status, o.order_type,
               o.customer_note, o.address_notes, o.request_notes,
               r.name as vendor_name,
               d.name as driver_name,
               (select string_agg(oi.name || ' ×' || oi.qty, ' · ' order by oi.id)
                  from order_items oi where oi.order_id = o.id) as items,
               (select json_build_object('driver', rt.driver_rating,
                                         'restaurant', rt.restaurant_rating,
                                         'comment', rt.comment)
                  from order_ratings rt where rt.order_id = o.id limit 1) as rating
          from orders o
          left join restaurants r on r.id = o.restaurant_id
          left join delivery_assignments da
                 on da.order_id = o.id and da.status = 'Delivered'
          left join drivers d on d.id = da.driver_id
         where normalize_phone(o.customer_phone) = v_ph
         order by o.created_at desc
      ) y
    ), '[]'::json),
    'complaints', coalesce((
      select json_agg(row_to_json(z)) from (
        select cx.id, cx.order_id, cx.category, cx.description, cx.status, cx.created_at
          from complaints cx
          join orders o2 on o2.id = cx.order_id
         where normalize_phone(o2.customer_phone) = v_ph
         order by cx.created_at desc
      ) z
    ), '[]'::json)
  );
end $function$;

create or replace function private.admin_funnel(p_days integer default 7)
 returns json
 language plpgsql stable security definer
 set search_path to 'public'
as $function$
declare
  v_res json;
  v_requested_since timestamptz;
  v_since timestamptz;
begin
  if not (is_admin_read() or is_supervisor()) then raise exception 'admin_only'; end if;
  v_requested_since := now() - make_interval(days => greatest(coalesce(p_days, 7), 1));
  select greatest(v_requested_since, coalesce(min(created_at), now()))
  into v_since from app_events where event = 'vendor_opened' and props ? 'is_open';
  with scoped as (
    select e.*,
           bool_or(coalesce(e.props->>'fbclid', '') <> '') over (partition by e.device_id) as paid,
           bool_or(coalesce(e.props->>'in_app', '') = 'true') over (partition by e.device_id) as in_app
    from app_events e where e.created_at >= v_since and nullif(e.device_id, '') is not null
  ),
  devices as (
    select device_id, bool_or(paid) paid, bool_or(in_app) in_app from scoped group by device_id
  ),
  progression as (
    select d.device_id, d.paid, d.in_app, a.at as arrival_at, p.at as place_at, v.at as vendor_at,
           i.at as item_at, c.at as checkout_at, o.at as order_at
    from devices d
    left join lateral (select min(created_at) at from scoped where device_id = d.device_id and event = 'arrival') a on true
    left join lateral (select min(created_at) at from scoped where device_id = d.device_id and event = 'place_chosen' and created_at >= a.at) p on true
    left join lateral (select min(created_at) at from scoped where device_id = d.device_id and event = 'vendor_opened' and props->>'is_open' = 'true' and created_at >= p.at) v on true
    left join lateral (select min(created_at) at from scoped where device_id = d.device_id and event = 'item_added' and created_at >= v.at) i on true
    left join lateral (select min(created_at) at from scoped where device_id = d.device_id and event = 'checkout_started' and created_at >= i.at) c on true
    left join lateral (select min(created_at) at from scoped where device_id = d.device_id and event = 'order_placed' and created_at >= c.at) o on true
  ),
  funnel_rows as (
    select 1 ord, 'arrival'::text event, device_id, arrival_at at, paid, in_app from progression
    union all select 2, 'place_chosen', device_id, place_at, paid, in_app from progression
    union all select 3, 'vendor_opened', device_id, vendor_at, paid, in_app from progression
    union all select 4, 'item_added', device_id, item_at, paid, in_app from progression
    union all select 5, 'checkout_started', device_id, checkout_at, paid, in_app from progression
    union all select 6, 'order_placed', device_id, order_at, paid, in_app from progression
  ),
  vendor_devices as (
    select distinct restaurant_id, device_id from scoped where restaurant_id is not null
  ),
  vendor_progression as (
    select vd.restaurant_id, vd.device_id, vo.at open_at, vc.at closed_at, vi.at item_at,
           co.at customization_opened_at, ca.at customization_abandoned_at, cb.at checkout_blocked_at, oo.at order_at
    from vendor_devices vd
    left join lateral (select min(created_at) at from scoped where restaurant_id = vd.restaurant_id and device_id = vd.device_id and event = 'vendor_opened' and props->>'is_open' = 'true') vo on true
    left join lateral (select min(created_at) at from scoped where restaurant_id = vd.restaurant_id and device_id = vd.device_id and event = 'vendor_opened' and props->>'is_open' = 'false') vc on true
    left join lateral (select min(created_at) at from scoped where restaurant_id = vd.restaurant_id and device_id = vd.device_id and event = 'item_added' and created_at >= vo.at) vi on true
    left join lateral (select min(created_at) at from scoped where restaurant_id = vd.restaurant_id and device_id = vd.device_id and event = 'customization_opened' and created_at >= vo.at) co on true
    left join lateral (select min(created_at) at from scoped where restaurant_id = vd.restaurant_id and device_id = vd.device_id and event = 'customization_abandoned' and created_at >= co.at) ca on true
    left join lateral (select min(created_at) at from scoped where restaurant_id = vd.restaurant_id and device_id = vd.device_id and event = 'checkout_blocked' and created_at >= vo.at) cb on true
    left join lateral (select min(created_at) at from scoped where restaurant_id = vd.restaurant_id and device_id = vd.device_id and event = 'order_placed' and created_at >= vo.at) oo on true
  ),
  vendor_rows as (
    select r.id restaurant_id, r.name,
      count(*) filter (where vp.open_at is not null) open_devices,
      count(*) filter (where vp.closed_at is not null) closed_browsers,
      count(*) filter (where vp.item_at is not null) item_devices,
      count(*) filter (where vp.customization_opened_at is not null) customization_opened,
      count(*) filter (where vp.customization_abandoned_at is not null) customization_abandoned,
      count(*) filter (where vp.checkout_blocked_at is not null) checkout_blocked,
      count(*) filter (where vp.order_at is not null) order_devices
    from restaurants r join vendor_progression vp on vp.restaurant_id = r.id
    group by r.id, r.name
  )
  select json_build_object(
    'since', v_since, 'requested_since', v_requested_since, 'days', greatest(coalesce(p_days, 7), 1),
    'funnel', (select coalesce(json_agg(row_to_json(x) order by x.ord), '[]'::json) from (
        select ord, event, count(distinct device_id) filter (where at is not null) devices,
               count(distinct device_id) filter (where at is not null and paid) paid_devices,
               count(distinct device_id) filter (where at is not null and in_app) in_app_devices
        from funnel_rows group by ord, event) x),
    'totals', (select json_build_object('devices', count(distinct device_id), 'paid_devices', count(distinct device_id) filter (where paid),
        'in_app_devices', count(distinct device_id) filter (where in_app), 'events', count(*)) from scoped),
    'closed_browsers', (select count(distinct device_id) from scoped where event = 'vendor_opened' and props->>'is_open' = 'false'),
    'vendors', (select coalesce(json_agg(row_to_json(v) order by v.open_devices desc, v.name), '[]'::json) from vendor_rows v),
    'checkout_blocks', (select coalesce(json_agg(row_to_json(b) order by b.events desc, b.reason), '[]'::json) from (
        select coalesce(props->>'reason', 'unknown') reason, count(*) events, count(distinct device_id) devices
        from scoped where event = 'checkout_blocked' group by coalesce(props->>'reason', 'unknown')) b)
  ) into v_res;
  return v_res;
end
$function$;

create or replace function private.admin_list_accounts()
 returns json
 language sql stable security definer
 set search_path to 'public'
as $function$
  select json_build_object(
    'vendors', (select coalesce(json_agg(row_to_json(v)), '[]'::json) from (
      select p.id as profile_id, p.restaurant_id, u.email
      from profiles p join auth.users u on u.id = p.id
      where p.role = 'vendor'
    ) v),
    'drivers', (select coalesce(json_agg(row_to_json(d)), '[]'::json) from (
      select p.id as profile_id, p.driver_id, u.email
      from profiles p join auth.users u on u.id = p.id
      where p.role = 'driver'
    ) d),
    'catalog', (select coalesce(json_agg(row_to_json(c)), '[]'::json) from (
      select p.id as profile_id, p.name, p.role, u.email, u.created_at
      from profiles p join auth.users u on u.id = p.id
      where p.role in ('catalog', 'supervisor', 'observer')
      order by p.role, u.created_at
    ) c)
  )
  where is_admin_read();
$function$;

create or replace function private.admin_live_deliveries()
 returns json
 language plpgsql stable security definer
 set search_path to 'public'
as $function$
begin
  if not (is_admin_read() or is_supervisor()) then raise exception 'admin_only'; end if;
  return coalesce((
    select json_agg(row_to_json(x) order by x.assignment_id) from (
      select da.id as assignment_id, da.status as assignment_status, da.attempt_number,
             da.picked_up_at, da.out_for_delivery_at, da.arrived_at_customer_at,
             o.id as order_id, o.status as order_status, o.kitchen_status,
             o.customer_name, o.customer_phone, o.zone, o.unit_number, o.address_notes,
             o.total, o.payment_method, o.cod_deposit_amount, o.order_type,
             o.request_items, o.request_notes, o.created_at,
             r.name as vendor_name,
             d.id as driver_id, d.name as driver_name, d.phone as driver_phone,
             d.current_lat as driver_lat, d.current_lng as driver_lng,
             d.location_updated_at as driver_seen_at,
             case when d.location_updated_at is null then null
                  else round(extract(epoch from (now() - d.location_updated_at)))::int end as driver_seen_seconds_ago,
             c.latitude  as dest_lat,
             c.longitude as dest_lng,
             coalesce((
               select json_agg(json_build_object(
                        'name', oi.name, 'qty', oi.qty, 'total', oi.total,
                        'size_name', oi.size_name, 'combo_name', oi.combo_name,
                        'addon_names', oi.addon_names) order by oi.id)
                 from order_items oi where oi.order_id = o.id
             ), '[]'::json) as items
        from delivery_assignments da
        join orders o on o.id = da.order_id
        left join restaurants r on r.id = o.restaurant_id
        left join drivers d on d.id = da.driver_id
        left join compounds c on c.id = o.compound_id
       where da.status in ('Offered','Accepted','Picked_Up','Out_for_Delivery')
    ) x
  ), '[]'::json);
end $function$;

create or replace function private.admin_pending_refunds()
 returns json
 language plpgsql stable security definer
 set search_path to 'public'
as $function$
begin
  if not is_admin_read() then raise exception 'admin_only'; end if;
  return coalesce((
    select json_agg(row_to_json(x)) from (
      select o.id, o.customer_name, o.customer_phone, o.total, o.payment_method,
             o.cod_deposit_amount, o.status, o.cancel_reason, o.cancelled_at,
             o.instapay_claimed_at, r.name as vendor_name,
             case when o.payment_method = 'cod' then coalesce(o.cod_deposit_amount, 0)
                  else o.total end as refund_amount
        from orders o
        left join restaurants r on r.id = o.restaurant_id
       where o.refund_status = 'pending'
       order by o.cancelled_at desc nulls last, o.id desc
    ) x
  ), '[]'::json);
end $function$;

create or replace function private.admin_stalled_orders()
 returns json
 language plpgsql stable security definer
 set search_path to 'public'
as $function$
begin
  if not is_admin_read() then raise exception 'not_authorized'; end if;
  return coalesce((select json_agg(row_to_json(s)) from stalled_orders() s), '[]'::json);
end;
$function$;

create or replace function private.admin_vendors_without_items()
 returns json
 language sql stable security definer
 set search_path to 'public'
as $function$
  select case when not is_admin_read() then '[]'::json else coalesce((
    select json_agg(row_to_json(x)) from (
      select r.id, r.name, r.is_open, r.vendor_type
        from restaurants r
       where not r.archived
         and not exists (select 1 from menu_items m
                          where m.restaurant_id = r.id and m.available
                            and not coalesce(m.is_shelf_label, false))
       order by r.name
    ) x
  ), '[]'::json) end;
$function$;

create or replace function private.admin_daily_report(p_date date default null::date)
 returns json
 language plpgsql security definer
 set search_path to 'public'
as $function$
declare
  v_day date;
  v_from timestamptz; v_to timestamptz;
  v_salary numeric; v_riders int; v_cost numeric;
  v_rev numeric; v_fees numeric; v_svc numeric; v_gmv numeric;
  v_delivered int; v_cancelled int; v_created int;
  v_rev_per numeric; v_breakeven numeric;
  v_funnel json; v_inapp json;
begin
  if not (is_admin_read() or is_supervisor()) then raise exception 'not_authorized'; end if;
  v_day  := coalesce(p_date, (now() at time zone 'Africa/Cairo')::date);
  v_from := (v_day::timestamp at time zone 'Africa/Cairo');
  v_to   := ((v_day + 1)::timestamp at time zone 'Africa/Cairo');
  select coalesce((select value::numeric from settings where key = 'driver_daily_salary_egp'), 0)
    into v_salary;
  select count(*) into v_riders from drivers where active and coalesce(is_test, false) = false;
  v_cost := v_salary * v_riders;
  select coalesce(sum(delivery_fee),0), coalesce(sum(service_fee),0), coalesce(sum(total),0), count(*)
    into v_fees, v_svc, v_gmv, v_delivered
    from orders where status = 'Delivered' and coalesce(is_test,false) = false
     and created_at >= v_from and created_at < v_to;
  select count(*) filter (where status = 'Cancelled'), count(*)
    into v_cancelled, v_created
    from orders where coalesce(is_test,false) = false and created_at >= v_from and created_at < v_to;
  v_rev := v_fees + v_svc;
  v_rev_per := case when v_delivered > 0 then v_rev / v_delivered else null end;
  v_breakeven := case when coalesce(v_rev_per,0) > 0 then v_cost / v_rev_per else null end;
  select json_build_object(
    'arrived',   count(distinct device_id) filter (where event = 'arrival'),
    'chose_place', count(distinct device_id) filter (where event = 'place_chosen'),
    'opened_vendor', count(distinct device_id) filter (where event = 'vendor_opened'),
    'added_item', count(distinct device_id) filter (where event = 'item_added'),
    'checkout',  count(distinct device_id) filter (where event = 'checkout_started'),
    'ordered',   count(distinct device_id) filter (where event = 'order_placed'))
    into v_funnel from app_events where created_at >= v_from and created_at < v_to;
  select json_agg(row_to_json(seg)) into v_inapp
  from (
    select case when d.in_app then 'in_app' else 'browser' end as segment,
           count(*) as devices,
           count(*) filter (where f.chose) as chose_place,
           count(*) filter (where f.ordered) as ordered
      from (select device_id, bool_or(props->>'in_app' = 'true') as in_app
              from app_events where event = 'arrival' and created_at >= v_from and created_at < v_to
             group by device_id) d
      left join (select device_id, bool_or(event = 'place_chosen') as chose, bool_or(event = 'order_placed') as ordered
                   from app_events where created_at >= v_from and created_at < v_to group by device_id) f on f.device_id = d.device_id
     group by 1
  ) seg;
  return json_build_object(
    'day', v_day, 'orders_created', v_created, 'delivered', v_delivered, 'cancelled', v_cancelled,
    'cancel_pct', case when v_created > 0 then round(100.0 * v_cancelled / v_created, 1) else 0 end,
    'gmv', v_gmv, 'revenue', v_rev, 'delivery_fees', v_fees, 'service_fees', v_svc,
    'revenue_per_delivered', round(coalesce(v_rev_per,0), 1), 'assumed_rider_cost', v_cost,
    'riders_active', v_riders, 'rider_daily_salary', v_salary, 'result', v_rev - v_cost,
    'breakeven_orders', round(coalesce(v_breakeven,0), 1),
    'pct_of_breakeven', case when coalesce(v_breakeven,0) > 0 then round(100.0 * v_delivered / v_breakeven, 1) else null end,
    'cost_per_delivered', case when v_delivered > 0 then round(v_cost / v_delivered) else null end,
    'funnel', v_funnel, 'by_browser', coalesce(v_inapp, '[]'::json),
    'unpriced_left_open', (select count(*) from orders
        where pricing_status = 'pending_quote' and status not in ('Cancelled','Delivered')
          and created_at >= v_from and created_at < v_to),
    'unpaid_left_open', (select count(*) from orders
        where status = 'awaiting_payment' and created_at >= v_from and created_at < v_to)
  );
end;
$function$;

create or replace function private.admin_convert_staff_role(p_profile_id uuid, p_role text)
 returns void
 language plpgsql security definer
 set search_path to 'public'
as $function$
declare v_current text;
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  if p_role not in ('catalog', 'supervisor', 'observer') then raise exception 'invalid_role'; end if;
  if p_profile_id = auth.uid() then raise exception 'cannot_target_self'; end if;
  select role into v_current from profiles where id = p_profile_id;
  if v_current is null then raise exception 'profile_not_found'; end if;
  if v_current not in ('catalog', 'supervisor', 'observer') then raise exception 'target_not_convertible'; end if;
  update profiles set role = p_role where id = p_profile_id;
end $function$;
