-- A customer presses "I transferred" after paying a driver directly outside
-- Salka. That is a report, not proof of payment. Keep reported amounts separate
-- from confirmed tips so old and new clients never treat an unverified claim as
-- driver earnings.
alter table public.driver_tips
  add column if not exists status text not null default 'reported';

alter table public.driver_tips
  drop constraint if exists driver_tips_status_check;
alter table public.driver_tips
  add constraint driver_tips_status_check
  check (status in ('reported', 'confirmed', 'rejected'));

alter table public.driver_tips
  add column if not exists confirmed_at timestamptz;

comment on column public.driver_tips.status is
  'reported means the customer claimed an external transfer; only confirmed is verified money';

create or replace function public.submit_tip(p_token uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id integer;
  v_driver_id integer;
  v_status text;
  v_instapay text;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 1000 then
    raise exception 'invalid_amount';
  end if;

  select o.id, o.status
    into v_order_id, v_status
    from public.orders o
   where o.public_token = p_token;
  if v_order_id is null then raise exception 'order_not_found'; end if;
  if v_status <> 'Delivered' then raise exception 'order_not_delivered'; end if;

  select da.driver_id, coalesce(d.instapay_number, d.phone)
    into v_driver_id, v_instapay
    from public.delivery_assignments da
    join public.drivers d on d.id = da.driver_id
   where da.order_id = v_order_id
     and da.status = 'Delivered'
   order by da.attempt_number desc
   limit 1;
  if v_driver_id is null then raise exception 'no_driver_on_this_order'; end if;
  if nullif(btrim(coalesce(v_instapay, '')), '') is null then
    raise exception 'driver_instapay_unavailable';
  end if;

  insert into public.driver_tips (order_id, driver_id, amount, status)
  values (v_order_id, v_driver_id, p_amount, 'reported')
  on conflict (order_id) do nothing;
end;
$function$;

create or replace function public.my_driver_stats()
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_driver integer;
  v_total integer;
  v_streak integer := 0;
  v_check date := current_date;
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
         and da.delivered_at::date = v_check
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
    -- Compatibility field for installed clients: verified tips only.
    'today_tips', v_today_tips,
    -- New clients display this as an unverified customer report.
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

revoke all on function public.submit_tip(uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.submit_tip(uuid, numeric)
  to anon, authenticated, service_role;

revoke all on function public.my_driver_stats()
  from public, anon, authenticated;
grant execute on function public.my_driver_stats()
  to authenticated, service_role;

do $verification$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'driver_tips'
       and column_name = 'status'
       and column_default like '%reported%'
  ) then
    raise exception 'tip report status is missing';
  end if;

  if position(
    '''today_reported_tips''' in pg_get_functiondef(
      'public.my_driver_stats()'::regprocedure
    )
  ) = 0 then
    raise exception 'reported tips are missing from driver stats';
  end if;

  if position(
    'dt.status = ''confirmed''' in pg_get_functiondef(
      'public.my_driver_stats()'::regprocedure
    )
  ) = 0 then
    raise exception 'legacy tip field still includes unverified reports';
  end if;

  if has_function_privilege(
    'anon', 'public.my_driver_stats()', 'execute'
  ) then
    raise exception 'anonymous driver stats grant remains';
  end if;
end
$verification$;
