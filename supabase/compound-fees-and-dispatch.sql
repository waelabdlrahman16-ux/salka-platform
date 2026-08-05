-- Applied to project pqpnwxyevrsipklzmwex on 2026-08-05, via Supabase migrations.
--
-- Recorded here because the repo's supabase/*.sql has drifted badly from what is
-- deployed: delivery_quote, restaurants_for_compound, service_fee_percent and
-- the current 14-argument submit_custom_order appear nowhere in it. This file
-- does not close that gap, it just refuses to widen it.
--
-- Three changes, in the order they were applied.

-- ---------------------------------------------------------------------------
-- 1. Delivery is priced per compound, not by distance band
-- ---------------------------------------------------------------------------
-- Five bands in `settings` meant 20 of the 62 compounds shared one 350 ج.م
-- price across an 11 km spread, and no single place could be corrected without
-- moving every other place in its band.

alter table compounds add column if not exists delivery_fee numeric;

update compounds
   set delivery_fee = delivery_fee_for_distance(distance_km)
 where delivery_fee is null;

alter table compounds alter column delivery_fee set not null;

alter table compounds drop constraint if exists compounds_delivery_fee_nonneg;
alter table compounds add constraint compounds_delivery_fee_nonneg check (delivery_fee >= 0);

-- A compound added from the dashboard must never arrive priced at 0. The bands
-- survive for exactly this: seeding, not pricing.
create or replace function public.compound_fee_default()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.delivery_fee is null then
    new.delivery_fee := coalesce(delivery_fee_for_distance(new.distance_km), 0);
  end if;
  return new;
end $$;

drop trigger if exists trg_compound_fee_default on compounds;
create trigger trg_compound_fee_default
  before insert on compounds
  for each row execute function public.compound_fee_default();

-- distance_km is still returned: sla_minutes_for_distance() derives the SLA
-- from it. Nothing prices on it any more, and no screen shows it beside a fee.
create or replace function public.delivery_quote(p_compound_id integer)
returns json language sql stable security definer set search_path to 'public' as $$
  select json_build_object(
    'compound_id',   c.id,
    'compound_name', c.name,
    'distance_km',   c.distance_km,
    'delivery_fee',  c.delivery_fee,
    'sla_minutes',   sla_minutes_for_distance(c.distance_km)
  )
  from compounds c
  where c.id = p_compound_id;
$$;

-- place_order, request_pickup and BOTH submit_custom_order overloads each held
-- the same three lines:
--
--   select distance_km into v_km from compounds where id = p_compound_id;
--   if v_km is null then raise exception 'compound_missing_distance'; end if;
--   v_fee := delivery_fee_for_distance(v_km);
--
-- rewritten in place to:
--
--   select distance_km, delivery_fee into v_km, v_fee from compounds where id = p_compound_id;
--   if v_km is null then raise exception 'compound_missing_distance'; end if;
--   if v_fee is null then raise exception 'compound_missing_fee'; end if;
--
-- Done by a DO block reading pg_get_functiondef and replacing the literal, so
-- no 200-line body was retyped by hand. It asserted the pattern was present in
-- each function and that exactly four were rewritten.

create or replace function public.admin_set_compound_fee(
  p_compound_id integer,
  p_fee numeric
) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  if p_fee is null or p_fee < 0 then raise exception 'invalid_fee'; end if;
  if p_fee > 2000 then raise exception 'fee_too_large'; end if;
  update compounds set delivery_fee = round(p_fee) where id = p_compound_id;
  if not found then raise exception 'compound_not_found'; end if;
end $$;

-- Supabase's default privileges re-grant anon on every newly created function,
-- so the revoke has to name anon as well as public. Revoking from
-- anon/authenticated alone is the no-op documented in the handoff; revoking
-- from public alone leaves this explicit anon grant behind.
revoke execute on function public.admin_set_compound_fee(integer, numeric) from public;
revoke execute on function public.admin_set_compound_fee(integer, numeric) from anon;
grant  execute on function public.admin_set_compound_fee(integer, numeric) to authenticated;

update settings set value = '8' where key = 'service_fee_percent';   -- was 15

