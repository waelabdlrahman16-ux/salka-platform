-- Finishing «فكّرني لما يفتح»: the part that actually sends it, and every state
-- a queued reminder can be in.
--
-- A reminder row has four possible fates, and until now only two existed:
--   pending   -> waiting for the vendor to open
--   sent      -> notified_at set, never sent again
--   expired   -> asked 48h ago and the shop still has not opened. Sending then
--                is worse than silence: the customer has forgotten asking, and
--                a notification about a craving two days old is spam.
--   dead      -> the token is in dead_push_tokens. FCM already told us this
--                device is gone; sending to it wastes a call and hides real
--                failures in the logs.

-- The platform has to be stored, not looked up. Customer push tokens live on
-- the ORDER row (save_customer_push_token takes an order token), so a customer
-- browsing the home screen with no order has no central record to join to.
alter table public.vendor_open_reminders
  add column if not exists platform text not null default 'web'
    check (platform in ('web','android','ios'));

comment on column public.vendor_open_reminders.platform is
  'Stored rather than joined: browsing customers have no push_tokens row -- that table is staff, and customer tokens hang off orders.';

create or replace function public.notify_vendor_open_reminders()
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_targets jsonb;
  v_sent int := 0; v_people int := 0; v_expired int := 0; v_dead int := 0;
begin
  -- EXPIRED first, so an old row can never be picked up by the send below.
  with gone as (
    delete from vendor_open_reminders
     where notified_at is null and created_at < now() - interval '48 hours'
     returning 1
  ) select count(*) into v_expired from gone;

  -- DEAD tokens: drop rather than carry. FCM has already reported these.
  with dead as (
    delete from vendor_open_reminders vr
     where vr.notified_at is null
       and vr.push_token is not null
       and exists (select 1 from dead_push_tokens d where d.token = vr.push_token)
     returning 1
  ) select count(*) into v_dead from dead;

  -- One notification per vendor that is now open, to everyone waiting on it.
  for r in
    select vr.restaurant_id, rest.name,
           jsonb_agg(jsonb_build_object('token', vr.push_token, 'platform', vr.platform)) as targets,
           count(*) as people
      from vendor_open_reminders vr
      join restaurants rest on rest.id = vr.restaurant_id
     where vr.notified_at is null
       and vr.push_token is not null
       and vendor_is_open_now(vr.restaurant_id)
     group by vr.restaurant_id, rest.name
  loop
    perform push_send(
      r.targets,
      r.name || ' فتح 🎉',
      'قولت نفكّرك لما يفتح — إحنا جاهزين نجيبلك طلبك دلوقتي.',
      jsonb_build_object('type', 'vendor_open', 'restaurant_id', r.restaurant_id,
                         'url', '/restaurant/' || r.restaurant_id)
    );
    -- Marked immediately, in the same transaction as the send. push_send
    -- swallows its own errors by design, so waiting for confirmation would mean
    -- waiting forever and re-notifying every minute in the meantime.
    update vendor_open_reminders
       set notified_at = now()
     where restaurant_id = r.restaurant_id and notified_at is null;

    v_sent := v_sent + 1;
    v_people := v_people + r.people;
  end loop;

  -- Sent rows are kept for a week so «✓ هنفكّرك» can still be shown to someone
  -- who has not reloaded, then cleared.
  delete from vendor_open_reminders
   where notified_at is not null and notified_at < now() - interval '7 days';

  return json_build_object('vendors_notified', v_sent, 'people_notified', v_people,
                           'expired', v_expired, 'dead_tokens_dropped', v_dead);
end $$;

revoke all on function public.notify_vendor_open_reminders() from public, anon, authenticated;

-- Every minute, on the sweep that already exists for this kind of work.
select cron.schedule(
  'vendor-open-reminders',
  '* * * * *',
  $cron$select public.notify_vendor_open_reminders();$cron$
);
