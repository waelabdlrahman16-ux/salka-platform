-- Applied to production 2026-08-07. Recorded here because supabase/*.sql is the
-- only place a future session can read what the database actually does, and
-- these change who gets told about an order.
--
-- Full write-ups: claude/salka-push-root-cause-2026-08-07.md
--                 claude/salka-push-rules.md
--                 claude/salka-supervisor-remit-2026-08-07.md
--
-- The eight migrations, in the order they were applied:
--
--   20260807045112  supervisor_pharmacy_supermarket_remit
--   20260807060252  track_order_expose_arrived_at_customer
--   20260807112422  push_token_health_and_pruning
--   20260807112824  vendor_push_send_platform
--   20260807113549  push_nudge_until_acknowledged
--   20260807113613  push_nudge_fix_offered_at
--   20260807125023  no_pricing_a_cancelled_order
--   20260807130924  push_nudge_pricing_needed
--
-- Edge functions deployed the same day: send-push v15, push-health v1. Their
-- source is in supabase/functions/ and is the deployed source, byte for byte.


-- =====================================================================
-- 1. Supervisor prices and prepares pharmacy + supermarket orders
-- =====================================================================
-- Wael's rule: the pharmacy and the supermarket must not mark an order ready
-- for pickup. They do not know the price until someone has walked the aisle.
-- Pricing and preparing is the supervisor's job; the vendor account should not
-- be able to do it at all.
--
-- supervisor_may_touch_order() was scoped to catalog orders. Widened to any
-- order, because the supervisor now works the whole custom-order queue.

create or replace function public.supervisor_may_touch_order(p_order_id integer)
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select case
    when is_admin() then true
    when not is_supervisor() then false
    else exists (select 1 from orders o where o.id = p_order_id)
  end;
$$;

-- The RLS policy `supervisor reads catalog orders` was dropped and replaced,
-- so the supervisor's read surface and their write surface are now one rule
-- rather than two that can drift:
--
--   drop policy "supervisor reads catalog orders" on orders;
--   create policy "supervisor reads orders" on orders for select
--     using (supervisor_may_touch_order(id));
--
-- confirm_custom_order_price gated on is_admin(); now is_supervisor().
-- NOTE: admin_adjust_order gates on `is_admin() or is_supervisor()` and does
-- NOT consult the remit. That is a real money boundary and is still open --
-- do not assume this file closed it.


-- =====================================================================
-- 2. A cancelled order cannot be priced
-- =====================================================================
-- Order #86 was cancelled by the customer at 33 minutes, still carrying
-- pricing_status = 'pending_quote'. The admin card therefore led with
-- «قيد التسعير» and offered a live price box on a dead order. Server-side
-- guard added at the top of confirm_custom_order_price:
--
--   if v_o.status = 'Cancelled' then raise exception 'order_closed'; end if;
--
-- The client half (a cancelled order shows «ملغي» in red, with the reason and
-- the minutes elapsed, and no price box) is in src/pages/Admin.tsx.


-- =====================================================================
-- 3. Push: dead tokens are now removed instead of retried forever
-- =====================================================================
-- send-push recorded ok:false, status:404 INSIDE an HTTP 200, returned it to
-- pg_net (asynchronous, reads nothing), called from notify_admin whose last
-- line is `exception when others then null`. Three layers each hiding the
-- failure from the next, so a dead token sat in the table forever.

create table if not exists public.dead_push_tokens (
  token    text primary key,
  err_code text,
  died_at  timestamptz not null default now()
);

create table if not exists public.push_send_log (
  id           bigserial primary key,
  token_prefix text not null,
  profile_id   uuid,
  platform     text,
  ok           boolean not null,
  status       integer,
  err_code     text,
  title        text,
  created_at   timestamptz not null default now()
);

create or replace function public.record_push_result(
  p_token text, p_ok boolean, p_status integer, p_err_code text, p_title text)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare v_profile uuid; v_platform text;
begin
  select profile_id, platform into v_profile, v_platform
    from push_tokens where token = p_token limit 1;

  insert into push_send_log (token_prefix, profile_id, platform, ok, status, err_code, title)
  values (left(p_token, 12) || '...', v_profile, v_platform, p_ok, p_status, p_err_code, p_title);

  -- UNREGISTERED: the device is gone or the token rotated. INVALID_ARGUMENT on
  -- a token means it was never valid for this project. Either way it will never
  -- deliver again, so it is removed rather than retried forever.
  --
  -- UNAVAILABLE is deliberately NOT fatal -- that is a retryable FCM blip, and
  -- deleting on it would throw away live tokens during a wobble.
  if not p_ok and (p_err_code in ('UNREGISTERED','INVALID_ARGUMENT') or p_status = 404) then
    insert into dead_push_tokens (token, err_code) values (p_token, p_err_code)
      on conflict (token) do update set died_at = now(), err_code = excluded.err_code;
    delete from push_tokens where token = p_token;
  end if;
end;
$$;


-- =====================================================================
-- 4. The cache is the bug -- why re-enabling never helped
-- =====================================================================
-- Firebase's getToken() returns whatever is cached in IndexedDB and NEVER asks
-- FCM whether that token is still registered. The admin's token was re-saved at
-- 13:06 and was still UNREGISTERED at 13:34. registerPush() ran on every mount,
-- dutifully re-saved the same dead string, and bumped updated_at. The row
-- looked freshly healthy. The timestamp lied.
--
-- save_my_push_token now REFUSES a known-dead token and says so, which is the
-- signal the client uses to call deleteToken() and mint a genuinely new one.
-- It also had to change return type from void to json, so the migration does
-- `drop function if exists` first.

create or replace function public.save_my_push_token(
  p_push_token text, p_platform text default 'web')
returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_was_dead boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_platform not in ('web','android','ios') then raise exception 'bad_platform'; end if;
  if coalesce(btrim(p_push_token),'') = '' then raise exception 'empty_token'; end if;

  select true into v_was_dead from dead_push_tokens where token = p_push_token;
  if coalesce(v_was_dead, false) then
    return json_build_object('stored', false, 'stale', true);
  end if;

  -- One device produces one token. If another account previously signed in on
  -- this device, that row is now wrong. Without this, an order for ماكدونالدز
  -- rings the admin's phone and the vendor is never told.
  delete from push_tokens
   where token = p_push_token and profile_id <> auth.uid();

  insert into push_tokens (profile_id, token, platform, updated_at)
  values (auth.uid(), p_push_token, p_platform, now())
  on conflict (profile_id) do update
    set token = excluded.token, platform = excluded.platform, updated_at = now();

  return json_build_object('stored', true, 'stale', false);
end;
$$;


-- =====================================================================
-- 5. The vendor path was sending bare token strings
-- =====================================================================
-- notify_new_order and notify_new_order_for -- the two functions that tell a
-- vendor an order has arrived, i.e. the most important notification in the
-- system -- sent bare tokens. send-push treats a bare string as platform:web,
-- and web is deliberately data-only, so on the Android APK the message goes to
-- an app process that does not exist while the app is killed and NOTHING is
-- shown. That is the APK symptom.
--
-- Both were patched from
--     jsonb_agg(pt.token)
-- to
--     jsonb_agg(jsonb_build_object('token', pt.token, 'platform', pt.platform))
--
-- RULE FOR ANY FUTURE notify_* FUNCTION: never send a bare token string.


-- =====================================================================
-- 6. Keep ringing until staff act -- once only for customers
-- =====================================================================
-- Wael's rule: vendors and drivers must not be able to lose an order by
-- glancing away, so their alert repeats until they act on it. A customer gets
-- exactly one notification per status change -- a banner they cannot dismiss,
-- about an order they cannot speed up, is a reason to uninstall the app.
--
-- Whether a banner STICKS (requireInteraction / android sticky) is derived in
-- send-push from whether the token is a staff token -- staff live in
-- push_tokens, customers on orders.push_token -- rather than a flag each caller
-- must remember to pass. The failure mode of a flag is the one function nobody
-- updates, which is exactly how the vendor path shipped bare tokens for months.

create table if not exists public.push_nudge (
  kind      text not null,
  ref_id    integer not null,
  attempts  integer not null default 0,
  last_at   timestamptz,
  escalated boolean not null default false,
  primary key (kind, ref_id)
);

create or replace function public.push_send(
  p_targets jsonb, p_title text, p_body text, p_data jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare v_secret text;
begin
  if p_targets is null or jsonb_array_length(p_targets) = 0 then return; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_webhook_secret';
  perform net.http_post(
    url := 'https://pqpnwxyevrsipklzmwex.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', coalesce(v_secret,'')),
    body := jsonb_build_object('tokens', p_targets, 'title', p_title, 'body', p_body, 'data', p_data)
  );
exception when others then null;
end $$;

-- NOTE ON delivery_assignments: it has offered_at, NOT created_at. The first
-- version of this sweep used da.created_at and threw on every run. It was found
-- by RUNNING the sweep, not by reading it. Run it once before trusting it.

create or replace function public.push_nudge_sweep()
returns json language plpgsql security definer set search_path to 'public'
as $$
declare
  r record; v_targets jsonb;
  v_vendor_max int := 10;   -- ~10 minutes of asking
  v_driver_max int := 6;    -- ~6 minutes, then the dispatcher's escalation owns it
  v_price_max  int := 8;    -- a customer waiting on a price gives up around 30
  v_gap interval := interval '55 seconds';
  v_vendor_sent int := 0; v_driver_sent int := 0; v_price_sent int := 0; v_escalated int := 0;
begin
  ------------------------------------------------------------------
  -- VENDOR: order is due and the kitchen has not accepted it.
  ------------------------------------------------------------------
  for r in
    select o.id, o.restaurant_id, n.attempts
      from orders o
      left join push_nudge n on n.kind = 'vendor_new_order' and n.ref_id = o.id
     where o.kitchen_status = 'new' and o.status = 'pending'
       and coalesce(o.dispatch_at, o.created_at) <= now()
       and o.created_at > now() - interval '45 minutes'
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
      'طلب #' || r.id || ' عدّى ' || v_vendor_max || ' تنبيه من غير قبول — كلّمهم',
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
        'طلب #' || r.order_id || ' معروض عليك لسه — اقبله أو ارفضه',
        jsonb_build_object('order_id', r.order_id, 'kind', 'driver_nudge'));
      v_driver_sent := v_driver_sent + 1;
    end if;
    insert into push_nudge (kind, ref_id, attempts, last_at) values ('driver_offer', r.id, 1, now())
    on conflict (kind, ref_id) do update set attempts = push_nudge.attempts + 1, last_at = now();
  end loop;

  ------------------------------------------------------------------
  -- PRICING: a custom request nobody has quoted. This is the one that
  -- lost order #86 -- the customer sat 33 minutes and gave up.
  ------------------------------------------------------------------
  for r in
    select o.id, rest.name as rname, n.attempts
      from orders o
      join restaurants rest on rest.id = o.restaurant_id
      left join push_nudge n on n.kind = 'pricing_needed' and n.ref_id = o.id
     where o.pricing_status = 'pending_quote'
       and o.status not in ('Cancelled', 'Delivered')
       and o.created_at > now() - interval '45 minutes'
       and (n.last_at is null or n.last_at < now() - v_gap)
       and coalesce(n.attempts, 0) < v_price_max
  loop
    -- admin AND supervisor, the same audience notify_admin uses.
    select coalesce(jsonb_agg(jsonb_build_object('token', pt.token, 'platform', pt.platform)), '[]'::jsonb)
      into v_targets from push_tokens pt join profiles p on p.id = pt.profile_id
     where p.role in ('admin', 'supervisor');
    if jsonb_array_length(v_targets) > 0 then
      perform push_send(v_targets, 'طلب محتاج تسعير 💰',
        'طلب #' || r.id || ' من ' || coalesce(r.rname, '—') || ' لسه مستني سعر',
        jsonb_build_object('order_id', r.id, 'kind', 'pricing_nudge'));
      v_price_sent := v_price_sent + 1;
    end if;
    insert into push_nudge (kind, ref_id, attempts, last_at) values ('pricing_needed', r.id, 1, now())
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
                            and o.pricing_status = 'pending_quote'
                            and o.status not in ('Cancelled','Delivered')));

  return json_build_object('vendor_nudges', v_vendor_sent, 'driver_nudges', v_driver_sent,
                           'pricing_nudges', v_price_sent, 'escalated', v_escalated, 'at', now());
end $$;

select cron.schedule('push-nudge-sweep', '* * * * *', $$select push_nudge_sweep()$$);


-- =====================================================================
-- Verified by execution
-- =====================================================================
-- Dead-token pruning, firing notify_admin at the real dead token:
--   push_send_log    -> ok:false status:404 err:UNREGISTERED
--   dead_push_tokens -> eWkGyokB5VNl... recorded
--   push_tokens      -> 7 rows -> 4 rows (all three copies of one device token)
--   The four remaining were exactly the four FCM confirmed alive.
--
-- Pricing nudge, in a rolled-back transaction:
--   pass1                     -> pricing_nudges:1, push_nudge rows:1
--   pass2 (gap suppresses)    -> pricing_nudges:0
--   after price confirmed     -> pricing_nudges:0, rows_left:0
--   cancelled + unpriced      -> pricing_nudges:0  (never nudged)
--
-- Whole-fleet token check at 13:19 UTC via push-health (validate_only, so
-- nothing was delivered): 5 tokens checked, 5 alive.