-- ---------------------------------------------------------------------------
-- 2. Dispatch guards
-- ---------------------------------------------------------------------------
-- One order had eight repeat assignments. Nothing stopped it: the assign modal
-- had no in-flight guard (unlike reassign), driver_reject_assignment puts the
-- order straight back to 'pending', and the candidate list excluded nobody who
-- had already declined. The only signal was an advisory line that disappears
-- once the rejected row falls outside the admin screen's 400-row window.
--
-- All three guards are server-side. A client-side fix would be the same bug
-- one layer up.

create or replace function public.admin_assign_order(
  p_order_id integer,
  p_driver_id integer,
  p_force boolean default false
) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_active boolean; v_attempt int; v_open int; v_declined int; v_status text;
begin
  if not is_admin() then raise exception 'admin_only'; end if;

  select status into v_status from orders where id = p_order_id for update;
  if v_status is null then raise exception 'order_not_found'; end if;
  if v_status in ('Delivered','Cancelled') then raise exception 'order_closed'; end if;

  select active into v_active from drivers where id = p_driver_id;
  if v_active is null then raise exception 'driver_not_found'; end if;
  if not v_active then raise exception 'driver_suspended'; end if;

  if (select coalesce(pricing_status, 'n/a') from orders where id = p_order_id) = 'pending_quote' then
    raise exception 'order_not_priced';
  end if;

  select count(*) into v_open from delivery_assignments
   where order_id = p_order_id
     and status in ('Offered','Accepted','Picked_Up','Out_for_Delivery');
  if v_open > 0 then raise exception 'already_assigned'; end if;

  select count(*) into v_declined from delivery_assignments
   where order_id = p_order_id and driver_id = p_driver_id
     and status in ('Rejected','Cancelled');
  if v_declined > 0 and not p_force then raise exception 'driver_already_declined'; end if;

  select coalesce(max(attempt_number),0) + 1 into v_attempt
    from delivery_assignments where order_id = p_order_id;

  if v_attempt > 5 and not p_force then raise exception 'too_many_attempts'; end if;

  if not driver_can_take_order(p_driver_id, p_order_id) then
    raise exception 'dispatch_rule_blocked';
  end if;

  insert into delivery_assignments (order_id, driver_id, attempt_number, status, offered_at)
  values (p_order_id, p_driver_id, v_attempt, 'Offered', now());
end $$;

revoke execute on function public.admin_assign_order(integer, integer, boolean) from public;
revoke execute on function public.admin_assign_order(integer, integer, boolean) from anon;
grant  execute on function public.admin_assign_order(integer, integer, boolean) to authenticated;

-- The old two-argument signature would otherwise stay resolvable and unguarded.
-- PostgREST resolves the client's existing two named arguments to the new
-- function's defaulted third, so no caller had to change.
drop function if exists public.admin_assign_order(integer, integer);

-- Note: cancel_order() needed no change. Its guard has always been
-- `if v_status <> 'pending' and not is_admin()`, so an admin could always
-- cancel at any status -- there was simply no button anywhere that called it.

-- ---------------------------------------------------------------------------
-- 3. "Driver has arrived" notification
-- ---------------------------------------------------------------------------
alter table delivery_assignments
  add column if not exists arrived_at_customer_at timestamptz;

create or replace function public.driver_arrived_at_customer(p_assignment_id integer)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_driver int; v_status text; v_already timestamptz;
begin
  v_driver := my_driver_id();
  if v_driver is null then raise exception 'not_a_driver'; end if;

  select status, arrived_at_customer_at into v_status, v_already
    from delivery_assignments where id = p_assignment_id and driver_id = v_driver;
  if v_status is null then raise exception 'not_your_assignment'; end if;
  if v_status <> 'Out_for_Delivery' then raise exception 'wrong_stage'; end if;
  if v_already is not null then return; end if;   -- idempotent: no second push

  update delivery_assignments set arrived_at_customer_at = now() where id = p_assignment_id;
end $$;

revoke execute on function public.driver_arrived_at_customer(integer) from public;
revoke execute on function public.driver_arrived_at_customer(integer) from anon;
grant  execute on function public.driver_arrived_at_customer(integer) to authenticated;

