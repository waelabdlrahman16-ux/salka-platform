-- Two places computed a Cairo calendar day using the raw UTC clock instead of
-- an explicit `at time zone 'Africa/Cairo'` conversion, inconsistent with the
-- rest of these same functions (my_driver_stats already gets v_today right;
-- only the streak loop above it didn't). A delivery/order between ~00:00 and
-- 02:00 Cairo time was filed under the previous UTC day.

create or replace function private.my_driver_stats()
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_driver integer;
  v_total integer;
  v_streak integer := 0;
  v_check date := (now() at time zone 'Africa/Cairo')::date;
  v_has boolean;
  v_today date;
  v_today_orders integer;
  v_today_earnings numeric;
  v_today_tips numeric;
  v_today_reported_tips numeric;
  v_unpaid numeric;
  v_cash numeric;
  v_t1_o integer;
  v_t1_a numeric;
  v_t2_o integer;
  v_t2_a numeric;
  v_t3_o integer;
  v_t3_a numeric;
  v_tier integer := 0;
  v_earned numeric := 0;
  v_next_o integer;
  v_next_a numeric;
begin
  v_driver := public.my_driver_id();
  if v_driver is null then raise exception 'not_a_driver'; end if;

  select coalesce(d.total_deliveries, 0), coalesce(d.cash_held, 0)
    into v_total, v_cash
    from public.drivers d
   where d.id = v_driver;

  loop
    select exists(
      select 1
        from public.delivery_assignments da
       where da.driver_id = v_driver
         and da.status = 'Delivered'
         and (da.delivered_at at time zone 'Africa/Cairo')::date = v_check
    ) into v_has;
    exit when not v_has;
    v_streak := v_streak + 1;
    v_check := v_check - 1;
    exit when v_streak > 365;
  end loop;

  v_today := (now() at time zone 'Africa/Cairo')::date;

  select count(*), coalesce(sum(de.driver_earning), 0)
    into v_today_orders, v_today_earnings
    from public.driver_earnings de
   where de.driver_id = v_driver
     and (de.created_at at time zone 'Africa/Cairo')::date = v_today;

  select
    coalesce(sum(dt.amount) filter (where dt.status = 'confirmed'), 0),
    coalesce(sum(dt.amount) filter (where dt.status = 'reported'), 0)
    into v_today_tips, v_today_reported_tips
    from public.driver_tips dt
   where dt.driver_id = v_driver
     and (dt.created_at at time zone 'Africa/Cairo')::date = v_today;

  select coalesce(sum(de.driver_earning), 0)
    into v_unpaid
    from public.driver_earnings de
   where de.driver_id = v_driver
     and not coalesce(de.paid, false);

  select coalesce((select value::integer from public.settings where key = 'driver_bonus_tier1_orders'), 24) into v_t1_o;
  select coalesce((select value::numeric from public.settings where key = 'driver_bonus_tier1_amount'), 100) into v_t1_a;
  select coalesce((select value::integer from public.settings where key = 'driver_bonus_tier2_orders'), 30) into v_t2_o;
  select coalesce((select value::numeric from public.settings where key = 'driver_bonus_tier2_amount'), 150) into v_t2_a;
  select coalesce((select value::integer from public.settings where key = 'driver_bonus_tier3_orders'), 38) into v_t3_o;
  select coalesce((select value::numeric from public.settings where key = 'driver_bonus_tier3_amount'), 200) into v_t3_a;

  if v_today_orders >= v_t3_o then
    v_tier := 3; v_earned := v_t3_a; v_next_o := null; v_next_a := null;
  elsif v_today_orders >= v_t2_o then
    v_tier := 2; v_earned := v_t2_a; v_next_o := v_t3_o; v_next_a := v_t3_a;
  elsif v_today_orders >= v_t1_o then
    v_tier := 1; v_earned := v_t1_a; v_next_o := v_t2_o; v_next_a := v_t2_a;
  else
    v_tier := 0; v_earned := 0; v_next_o := v_t1_o; v_next_a := v_t1_a;
  end if;

  return json_build_object(
    'total_deliveries', v_total,
    'streak_days', v_streak,
    'today_orders', v_today_orders,
    'today_earnings', v_today_earnings,
    'today_tips', v_today_tips,
    'today_reported_tips', v_today_reported_tips,
    'unpaid_earnings', v_unpaid,
    'cash_held', v_cash,
    'bonus', json_build_object(
      'tiers', json_build_array(
        json_build_object('orders', v_t1_o, 'amount', v_t1_a),
        json_build_object('orders', v_t2_o, 'amount', v_t2_a),
        json_build_object('orders', v_t3_o, 'amount', v_t3_a)
      ),
      'current_tier', v_tier,
      'earned_today', v_earned,
      'next_orders', v_next_o,
      'next_amount', v_next_a,
      'orders_to_next', case
        when v_next_o is null then null
        else greatest(0, v_next_o - v_today_orders)
      end
    )
  );
end;
$function$;

create or replace function private.admin_customers()
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not is_admin() then raise exception 'admin_only'; end if;

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
                  -- Both sides now evaluated as CAIRO calendar days, not the
                  -- database session's own (UTC) -- consistent with how
                  -- everywhere else in this codebase computes "today".
                  else ((now() at time zone 'Africa/Cairo')::date
                        - (m.last_at at time zone 'Africa/Cairo')::date) end as days_quiet,
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
