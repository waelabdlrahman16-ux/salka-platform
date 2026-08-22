-- Notification load, measured 2026-08-22 over the preceding 7 days:
--
--   898 sends in 24h across 15 devices. The admin account alone received 376
--   a day -- one every four minutes, around the clock.
--
--   The single biggest source was the pricing nudge: 149 firings a day against
--   25 orders a day. One unpriced order produced a push every 55 seconds, eight
--   times, to every admin AND every supervisor, then an escalation at five
--   minutes. Nine alerts to everybody inside eight minutes, for one order.
--
--   And then silence. The sweep only looks at orders created in the last 45
--   minutes, so after the burst nothing more is ever said. Orders 956 and 957
--   sat unpriced for 202 and 208 minutes on 21 Aug and were eventually
--   cancelled; both were hammered for their first eight minutes and then went
--   quiet for over three hours.
--
-- So the nudge was simultaneously too loud and blind to the case that matters.
-- Two changes, and neither is "send less and hope":
--
--   1. CADENCE. Every 3 minutes, up to 5 times, instead of every 55 seconds up
--      to 8. Five alerts over fifteen minutes rather than eight over eight --
--      fewer in total, and spread widely enough to read one before the next
--      arrives. The five-minute escalation is unchanged and still lands in the
--      middle of that window.
--
--   2. AUDIENCE. A repeat goes to the people who can act on it; the escalation
--      goes to everyone. Pricing is supervisor work, so the pricing nudge now
--      targets supervisors. Confirming an InstaPay transfer requires is_admin(),
--      so the payment nudge targets admins -- a supervisor could never have
--      acted on the ones they were being sent.
--
--      With a fallback, deliberately: if the role that owns the work has no
--      registered device, the nudge goes to all staff rather than nowhere. A
--      quieter system that silently drops alerts is worse than the loud one.
--
-- The long tail is NOT fixed here. That is what the stall alert in the hygiene
-- batch does -- it drives off stalled_orders() and so keeps its eye on an order
-- for as long as it is genuinely late. This migration makes the first fifteen
-- minutes bearable; that one covers hour three.
create or replace function public.push_nudge_sweep()
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record; v_targets jsonb;
  v_vendor_max int := 10;   -- ~10 minutes of asking
  v_driver_max int := 6;    -- ~6 minutes, then the dispatcher's escalation owns it
  v_price_max  int := 5;    -- was 8 at 55s. Five at 3 minutes: fewer, and readable.
  v_pay_max    int := 6;    -- past this it is a phone call, not a notification
  v_gap interval := interval '55 seconds';
  v_price_gap interval := interval '3 minutes';
  v_vendor_sent int := 0; v_driver_sent int := 0; v_price_sent int := 0;
  v_pay_sent int := 0; v_escalated int := 0; v_no_token_escalated int := 0;
  v_staff jsonb; v_pricers jsonb; v_payers jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('token', pt.token, 'platform', pt.platform)), '[]'::jsonb)
    into v_staff from push_tokens pt join profiles p on p.id = pt.profile_id
   where p.role in ('admin', 'supervisor');

  -- Who owns the work. Supervisors quote; only an admin can confirm a transfer
  -- (admin_confirm_instapay_payment gates on is_admin()). Falling back to all
  -- staff keeps an unstaffed role from turning into silence.
  select coalesce(jsonb_agg(jsonb_build_object('token', pt.token, 'platform', pt.platform)), '[]'::jsonb)
    into v_pricers from push_tokens pt join profiles p on p.id = pt.profile_id
   where p.role = 'supervisor';
  if jsonb_array_length(v_pricers) = 0 then v_pricers := v_staff; end if;

  select coalesce(jsonb_agg(jsonb_build_object('token', pt.token, 'platform', pt.platform)), '[]'::jsonb)
    into v_payers from push_tokens pt join profiles p on p.id = pt.profile_id
   where p.role = 'admin';
  if jsonb_array_length(v_payers) = 0 then v_payers := v_staff; end if;

  ------------------------------------------------------------------
  -- VENDOR: the kitchen has not accepted it.
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
        'طلب #' || r.id || ' لسه ما اتقبلش — افتح الشاشة وأكّده',
        jsonb_build_object('order_id', r.id, 'kind', 'vendor_nudge'));
      v_vendor_sent := v_vendor_sent + 1;
      insert into push_nudge (kind, ref_id, attempts, last_at) values ('vendor_new_order', r.id, 1, now())
      on conflict (kind, ref_id) do update set attempts = push_nudge.attempts + 1, last_at = now();
    else
      -- The vendor has no registered device. Counting this as an "attempt" was
      -- the bug: after ten of them the escalation told an admin the restaurant
      -- had ignored ten alerts, when not one had ever been sent. Touch the row
      -- so the loop keeps its cadence, but never inflate the ignored count.
      insert into push_nudge (kind, ref_id, attempts, last_at) values ('vendor_new_order', r.id, 0, now())
      on conflict (kind, ref_id) do update set last_at = now();
    end if;
  end loop;

  -- Escalation A: the vendor IS reachable and really has ignored us.
  for r in
    select o.id, n.ref_id from push_nudge n join orders o on o.id = n.ref_id
     where n.kind = 'vendor_new_order' and n.attempts >= v_vendor_max
       and not n.escalated and o.kitchen_status = 'new' and o.status = 'pending'
  loop
    perform notify_admin('المطعم مش رادّ ☎️',
      'طلب #' || r.id || ' عدّى ' || v_vendor_max || ' تنبيه من غير قبول — كلّمهم',
      jsonb_build_object('order_id', r.id, 'kind', 'vendor_unresponsive'));
    update push_nudge set escalated = true where kind = 'vendor_new_order' and ref_id = r.ref_id;
    v_escalated := v_escalated + 1;
  end loop;

  -- Escalation B: the vendor is NOT reachable at all -- no device registered, so
  -- no amount of waiting will produce an acceptance. Say so honestly, and say it
  -- after two minutes rather than ten, because waiting achieves nothing here.
  for r in
    select o.id, rest.name as rname
      from push_nudge n
      join orders o on o.id = n.ref_id
      join restaurants rest on rest.id = o.restaurant_id
     where n.kind = 'vendor_new_order'
       and not n.escalated
       and o.kitchen_status = 'new' and o.status = 'pending'
       and o.created_at <= now() - interval '2 minutes'
       and not exists (
         select 1 from push_tokens pt join profiles p on p.id = pt.profile_id
          where p.role = 'vendor' and p.restaurant_id = o.restaurant_id)
  loop
    perform notify_admin('المطعم مش مسجّل في التطبيق ☎️',
      'طلب #' || r.id || ' في ' || coalesce(r.rname, '—')
        || ' — المطعم مفيش عنده جهاز مسجّل، مش هيوصله إشعار. كلّمهم بالتليفون',
      jsonb_build_object('order_id', r.id, 'kind', 'vendor_no_device'));
    update push_nudge set escalated = true where kind = 'vendor_new_order' and ref_id = r.id;
    v_no_token_escalated := v_no_token_escalated + 1;
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
        'طلب #' || r.order_id || ' معروض عليك لسه — اقبله أو ارفضه',
        jsonb_build_object('order_id', r.order_id, 'kind', 'driver_nudge'));
      v_driver_sent := v_driver_sent + 1;
      insert into push_nudge (kind, ref_id, attempts, last_at) values ('driver_offer', r.id, 1, now())
      on conflict (kind, ref_id) do update set attempts = push_nudge.attempts + 1, last_at = now();
    else
      -- Same correction as the vendor branch: an undeliverable nudge is not a
      -- refusal. notify_admin's no_recipients logging now records the gap.
      insert into push_nudge (kind, ref_id, attempts, last_at) values ('driver_offer', r.id, 0, now())
      on conflict (kind, ref_id) do update set last_at = now();
    end if;
  end loop;

  ------------------------------------------------------------------
  -- PRICING: nobody has quoted it. Supervisor work -- see v_pricers.
  ------------------------------------------------------------------
  for r in
    select o.id, rest.name as rname, n.attempts
      from orders o
      join restaurants rest on rest.id = o.restaurant_id
      left join push_nudge n on n.kind = 'pricing_needed' and n.ref_id = o.id
     where (o.pricing_status = 'pending_quote' or o.status = 'awaiting_quote')
       and o.status not in ('Cancelled', 'Delivered')
       and o.created_at > now() - interval '45 minutes'
       and (n.last_at is null or n.last_at < now() - v_price_gap)
       and coalesce(n.attempts, 0) < v_price_max
  loop
    if jsonb_array_length(v_pricers) > 0 then
      perform push_send(v_pricers, 'طلب محتاج تسعير 💰',
        'طلب #' || r.id || ' من ' || coalesce(r.rname, '—') || ' لسه مستني سعر',
        jsonb_build_object('order_id', r.id, 'kind', 'pricing_nudge'));
      v_price_sent := v_price_sent + 1;
    end if;
    insert into push_nudge (kind, ref_id, attempts, last_at) values ('pricing_needed', r.id, 1, now())
    on conflict (kind, ref_id) do update set attempts = push_nudge.attempts + 1, last_at = now();
  end loop;

  -- Escalation: everyone, including the admin who is no longer being nudged.
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
        || ' مستني السعر بقاله 5 دقايق — اتصل وسعّره دلوقتي',
      jsonb_build_object('order_id', r.id, 'kind', 'pricing_escalation'));
    update push_nudge set escalated = true
     where kind = 'pricing_needed' and ref_id = r.id;
    v_escalated := v_escalated + 1;
  end loop;

  ------------------------------------------------------------------
  -- PAYMENT: the customer has not paid a deposit or transfer.
  -- Admin work -- confirming a transfer gates on is_admin().
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
    if jsonb_array_length(v_payers) > 0 then
      if r.instapay_claimed_at is not null then
        perform push_send(v_payers, 'تحويل مستني تأكيد 🏦',
          'طلب #' || r.id || ' — العميل قال إنه حوّل ' || round(r.amount) || ' ج.م، أكّد الاستلام',
          jsonb_build_object('order_id', r.id, 'kind', 'payment_confirm'));
      else
        perform push_send(v_payers, 'طلب مستني الدفع 💳',
          'طلب #' || r.id || ' — ' || coalesce(r.customer_name, 'عميل') || ' لسه ما دفعش '
            || round(r.amount) || ' ج.م — ' || coalesce(r.customer_phone, ''),
          jsonb_build_object('order_id', r.id, 'kind', 'payment_nudge'));
      end if;
      v_pay_sent := v_pay_sent + 1;
    end if;
    insert into push_nudge (kind, ref_id, attempts, last_at) values ('payment_needed', r.id, 1, now())
    on conflict (kind, ref_id) do update set attempts = push_nudge.attempts + 1, last_at = now();
  end loop;

  ------------------------------------------------------------------
  -- Housekeeping.
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
                           'escalated', v_escalated, 'no_device_escalated', v_no_token_escalated,
                           'at', now());
