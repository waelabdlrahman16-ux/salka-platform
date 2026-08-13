-- Each operational alert must start from the event for its current stage.
-- In particular, a picked-up order used to be measured from dispatch_at
-- (when the restaurant became ready), overstating the wait shown to staff.
create or replace function public.stalled_orders()
returns table(
  id integer,
  status text,
  vendor_name text,
  compound_name text,
  customer_name text,
  customer_phone text,
  total numeric,
  payment_method text,
  reference_at timestamptz,
  minutes_stalled integer,
  threshold_minutes integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with cfg as (
    select
      coalesce((select value::int from settings where key = 'stall_payment_minutes'), 30)  as t_pay,
      coalesce((select value::int from settings where key = 'stall_quote_minutes'), 10)    as t_quote,
      coalesce((select value::int from settings where key = 'stall_accepted_minutes'), 60) as t_acc,
      coalesce((select value::int from settings where key = 'stall_delivery_minutes'), 90) as t_del,
      coalesce((select value::int from settings where key = 'escalate_after_minutes'), 15) as t_esc
  ),
  scored as (
    select
      o.id, o.status, r.name as vendor_name, c.name as compound_name,
      o.customer_name, o.customer_phone, o.total, o.payment_method,
      case
        when o.status in ('pending', 'awaiting_payment', 'awaiting_quote') then o.created_at
        when o.status = 'Accepted' then coalesce(a.responded_at, o.dispatch_at, o.created_at)
        when o.status = 'Picked_Up' then coalesce(a.picked_up_at, o.dispatch_at, o.created_at)
        when o.status = 'Out_for_Delivery' then coalesce(a.out_for_delivery_at, a.picked_up_at, o.dispatch_at, o.created_at)
        else coalesce(o.dispatch_at, o.created_at)
      end as reference_at,
      case o.status
        when 'pending'          then cfg.t_pay
        when 'awaiting_payment' then cfg.t_pay
        when 'awaiting_quote'   then cfg.t_quote
        when 'Driver_Searching' then cfg.t_esc
        when 'Out_for_Delivery' then cfg.t_del
        else cfg.t_acc
      end as threshold_minutes
    from orders o
    cross join cfg
    left join restaurants r on r.id = o.restaurant_id
    left join compounds c on c.id = o.compound_id
    left join lateral (
      select da.responded_at, da.picked_up_at, da.out_for_delivery_at
      from delivery_assignments da
      where da.order_id = o.id
      order by da.attempt_number desc, da.id desc
      limit 1
    ) a on true
    where o.status not in ('Delivered', 'Cancelled', 'Scheduled')
  )
  select
    s.id, s.status, s.vendor_name, s.compound_name,
    s.customer_name, s.customer_phone, s.total, s.payment_method,
    s.reference_at,
    floor(extract(epoch from (now() - s.reference_at)) / 60)::int as minutes_stalled,
    s.threshold_minutes
  from scored s
  where now() > s.reference_at + make_interval(mins => s.threshold_minutes)
  order by (now() - s.reference_at) desc;
$function$;
