-- A floor under the failure case.
--
-- Every branch of push_nudge_sweep is fenced by `created_at > now() - 45 minutes`,
-- and the pricing escalation is a one-shot. So an order's alerting life is:
-- nudges to ~15 minutes, one escalation at 5, then silence forever. The order
-- that sat 202 minutes unpriced was not a missed alert — it was outside the
-- window, exactly as written.
--
-- This sweep is deliberately NOT part of push_nudge_sweep: it is a different
-- problem on a different clock, and sharing the 1-minute throttle is what
-- created the tail in the first place. It starts where the nudges stop.
--
-- Cadence is by AGE, not by a fixed gap: 45m, 90m, 180m, 360m, then hourly
-- forever. There is no attempts ceiling — a ceiling is precisely the bug.
-- Volume is bounded by how rare a stuck order is, not by a cap: over the 30
-- days before this was written, zero of 110 quote-flow orders passed 45
-- minutes to quote (worst: 25). It costs nothing when things are fine.
--
-- Scheduled orders are measured from dispatch_at, not created_at, so a
-- pre-booked order does not become a 45-minute alarm the moment it is placed.

create or replace function public.stale_order_sweep()
  returns json
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  r record;
  v_sent int := 0;
  v_hours numeric;
begin
  for r in
    select o.id,
           coalesce(o.dispatch_at, o.created_at) as since,
           coalesce(n.attempts, 0) as attempts,
           case
             when o.pricing_status = 'pending_quote' or o.status = 'awaiting_quote'
               then 'مستني تسعير'
             when o.status = 'awaiting_payment' then 'مستني الدفع'
             when o.kitchen_status = 'new' and o.status = 'pending'
               then 'مستني المطعم يقبله'
             else 'مستني مندوب يقبله'
           end as waiting_for
      from orders o
      left join push_nudge n on n.kind = 'stale_order' and n.ref_id = o.id
     where o.is_test is not true
       and o.archived_at is null
       and o.status not in ('Cancelled', 'Delivered')
       and (
            o.pricing_status = 'pending_quote'
         or o.status in ('awaiting_quote', 'awaiting_payment')
         or (o.kitchen_status = 'new' and o.status = 'pending')
         or exists (select 1 from delivery_assignments da
                     where da.order_id = o.id and da.status = 'Offered')
       )
       and coalesce(o.dispatch_at, o.created_at) <= now() - interval '45 minutes'
       and (
            n.attempts is null
         or (n.attempts < 4
             and coalesce(o.dispatch_at, o.created_at)
                 <= now() - (interval '45 minutes' * power(2, n.attempts)))
         or (n.attempts >= 4 and n.last_at < now() - interval '60 minutes')
       )
  loop
    -- Past 45 minutes this is not role-specific work any more, it is "this
    -- order is dying". notify_admin reaches everyone who can do something.
    v_hours := round(extract(epoch from (now() - r.since)) / 3600.0, 1);

    perform notify_admin(
      '⏳ طلب متعلّق',
      'طلب #' || r.id || ' ' || r.waiting_for || ' بقاله ' || v_hours || ' ساعة — راجعه أو الغيه',
      jsonb_build_object('order_id', r.id, 'kind', 'stale_order',
                         'hours', v_hours, 'waiting_for', r.waiting_for));

    insert into push_nudge (kind, ref_id, attempts, last_at)
    values ('stale_order', r.id, 1, now())
    on conflict (kind, ref_id)
      do update set attempts = push_nudge.attempts + 1, last_at = now();

    v_sent := v_sent + 1;
  end loop;

  return json_build_object('stale_alerts', v_sent);
end;
$$;

revoke all on function public.stale_order_sweep() from public, anon, authenticated;

-- Every 10 minutes. Not the 1-minute sweep: nothing here needs that resolution,
-- and the coarser clock keeps this off the hot path.
select cron.unschedule('stale-order-sweep')
 where exists (select 1 from cron.job where jobname = 'stale-order-sweep');

select cron.schedule('stale-order-sweep', '*/10 * * * *',
                     'select public.stale_order_sweep()');