end $function$;


-- ---------------------------------------------------------------------------
-- A staff account with no working device is invisible today.
-- ---------------------------------------------------------------------------
-- Push tokens on this platform are web tokens -- every one of the 15 live ones
-- is platform 'web' -- and web tokens die whenever the browser clears storage
-- or the PWA is reinstalled. On 2026-08-22 there were 183 dead tokens against
-- 15 live, and 90 of them had died in the preceding week, every single one
-- UNREGISTERED.
--
-- The consequence is silent: a supervisor whose token dies simply stops being
-- told about orders, and nothing anywhere says so. It is exactly the failure
-- push_nudge_sweep already refuses to tolerate for vendors -- it escalates
-- "المطعم مفيش عنده جهاز مسجّل" after two minutes rather than waiting for an
-- acceptance that can never come -- and staff deserve the same honesty.
--
-- has_device is additive: existing keys are untouched, so a client that does
-- not read it is unaffected.
create or replace function private.admin_list_accounts()
 returns json
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select json_build_object(
    'vendors', (select coalesce(json_agg(row_to_json(v)), '[]'::json) from (
      select p.id as profile_id, p.restaurant_id, u.email,
             exists (select 1 from push_tokens pt where pt.profile_id = p.id) as has_device
      from profiles p join auth.users u on u.id = p.id
      where p.role = 'vendor'
    ) v),
    'drivers', (select coalesce(json_agg(row_to_json(d)), '[]'::json) from (
      select p.id as profile_id, p.driver_id, u.email,
             exists (select 1 from push_tokens pt where pt.profile_id = p.id) as has_device
      from profiles p join auth.users u on u.id = p.id
      where p.role = 'driver'
    ) d),
    'catalog', (select coalesce(json_agg(row_to_json(c)), '[]'::json) from (
      select p.id as profile_id, p.name, p.role, u.email, u.created_at,
             exists (select 1 from push_tokens pt where pt.profile_id = p.id) as has_device
      from profiles p join auth.users u on u.id = p.id
      where p.role in ('catalog', 'supervisor', 'observer')
      order by p.role, u.created_at
    ) c)
  )
  where is_admin();
$function$;
