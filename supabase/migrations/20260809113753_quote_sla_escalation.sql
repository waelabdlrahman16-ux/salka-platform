-- Quote requests promise a response within ten minutes.
-- Preserve the existing SECURITY DEFINER functions and their ACLs while
-- adding a five-minute escalation and a dedicated ten-minute stalled threshold.
CREATE OR REPLACE FUNCTION public.stalled_orders()
 RETURNS TABLE(id integer, status text, vendor_name text, compound_name text, customer_name text, customer_phone text, total numeric, payment_method text, reference_at timestamp with time zone, minutes_stalled integer, threshold_minutes integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      case when o.status in ('pending', 'awaiting_payment', 'awaiting_quote')
           then o.created_at
           else coalesce(o.dispatch_at, o.created_at) end as reference_at,
      case o.status
        when 'pending'           then cfg.t_pay
        when 'awaiting_payment'  then cfg.t_pay
        -- Waiting on an admin to phone a price. Its own threshold, because it
        -- is the only state whose unblocking actor is us.
        when 'awaiting_quote'    then cfg.t_quote
        -- Already surfaced by its own status; No_Driver_Found is the alarm.
        when 'Driver_Searching'  then cfg.t_esc
        when 'Out_for_Delivery'  then cfg.t_del
        else cfg.t_acc
      end as threshold_minutes
    from orders o
    cross join cfg
    left join restaurants r on r.id = o.restaurant_id
    left join compounds   c on c.id = o.compound_id
    -- Scheduled is excluded outright: it is not stalled, it is not due.
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

CREATE OR REPLACE FUNCTION public.push_nudge_sweep()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record; v_targets jsonb;
  v_vendor_max int := 10;   -- ~10 minutes of asking
  v_driver_max int := 6;    -- ~6 minutes, then the dispatcher's escalation owns it
  v_price_max  int := 8;    -- frequent reminders while the ten-minute SLA runs
  v_pay_max    int := 6;    -- past this it is a phone call, not a notification
  v_gap interval := interval '55 seconds';
  v_vendor_sent int := 0; v_driver_sent int := 0; v_price_sent int := 0;
  v_pay_sent int := 0; v_escalated int := 0;
  v_staff jsonb;
begin
  -- Resolved once: admin + supervisor is the audience for everything that is
  -- nobody else's job, and re-running the same query per row was pointless.
  select coalesce(jsonb_agg(jsonb_build_object('token', pt.token, 'platform', pt.platform)), '[]'::jsonb)
    into v_staff from push_tokens pt join profiles p on p.id = pt.profile_id
   where p.role in ('admin', 'supervisor');

  ------------------------------------------------------------------
  -- VENDOR: the kitchen has not accepted it. Nudging starts the moment the
  -- ticket exists -- not at dispatch_at, which is when the DRIVER is due.
  ------------------------------------------------------------------
  for r in
    select o.id, o.restaurant_id, n.attempts
      from orders o
      left join push_nudge n on n.kind = 'vendor_new_order' and n.ref_id = o.id
     where o.kitchen_status = 'new' and o.status = 'pending'
       and coalesce(o.dispatch_at, o.created_at) > now() - interval '45 minutes'
       and (n.last_at is null or n.last_at < now() - v_gap)
       and coalesce(n.attempts, 0) < v_vendor_max
  loop
    select coalesce(jsonb_agg(jsonb_build_object('token', pt.token, 'platform', pt.platform)), '[]'::jsonb)
      into v_targets from push_tokens pt join profiles p on p.id = pt.profile_id
     where p.role = 'vendor' and p.restaurant_id = r.restaurant_id;
    if jsonb_array_length(v_targets) > 0 then
      perform push_send(v_targets, 'طلب لسه مستني ⏰',
        'طلب #' || r.id || ' لسه ما اتقبلش -- افتح الشاشة وأكّده',
        jsonb_build_object('order_id', r.id, 'kind', 'vendor_nudge'));
      v_vendor_sent := v_vendor_sent + 1;
    end if;
    insert into push_nudge (kind, ref_id, attempts, last_at) values ('vendor_new_order', r.id, 1, now())
    on conflict (kind, ref_id) do update set attempts = push_nudge.attempts + 1, last_at = now();
  end loop;

  for r in
    select o.id, n.ref_id from push_nudge n join orders o on o.id = n.ref_id
     where n.kind = 'vendor_new_order' and n.attempts >= v_vendor_max
       and not n.escalated and o.kitchen_status = 'new' and o.status = 'pending'
  loop
    perform notify_admin('المطعم مش رادّ ☎️',
      'طلب #' || r.id || ' عدّى ' || v_vendor_max || ' تنبيه من غير قبول -- كلّمهم',
      jsonb_build_object('order_id', r.id, 'kind', 'vendor_unresponsive'));
    update push_nudge set escalated = true where kind = 'vendor_new_order' and ref_id = r.ref_id;
    v_escalated := v_escalated + 1;
  end loop;

  ------------------------------------------------------------------
  -- DRIVER: an offer is on the table and has not been accepted.
  ------------------------------------------------------------------
  for r in
    select da.id, da.order_id, da.driver_id, n.attempts
      from delivery_assignments da
      left join push_nudge n on n.kind = 'driver_offer' and n.ref_id = da.id
     where da.status = 'Offered'
       and coalesce(da.offered_at, now()) > now() - interval '30 minutes'
       and (n.last_at is null or n.last_at < now() - v_gap)
       and coalesce(n.attempts, 0) < v_driver_max
  loop
    select coalesce(jsonb_agg(jsonb_build_object('token', pt.token, 'platform', pt.platform)), '[]'::jsonb)
      into v_targets from push_tokens pt join profiles p on p.id = pt.profile_id
     where p.role = 'driver' and p.driver_id = r.driver_id;
    if jsonb_array_length(v_targets) > 0 then
      perform push_send(v_targets, 'طلب مستنيك 🛵',
        'طلب #' || r.order_id || ' معروض عليك لسه -- اقبله أو ارفضه',
        jsonb_build_object('order_id', r.order_id, 'kind', 'driver_nudge'));
      v_driver_sent := v_driver_sent + 1;
    end if;
    insert into push_nudge (kind, ref_id, attempts, last_at) values ('driver_offer', r.id, 1, now())
    on conflict (kind, ref_id) do update set attempts = push_nudge.attempts + 1, last_at = now();
  end loop;

  ------------------------------------------------------------------
  -- PRICING: nobody has quoted it. Lost order #86.
  -- Widened to cover status = 'awaiting_quote' as well as the
  -- pricing_status flag, because they are the same fact recorded twice and
  -- an order carrying only one of them was invisible to this loop.
  ------------------------------------------------------------------
  for r in
    select o.id, rest.name as rname, n.attempts
      from orders o
      join restaurants rest on rest.id = o.restaurant_id
      left join push_nudge n on n.kind = 'pricing_needed' and n.ref_id = o.id
     where (o.pricing_status = 'pending_quote' or o.status = 'awaiting_quote')
       and o.status not in ('Cancelled', 'Delivered')
       and o.created_at > now() - interval '45 minutes'
       and (n.last_at is null or n.last_at < now() - v_gap)
       and coalesce(n.attempts, 0) < v_price_max
  loop
    if jsonb_array_length(v_staff) > 0 then
      perform push_send(v_staff, 'طلب محتاج تسعير 💰',
        'طلب #' || r.id || ' من ' || coalesce(r.rname, '—') || ' لسه مستني سعر',
        jsonb_build_object('order_id', r.id, 'kind', 'pricing_nudge'));
      v_price_sent := v_price_sent + 1;
    end if;
    insert into push_nudge (kind, ref_id, attempts, last_at) values ('pricing_needed', r.id, 1, now())
    on conflict (kind, ref_id) do update set attempts = push_nudge.attempts + 1, last_at = now();
  end loop;

  -- A repeated reminder is easy to tune out. At five minutes this becomes a
  -- one-time operational escalation, while the customer-facing ten-minute
  -- promise still has time to be recovered.
  for r in
    select o.id, rest.name as rname
      from orders o
      join restaurants rest on rest.id = o.restaurant_id
      join push_nudge n on n.kind = 'pricing_needed' and n.ref_id = o.id
     where (o.pricing_status = 'pending_quote' or o.status = 'awaiting_quote')
       and o.status not in ('Cancelled', 'Delivered')
       and o.created_at <= now() - interval '5 minutes'
       and not n.escalated
  loop
    perform notify_admin('🚨 التسعير اتأخر',
      'طلب #' || r.id || ' من ' || coalesce(r.rname, '—')
        || ' مستني السعر بقاله 5 دقايق -- اتصل وسعّره دلوقتي',
      jsonb_build_object('order_id', r.id, 'kind', 'pricing_escalation'));
    update push_nudge set escalated = true
     where kind = 'pricing_needed' and ref_id = r.id;
    v_escalated := v_escalated + 1;
  end loop;

  ------------------------------------------------------------------
  -- PAYMENT: the customer has not paid a deposit or transfer. Lost #87.
  --
  -- Starts at 3 minutes, not immediately: a transfer takes a couple of
  -- minutes to actually do, and paging staff about an order the customer is
  -- mid-way through paying for trains them to ignore the alert.
  ------------------------------------------------------------------
  for r in
    select o.id, o.customer_name, o.customer_phone,
           coalesce(o.cod_deposit_amount, o.total) as amount,
           o.instapay_claimed_at, n.attempts
      from orders o
      left join push_nudge n on n.kind = 'payment_needed' and n.ref_id = o.id
     where o.status = 'awaiting_payment'
       and o.created_at <= now() - interval '3 minutes'
       and o.created_at > now() - interval '45 minutes'
       and (n.last_at is null or n.last_at < now() - v_gap)
       and coalesce(n.attempts, 0) < v_pay_max
  loop
    if jsonb_array_length(v_staff) > 0 then
      -- Two different jobs behind one status. If the customer says they have
      -- transferred, the ball is ours -- confirm it. If they have not, the
      -- ball is theirs and someone has to ring them.
      if r.instapay_claimed_at is not null then
        perform push_send(v_staff, 'تحويل مستني تأكيد 🏦',
          'طلب #' || r.id || ' -- العميل قال إنه حوّل ' || round(r.amount) || ' ج.م، أكّد الاستلام',
          jsonb_build_object('order_id', r.id, 'kind', 'payment_confirm'));
      else
        perform push_send(v_staff, 'طلب مستني الدفع 💳',
          'طلب #' || r.id || ' -- ' || coalesce(r.customer_name, 'عميل') || ' لسه ما دفعش '
            || round(r.amount) || ' ج.م -- ' || coalesce(r.customer_phone, ''),
          jsonb_build_object('order_id', r.id, 'kind', 'payment_nudge'));
      end if;
      v_pay_sent := v_pay_sent + 1;
    end if;
    insert into push_nudge (kind, ref_id, attempts, last_at) values ('payment_needed', r.id, 1, now())
    on conflict (kind, ref_id) do update set attempts = push_nudge.attempts + 1, last_at = now();
  end loop;

  ------------------------------------------------------------------
  -- Housekeeping: a nudge row is meaningless once its subject is settled.
  ------------------------------------------------------------------
  delete from push_nudge n
   where (n.kind = 'vendor_new_order'
          and not exists (select 1 from orders o where o.id = n.ref_id
                            and o.kitchen_status = 'new' and o.status = 'pending'))
      or (n.kind = 'driver_offer'
          and not exists (select 1 from delivery_assignments da where da.id = n.ref_id
                            and da.status = 'Offered'))
      or (n.kind = 'pricing_needed'
          and not exists (select 1 from orders o where o.id = n.ref_id
                            and (o.pricing_status = 'pending_quote' or o.status = 'awaiting_quote')
                            and o.status not in ('Cancelled','Delivered')))
      or (n.kind = 'payment_needed'
          and not exists (select 1 from orders o where o.id = n.ref_id
                            and o.status = 'awaiting_payment'));

  return json_build_object('vendor_nudges', v_vendor_sent, 'driver_nudges', v_driver_sent,
                           'pricing_nudges', v_price_sent, 'payment_nudges', v_pay_sent,
                           'escalated', v_escalated, 'at', now());
end $function$;

-- Fail the migration if a later edit weakens the security boundary or drops
-- either SLA clause. CREATE OR REPLACE preserves the existing function ACLs.
do $verify$
declare
  v_stalled text := pg_get_functiondef('public.stalled_orders()'::regprocedure);
  v_sweep text := pg_get_functiondef('public.push_nudge_sweep()'::regprocedure);
begin
  if not (select prosecdef from pg_proc where oid = 'public.stalled_orders()'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public.push_nudge_sweep()'::regprocedure) then
    raise exception 'quote_sla_security_definer_missing';
  end if;
  if not (select coalesce(proconfig, '{}'::text[]) @> array['search_path=public']
            from pg_proc where oid = 'public.stalled_orders()'::regprocedure)
     or not (select coalesce(proconfig, '{}'::text[]) @> array['search_path=public']
               from pg_proc where oid = 'public.push_nudge_sweep()'::regprocedure) then
    raise exception 'quote_sla_search_path_missing';
  end if;
  if position('stall_quote_minutes' in v_stalled) = 0
     or position('interval ''5 minutes''' in v_sweep) = 0
     or position('pricing_escalation' in v_sweep) = 0 then
    raise exception 'quote_sla_clauses_missing';
  end if;
end
$verify$;