-- Modelled on notify_order_status_change: same Vault secret, same swallow-all
-- exception block, so a push outage can never roll back the driver's update.
create or replace function public.notify_customer_driver_arrived()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_secret text; v_token text;
begin
  if new.arrived_at_customer_at is null then return new; end if;
  if old.arrived_at_customer_at is not null then return new; end if;

  select push_token into v_token from orders where id = new.order_id;
  if v_token is null then return new; end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'push_webhook_secret';

  perform net.http_post(
    url := 'https://pqpnwxyevrsipklzmwex.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', coalesce(v_secret,'')),
    body := jsonb_build_object(
      'tokens', jsonb_build_array(v_token),
      'title', 'سالكة',
      'body',  'المندوب وصل عندك 🛵 — انزل أو كلّمه',
      'data',  jsonb_build_object('order_id', new.order_id))
  );
  return new;
exception when others then
  return new;
end $$;

drop trigger if exists trg_notify_customer_driver_arrived on delivery_assignments;
create trigger trg_notify_customer_driver_arrived
  after update of arrived_at_customer_at on delivery_assignments
  for each row execute function public.notify_customer_driver_arrived();

-- ---------------------------------------------------------------------------
-- 4. Un-reviewed vendors stop claiming 5.0
-- ---------------------------------------------------------------------------
create or replace function public.restaurants_for_compound(p_compound_id integer)
returns json language sql stable security definer set search_path to 'public' as $$
  select coalesce(json_agg(row_to_json(x)), '[]'::json) from (
    select r.*, coalesce(rc.n, 0)::int as review_count
      from restaurants r
      left join (
        select o.restaurant_id, count(*)::int as n
          from order_ratings rt
          join orders o on o.id = rt.order_id
         where rt.restaurant_rating is not null
         group by o.restaurant_id
      ) rc on rc.restaurant_id = r.id
     where not r.archived and vendor_covers_compound(r.id, p_compound_id)
     order by r.is_open desc nulls last,
              (coalesce(rc.n, 0) > 0) desc,
              case when coalesce(rc.n, 0) > 0 then r.rating end desc nulls last,
              r.name
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- Verified in a rolled-back transaction against production, 2026-08-05
-- ---------------------------------------------------------------------------
-- place_order for 2 x a 100 ج.م item into compound 93, with the client sending
-- p_delivery_fee = 9999:
--
--   subtotal 200 · delivery_fee 65 · service_fee 16 · total 281
--
-- 65 is compound 93's own fee (the 9999 was ignored, as it must be), 16 is 8%
-- of 200, and 281 is the sum. The DO block ended in `raise exception`, so
-- nothing was committed -- orders is still at the one live row that was there
-- before.

-- ---------------------------------------------------------------------------
-- 5. pickup_request orders are born ready  (applied 2026-08-05, later)
-- ---------------------------------------------------------------------------
-- driver_mark_picked_up requires orders.kitchen_status = 'ready'. Only
-- vendor_accept_order and vendor_ready write that column, both gated on
-- my_restaurant_id() -- and a pickup_request vendor's screen returns early
-- before the kitchen board mounts, so neither button exists for exactly the
-- vendors whose orders need them. Admin has no kitchen control at all. The
-- order sat at 'new' forever: claimable, arrivable-at, and then permanently
-- stuck on `order_not_ready` with no actor anywhere able to clear it. Admin
-- cancellation was the only exit.
--
-- Not fixed with another button. A pickup request has no kitchen stage by
-- definition -- the food already exists, that is the premise of "طلب مندوب
-- لأوردر مش من سالكة" -- so it is ready at creation. request_pickup's INSERT
-- now names kitchen_status and passes 'ready', applied by the same
-- read-definition-and-replace DO block used above.
--
--   ... order_type, request_notes, pricing_status, kitchen_status)
--   ... 'pickup_request', coalesce(p_request_notes,''), 'n/a', 'ready')
--
-- Plus a backfill for any row the bug had already stranded (none existed --
-- no pickup_request vendor is live yet, which is why nobody had hit it).

