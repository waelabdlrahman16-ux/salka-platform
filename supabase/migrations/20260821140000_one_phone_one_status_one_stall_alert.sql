-- Three hygiene defects found by the 21 Aug 2026 audit, none of which was
-- costing money today, all of which quietly corrupt what the data can tell us.
--
--   1. orders.customer_phone is the only phone column in the database that is
--      not bare 10 digits, so the same human can exist twice.
--   2. orders.status is free text, so a typo in any function writes a status
--      nothing recognises and nothing complains.
--   3. Orders stalled waiting for a price or a payment are visible on a screen
--      but nobody is told, so two sat for two hours on 21 Aug.


-- ---------------------------------------------------------------------------
-- 1. One phone format
-- ---------------------------------------------------------------------------
-- Every other phone column -- customers.phone, customer_wallets.phone,
-- customer_otp_codes.phone -- is already the bare 10-digit form, and every
-- function that joins across them wraps orders.customer_phone in
-- normalize_phone() to bridge the gap. orders is the only column that
-- disagrees with itself: on 21 Aug, 33 of 264 rows carried a leading zero and
-- 231 did not.
--
-- This is a trigger rather than an edit to place_order / submit_custom_order /
-- request_pickup / staff_create_pickup_order because that is four function
-- replacements versus one object -- and because the trigger also catches the
-- admin portal and any write path added later.
--
-- The guard matters more than the normalisation. `^1[0-25][0-9]{8}$` is the
-- SAME regex place_order and six other functions already validate against, so
-- this introduces no second opinion about what a phone is. Anything that is
-- not an Egyptian mobile -- a foreign number, a test string -- is stored
-- exactly as typed. A blind last-10-digits rewrite would have turned the
-- Saudi-format number on order 252 into an ambiguous local one and
-- 'TEST-BATCH18' into '18'.
create or replace function private.orders_canonical_phone()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_norm text;
begin
  v_norm := normalize_phone(new.customer_phone);
  if v_norm ~ '^1[0-25][0-9]{8}$' then
    new.customer_phone := v_norm;
  end if;
  return new;
end $$;

drop trigger if exists orders_canonical_phone on orders;
create trigger orders_canonical_phone
  before insert or update of customer_phone on orders
  for each row execute function private.orders_canonical_phone();

-- Backfill. Same guard, so the same two rows are left alone:
--   112  'TEST-BATCH18'  -- audit leftover, 0.00 EGP, is_test
--   252  '05555586474'   -- real delivered order, not an Egyptian mobile
-- Lossless: this only strips a leading 0 / 20 / +20, so the prior value is
-- recoverable as '0' || customer_phone for every row it touches.
update orders
   set customer_phone = normalize_phone(customer_phone)
 where normalize_phone(customer_phone) ~ '^1[0-25][0-9]{8}$'
   and customer_phone <> normalize_phone(customer_phone);


-- ---------------------------------------------------------------------------
-- 2. One set of statuses
-- ---------------------------------------------------------------------------
-- src/lib/statusLabels.ts has carried the canonical list of twelve for a
-- while; the database has never enforced it. The mixed casing is inherited
-- and deliberately preserved -- 'Delivered' and 'awaiting_payment' really do
-- differ, and renaming them is a much larger change than this one.
--
-- The value of the constraint is not the twelve names. It is that a typo in
-- any of the ~40 functions that set a status currently writes silently and
-- the order simply disappears from every screen that filters on status.
alter table orders drop constraint if exists orders_status_known;
alter table orders add constraint orders_status_known check (
  status in (
    'awaiting_payment', 'awaiting_quote', 'Scheduled', 'pending',
    'Driver_Searching', 'No_Driver_Found', 'Accepted', 'Picked_Up',
    'Out_for_Delivery', 'Delivered', 'Cancelled', 'Failed_Delivery'
  )
);


-- ---------------------------------------------------------------------------
-- 3. Somebody is told when an order stalls
-- ---------------------------------------------------------------------------
-- check_late_unclaimed_orders() already pushes for two cases: an errand no
-- vendor has accepted, and a dispatchable order no driver has claimed. Both
-- loops are gated on is_predispatch_status(), which covers pending, Scheduled,
-- Driver_Searching and No_Driver_Found.
--
-- It therefore cannot fire for awaiting_quote or awaiting_payment. Those are
-- exactly the states where the order is waiting on *us*. On 21 Aug orders 956
-- and 957 sat in awaiting_quote for two hours and no phone rang.
--
-- This drives off stalled_orders() rather than re-deriving the thresholds.
-- That function already knows the per-status reference time and reads
-- stall_quote_minutes / stall_payment_minutes from settings, so the admin
-- panel and the alert cannot drift apart -- which is the failure mode the
-- audit found four times over elsewhere.
alter table orders add column if not exists stall_alert_sent_at timestamptz;

comment on column orders.stall_alert_sent_at is
  'When the waiting-on-us stall alert was pushed, so it fires once per order.';

create or replace function public.alert_stalled_orders()
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_row record;
begin
  for v_row in
    select s.id, s.status, s.vendor_name, s.minutes_stalled
      from stalled_orders() s
      join orders o on o.id = s.id
     where s.status in ('awaiting_quote', 'awaiting_payment')
       and o.stall_alert_sent_at is null
  loop
    perform notify_admin(
      case v_row.status
        when 'awaiting_quote' then 'طلب مستني تسعير 💰'
        else 'طلب مستني دفع 💳'
      end,
      'طلب #' || v_row.id || ' في ' || coalesce(v_row.vendor_name, '')
        || ' — مستني من ' || v_row.minutes_stalled || ' دقيقة',
      jsonb_build_object('order_id', v_row.id, 'type', 'stalled_on_us',
                         'order_status', v_row.status));
    update orders set stall_alert_sent_at = now() where id = v_row.id;
  end loop;
end $$;

revoke all on function public.alert_stalled_orders() from public, anon, authenticated;

-- Every minute, matching push_nudge_sweep. stalled_orders() already applies the
-- threshold, so this only pushes once the order is genuinely late.
select cron.unschedule('alert-stalled-orders')
 where exists (select 1 from cron.job where jobname = 'alert-stalled-orders');

select cron.schedule('alert-stalled-orders', '* * * * *',
                     $cron$select public.alert_stalled_orders();$cron$);
