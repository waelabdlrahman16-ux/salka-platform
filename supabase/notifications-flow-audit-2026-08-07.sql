-- Applied to production 2026-08-07 evening, after the flow audit.
-- Companion to push-and-supervisor-2026-08-07.sql (same day, earlier).
--
-- Full write-up: claude/salka-flow-audit-2026-08-07.md
--
-- Migrations, in order:
--   nudge_awaiting_payment_and_quote
--   tell_the_kitchen_when_an_order_is_cancelled
--   customer_push_token_platform_and_feedback
--   fix_notify_customer_driver_arrived_undeclared_v_platform
--
-- The last one corrects the third. See the note on it below -- it is the most
-- useful thing in this file.


-- =====================================================================
-- 1. Customers have NEVER received a push. Not rarely. Never.
-- =====================================================================
--   select count(push_token) from orders;   ->  0
--
-- across every order the system has ever held. notify_order_status_change,
-- notify_customer_driver_arrived and the delivered receipt all open with a
-- guard equivalent to `if new.push_token is null then return new; end if;`.
-- That guard has been true 100% of the time, so every customer-facing
-- notification path has been dead code in production since it was written.
--
-- The cause was in the client, not here. Track.tsx called registerPush(),
-- which by design NEVER prompts -- it only refreshes a token when permission
-- is already granted -- and no customer surface anywhere rendered an opt-in
-- button. Permission could not become granted through Salka, so the refresh
-- had nothing to refresh, forever. The button is now on Track.
--
-- THE SAME BUG EXISTED FOR VENDORS. Vendor.tsx also called registerPush() and
-- rendered no button, so six of seven vendor accounts had no token and no way
-- to get one -- كنتاكي, ماكدونالدز, بيتزا هت, إستاكوزا, صيدلية, سوبرماركت,
-- هارت أتاك. "Tell the vendors to enable notifications" was impossible advice.

alter table public.orders
  add column if not exists push_platform text not null default 'web';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_push_platform_check') then
    alter table public.orders add constraint orders_push_platform_check
      check (push_platform in ('web','android','ios'));
  end if;
end $$;

-- Signature change, so the old one must go first: a defaulted third argument
-- would make a two-argument call ambiguous rather than resolving to the
-- default. Same trap as save_my_push_token earlier the same day.
drop function if exists public.save_customer_push_token(uuid, text);

create or replace function public.save_customer_push_token(
  p_token uuid, p_push_token text, p_platform text default 'web')
returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_rows int;
begin
  if p_platform not in ('web','android','ios') then raise exception 'bad_platform'; end if;
  if coalesce(btrim(p_push_token),'') = '' then raise exception 'empty_token'; end if;

  -- A dead token must not be stored here either, or the customer half repeats
  -- exactly the bug the staff half was fixed for this morning.
  if exists (select 1 from dead_push_tokens d where d.token = p_push_token) then
    return json_build_object('stored', false, 'stale', true);
  end if;

  update orders
     set push_token = p_push_token, push_platform = p_platform
   where public_token = p_token;
  get diagnostics v_rows = row_count;

  -- It used to be a bare UPDATE returning void, so a token matching no order
  -- updated zero rows and reported success. The client had no way to know.
  return json_build_object('stored', v_rows > 0, 'stale', false);
end;
$$;

revoke all on function public.save_customer_push_token(uuid, text, text) from public;
grant execute on function public.save_customer_push_token(uuid, text, text) to anon, authenticated;


-- =====================================================================
-- 2. READ BACK WHAT YOU DEPLOYED. A migration that "succeeded" was broken.
-- =====================================================================
-- Both customer notifiers sent a bare token string, which send-push reads as
-- web. They were patched programmatically -- correctly, because their bodies
-- are long and a transcription slip silently stops a customer being told their
-- food is on the way.
--
-- The replacement for notify_customer_driver_arrived referenced a variable
-- `v_platform` that the function never declared. PL/pgSQL resolves variable
-- names at RUN time, not at CREATE time. So:
--
--   * apply_migration returned {"success": true}
--   * the anchor assertion passed -- the text really had changed
--   * the function was broken
--   * and its last line is `exception when others then return new;`, so the
--     undefined-variable error would have been SWALLOWED and the customer
--     simply never told their rider had arrived, with nothing in any log.
--
-- Caught by reading the deployed definition back out of pg_proc instead of
-- trusting the success flag. Do that every time a migration edits a body by
-- string replacement, and then EXECUTE the path -- the fixed version below was
-- verified by firing the real trigger inside a rolled-back transaction and
-- decoding what landed in net.http_request_queue:
--
--   status change tokens: [{"token": "...", "platform": "android"}]
--   arrived tokens      : [{"token": "...", "platform": "android"}]
--   web default tokens  : [{"token": "...", "platform": "web"}]

create or replace function public.notify_customer_driver_arrived()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare v_secret text; v_token text; v_platform text;
begin
  if new.arrived_at_customer_at is null then return new; end if;
  if old.arrived_at_customer_at is not null then return new; end if;

  select push_token, coalesce(push_platform, 'web')
    into v_token, v_platform
    from orders where id = new.order_id;
  if v_token is null then return new; end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'push_webhook_secret';

  perform net.http_post(
    url := 'https://pqpnwxyevrsipklzmwex.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', coalesce(v_secret,'')),
    body := jsonb_build_object(
      'tokens', jsonb_build_array(jsonb_build_object('token', v_token, 'platform', v_platform)),
      'title', 'سالكة',
      'body',  'المندوب وصل عندك 🛵 — انزل أو كلّمه',
      'data',  jsonb_build_object('order_id', new.order_id))
  );
  return new;