-- ===========================================================================
-- 6. Failed delivery, force-close, vendor gate, payment-wall exit, refunds
--    (applied 2026-08-05, third batch)
-- ===========================================================================
-- Summarised; full bodies are live in the project. Each is a CREATE OR REPLACE.
--
-- driver_report_problem(assignment, reason)  NEW
--   delivery_assignments.delivery_problem_reason added. The only escalation a
--   driver had was driver_report_no_answer, gated behind driver_called_customer
--   and a five-minute wait. A wrong address, a customer refusing the order, a
--   gate that will not let them in -- none of those are "no answer", so the
--   honest driver's only route to admin was to claim a call they had not made.
--   Reuses no_answer_reported_at as the escalation flag so admin watches ONE
--   queue, not two.
--
-- admin_resolve_no_answer(assignment, action)  CHANGED
--   'cancel' called mark_delivery_failed, which sets Failed_Delivery, pays the
--   driver 10 and stops -- it never touched refund_status and never returned
--   wallet credit. A customer who paid by InstaPay and was not home lost the
--   money silently, under a button reading "إلغاء الطلب". Now:
--     'fail'   -> mark_delivery_failed  (driver paid, no refund)
--     'refund' -> cancel_order          (wallet returned, refund flagged)
--   'cancel' kept as an alias for 'fail' so an un-deployed client is unchanged.
--
-- admin_force_delivered(order, reason, cash_collected)  NEW
--   mark_delivered is gated on my_driver_id(), so a driver whose phone dies
--   mid-round stranded the order permanently. Mirrors mark_delivered rather
--   than just setting the status -- the earnings row and the cash now sitting
--   in the driver's pocket are the whole reason the transition exists.
--   p_cash_collected exists because whether money changed hands is the one
--   thing an admin cannot see from a desk.
--
-- vendor_accept_order / vendor_ready  CHANGED
--   Both now raise order_not_priced while pricing_status = 'pending_quote'.
--   A pharmacy ticket reaches the vendor before admin has phoned the customer
--   with a price; they could accept it and mark it ready, and it then sat going
--   cold because claim_order and admin_assign_order both refuse an unpriced
--   order. The kitchen was doing work the dispatcher was forbidden to collect.
--
-- cancel_order  CHANGED
--   Guard widened from `v_status <> 'pending'` to
--   `v_status not in ('pending','awaiting_payment')`. An InstaPay or deposit
--   order is CREATED at awaiting_payment, so cancelling was impossible from the
--   very first screen the customer saw. Nothing has been confirmed received in
--   that state, so there is nothing to protect by refusing; where the customer
--   had already declared a transfer, the existing refund_status branch flags it.
--
-- admin_pending_refunds()  NEW
--   The refunds list lived inside the الشكاوى tab and printed o.total as the
--   amount -- but a COD order only ever took the 50% deposit, so that figure was
--   roughly double. refund_amount is now computed server-side, and it is its own
--   admin tab with a count badge.
--
-- track_order  CHANGED
--   Now selects cancel_reason, cancelled_at and refund_status. A cancelled order
--   told the customer "تم إلغاء الطلب" and nothing else -- not why, and not that
--   they were owed money, while an admin looked at the same row in a queue.

-- ===========================================================================
-- 7. Four new order statuses (applied 2026-08-05, fourth batch)
-- ===========================================================================
-- Driven by a photograph of a real pharmacy order: status='pending' rendered as
-- "قيد التجهيز" with "الوصول المتوقع 7:15 ص" and an SLA of 7:20, for an order
-- with no price, no vendor acceptance and no driver. Nothing was being
-- prepared. The lifecycle had no way to say "waiting for a price", so it
-- borrowed the label of the state next door.
--
-- The four are REFINEMENTS of the pre-dispatch window, not a new vocabulary:
--
--   awaiting_quote    custom_request created, admin has not phoned a price yet
--   Scheduled         slot order, not due to move yet
--   pending           dispatchable; just placed / kitchen working
--   Driver_Searching  in the pool, nobody has taken it
--   No_Driver_Found   in the pool past escalate_after_minutes; needs a human
--
-- is_predispatch_status(text) defines the set once. Everything that tested
-- `status = 'pending'` as "in the dispatch window" now calls it:
-- available_orders, claim_order, check_late_unclaimed_orders.
--
-- Transitions
--   submit_custom_order        -> awaiting_quote  (was taking the column default)
--   confirm_custom_order_price -> Scheduled if not due, else pending
--   place_order                -> Scheduled when dispatch_at is in the future
--   cron, every 30s            Scheduled -> pending -> Driver_Searching -> No_Driver_Found
--   driver_reject_assignment   -> Driver_Searching, and only from a pre-dispatch
--                                 status (it used to reset ANY status to pending)
--   admin_unassign_order       -> Driver_Searching
--
-- All three clock-driven transitions were folded into the existing
-- check_late_unclaimed_orders job rather than added as new pg_cron entries.
-- Three jobs on the same clock would race each other over the same rows.
--
-- stalled_orders: Scheduled is excluded outright (not stalled, not due), which
-- retires the dispatch_at special case that existed only to stop slot orders
-- being reported as stuck. awaiting_quote gets the payment threshold, because
-- the actor who unblocks it is us. Driver_Searching gets escalate_after_minutes.
--
-- Cancellation, restated. Decision from Wael, 2026-08-05: the customer may
-- cancel until the VENDOR ACCEPTS; after that the vendor is spending money and
-- it goes through admin. Previously the customer's button survived until a
-- DRIVER appeared, so the Track page offered "إلغاء الطلب" directly beneath a
-- heading saying the order was being cooked. cancel_order now checks
-- is_customer_cancellable_status(status) AND kitchen_status = 'new' for a
-- customer, a wider pre-dispatch set for a vendor declining their own order,
-- and nothing for an admin. track_order exposes kitchen_status so the button
-- and the server agree.