exception when others then
  return new;
end $$;

-- notify_order_status_change got the same treatment; its send now reads
--   jsonb_build_array(jsonb_build_object('token', new.push_token,
--                                        'platform', coalesce(new.push_platform, 'web')))
-- and it declared no stray variable, so it was correct as patched.


-- =====================================================================
-- 3. Nobody told the KITCHEN an order was cancelled
-- =====================================================================
-- A cancellation notified the admin, the customer and the driver. It never
-- notified the one party with food on the grill. That is not a notification
-- gap, it is unrecovered food cost on every cancellation after acceptance.
--
-- Guarded on the kitchen having actually started: a cancellation while
-- kitchen_status is still 'new' costs the vendor nothing, and telling them is
-- noise -- which is how a vendor learns to ignore the banner that matters.
--
-- Verified by firing real updates in a rolled-back transaction and counting
-- what reached net.http_request_queue:
--   kitchen never started -> 1 request  (admin only)
--   kitchen preparing     -> 2 requests (admin + vendor)

create or replace function public.notify_admin_order_trouble()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare v_tokens jsonb;
begin
  if new.status = 'Cancelled' and old.status is distinct from 'Cancelled' then
    perform notify_admin('طلب اتلغى ❌',
      'طلب #' || new.id || ' اتلغى — ' || coalesce(new.cancel_reason,'من غير سبب'),
      jsonb_build_object('order_id', new.id, 'kind', 'cancelled'));

    if coalesce(old.kitchen_status, 'new') <> 'new' or old.vendor_accepted_at is not null then
      select coalesce(jsonb_agg(jsonb_build_object('token', pt.token, 'platform', pt.platform)), '[]'::jsonb)
        into v_tokens
        from push_tokens pt join profiles p on p.id = pt.profile_id
       where p.role = 'vendor' and p.restaurant_id = new.restaurant_id;
      if jsonb_array_length(v_tokens) > 0 then
        perform push_send(v_tokens, 'وقّف التحضير ⛔',
          'طلب #' || new.id || ' اتلغى — بطّل تحضيره',
          jsonb_build_object('order_id', new.id, 'kind', 'vendor_cancelled'));
      end if;
    end if;

  elsif new.pricing_status = 'pending_quote'
        and old.pricing_status is distinct from 'pending_quote' then
    perform notify_admin('طلب محتاج تسعير 💰',
      'طلب #' || new.id || ' مستني السعر',
      jsonb_build_object('order_id', new.id, 'kind', 'pending_quote'));
  end if;
  return new;
exception when others then
  return new;
end;
$$;


-- =====================================================================
-- 4. push_nudge_sweep: two more states that die quietly
-- =====================================================================
-- #86 died at pending_quote (covered this morning). #87 died at
-- awaiting_payment: created 14:46, exactly ONE push ever fired for it, and it
-- was manually cancelled at 15:22 after the customer abandoned a 798 ج.م
-- deposit. Nothing repeated, because the vendor loop keys on status='pending'
-- and the pricing loop on pricing_status='pending_quote'. check_late_unclaimed
-- _orders does not cover it either -- is_predispatch_status excludes it. The
-- only thing that saw it was the passive stalled_orders list, at 30 minutes.
--
-- The actionable party for an unpaid order is NOT the customer: guests have no
-- push token, and orders.push_token was null on #87. It is whoever can pick up
-- a phone. So this pages admin + supervisor, with the amount and the number.
--
-- The full function body is in push_nudge_sweep(); see
-- push-and-supervisor-2026-08-07.sql for the vendor and driver loops, which
-- are unchanged. The two additions are:
--
--   PRICING loop, widened -- awaiting_quote and pending_quote are the same
--   fact recorded twice, and an order carrying only one of them was invisible:
--     where (o.pricing_status = 'pending_quote' or o.status = 'awaiting_quote')
--
--   PAYMENT loop, new -- starts at 3 minutes, not immediately, because a
--   transfer takes a couple of minutes to actually do and paging staff about
--   an order the customer is mid-way through paying for trains them to ignore
--   the alert. Two different jobs behind one status: if instapay_claimed_at is
--   set the ball is ours (confirm it), otherwise the ball is theirs (ring them).
--     where o.status = 'awaiting_payment'
--       and o.created_at <= now() - interval '3 minutes'
--       and o.created_at >  now() - interval '45 minutes'
--       and coalesce(n.attempts, 0) < 6
--
-- Housekeeping deletes a payment_needed row as soon as the order leaves
-- awaiting_payment, so paying, cancelling or switching to cash all stop it.
--
-- Verified in a rolled-back transaction, seven assertions:
--   C1 fires once       : 1  rows=1
--   C2 gap suppresses   : 0
--   C3 under 3min quiet : 0
--   C4 claimed fires    : 1
--   C5 after paid       : payment=0 rows_left=0
--   C6 awaiting_quote   : 1
--   C7 cancelled quiet  : payment=0 pricing=0 rows=0