-- ===========================================================================
-- 8. The driver supervisor role (applied 2026-08-05, fifth batch)
-- ===========================================================================
-- Restaurants are not logging into the vendor screen, so a Salka staff member
-- phones them and works the order on their behalf, and also runs dispatch.
-- Decisions from Wael, 2026-08-05: they may accept + mark ready on the
-- restaurant's behalf, assign/unassign/reassign drivers, cancel a restaurant
-- order, and resolve driver escalations. They may NOT confirm payments, settle
-- driver cash or earnings, issue refunds, quote a pharmacy order, or see the
-- pharmacy and supermarket at all.
--
-- Built on the `catalog` template named in the handoff.
--
--   profiles_role_check           gains 'supervisor'
--   is_supervisor()               true for supervisor OR admin
--   supervisor_may_touch_order()  the remit limit, defined ONCE. True for an
--                                 admin unconditionally; for a supervisor only
--                                 when order_type='catalog' and the vendor is
--                                 not a pharmacy or supermarket.
--
-- Every dispatch RPC had `if not is_admin() then raise exception 'admin_only'`.
-- Each was rewritten -- by textual replacement, so no body was retyped -- to
-- call supervisor_may_touch_order() instead: admin_assign_order,
-- admin_unassign_order, admin_reassign_order, admin_resolve_no_answer,
-- admin_force_delivered, mark_delivery_failed. cancel_order treats a supervisor
-- as admin-equivalent for a catalog order. vendor_accept_order and vendor_ready
-- accept EITHER the owning vendor or a supervisor -- one function per
-- transition, not a supervisor_* twin that would drift.
--
-- RLS gives the role select on orders (catalog restaurant only), order_items,
-- delivery_assignments, drivers, restaurants, compounds. Deliberately NOT
-- granted: wallet_transactions, customer_wallets, driver_earnings,
-- driver_settlements, settlement_requests, settings, profiles, order_ratings,
-- complaints. A supervisor who can read driver_earnings can reconstruct the
-- day's takings.
--
-- notify_admin() now fans out to role in ('admin','supervisor'). Every
-- operational alert goes through it -- new order, unclaimed after 30s, driver
-- escalation, new complaint -- and the supervisor is the person who acts on all
-- four at 1am. A role that cannot be paged cannot do the job.
--
-- VERIFIED BY EXECUTION, in a rolled-back transaction, as a real supervisor
-- (an existing driver profile temporarily promoted):
--
--   is_supervisor=true | is_admin=false
--   catalog_order_1=true | pharmacy_order_4=false
--   rls_visible_orders=6,7,1          <- the pharmacy orders 4 and 5 are gone
--   instapay=blocked(admin_only)
--   settle_cash=blocked(admin_only)
--   pharmacy_quote=blocked(not_authorized)
--   unassign_pharmacy=blocked(admin_only)
--
-- Account creation: admin-accounts gained a create_supervisor_login action in
-- the repo, and assertTargetIsStaff() gained 'supervisor' -- without that
-- second change you can create the account and then never reset its password
-- or delete it, which is the trap the existing comment already warns about for
-- catalog. That function has NOT been redeployed (doing so from the agent
-- session would mean hand-copying 15KB of auth code into a tool call, and a
-- transcription slip there changes production authentication silently). Until
-- it is deployed, the supported path is: create a catalog login in the existing
-- UI, then press «خلّيه مشرف تشغيل», which calls admin_convert_staff_role() --
-- narrow by construction: it moves a profile between 'catalog' and
-- 'supervisor' only, refuses any other role, and refuses the caller's own row.
