-- Applied to production 2026-08-05. Recorded here because supabase/*.sql is the
-- only place a future session can read what the database actually does -- these
-- three groups were applied through migrations and existed nowhere in the repo.
--
-- See also claude/salka-live-location-2026-08-05.md and
-- claude/salka-driver-apk-and-native-push.md in the project docs.

-- =====================================================================
-- 1. Driver live location
-- =====================================================================
-- A driver's position is only anyone's business while he is carrying food.
-- The gate is here rather than in the client because the client is a web page
-- on the driver's own phone.

create or replace function public.update_my_location(p_lat numeric, p_lng numeric)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare v_driver int;
begin
  v_driver := my_driver_id();
  if v_driver is null then raise exception 'not_a_driver'; end if;

  -- Silently ignore rather than raise. A position arriving a few seconds after
  -- the last delivery completed is a normal race with the 20s reporting tick,
  -- not an error worth showing a driver who has just finished his shift.
  if not exists (
    select 1 from delivery_assignments
     where driver_id = v_driver and status in ('Picked_Up', 'Out_for_Delivery')
  ) then
    return;
  end if;

  update drivers set current_lat = p_lat, current_lng = p_lng, location_updated_at = now()
   where id = v_driver;
end; $$;

-- Called when reporting stops. Without it the last fix stays on the row forever
-- and dispatch watches a pin parked at the previous customer's door all night.
create or replace function public.clear_my_location()
returns void language plpgsql security definer set search_path to 'public'
as $$
declare v_driver int;
begin
  v_driver := my_driver_id();
  if v_driver is null then return; end if;
  update drivers set current_lat = null, current_lng = null, location_updated_at = null
   where id = v_driver;
end; $$;

-- The dispatch board. Exists because PostgREST cannot give the admin screen
-- three things in one shot: the order's line items (order_items for a catalogue
-- order, request_items on the order row for a pharmacy or market basket), the
-- destination coordinates (on the compound, two joins away), and the age of the
-- driver's last fix measured against the SERVER's clock rather than the
-- operator's laptop.
--
-- Full body is live on the database; see admin_live_deliveries() there. It
-- returns one row per delivery_assignment in ('Offered','Accepted','Picked_Up',
-- 'Out_for_Delivery'), gated on is_admin() or is_supervisor().

-- =====================================================================
-- 2. Per-platform push  (drivers were missing orders in the background)
-- =====================================================================
-- A browser must get a DATA-ONLY message -- the service worker draws the banner,
-- and a `notification` block produces either two banners or none; both were
-- shipped and observed (send-push v9-v11). Android needs the opposite: a
-- data-only message is handed to the app process, and when the app is killed
-- there is no process, so nothing is shown. That is exactly the moment a driver
-- misses an order. The two are indistinguishable without this column.

alter table push_tokens add column if not exists platform text not null default 'web';
-- constraint added separately so re-running is safe
--   check (platform in ('web','android','ios'))

-- One row per profile is deliberate: driver_claim_device() already binds a
-- driver account to a single phone, so last device wins. Two live tokens would
-- mean two banners for one order.
drop function if exists save_my_push_token(text);
create or replace function public.save_my_push_token(p_push_token text, p_platform text default 'web')
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_platform not in ('web','android','ios') then raise exception 'bad_platform'; end if;
  insert into push_tokens (profile_id, token, platform, updated_at)
  values (auth.uid(), p_push_token, p_platform, now())
  on conflict (profile_id) do update
    set token = excluded.token, platform = excluded.platform, updated_at = now();
end; $$;

-- Only the three notifiers that can reach a phone running the APK send
-- {token, platform} objects: notify_admin, notify_driver_assignment_change,
-- notify_driver_order_ready. The vendor and customer notifiers are deliberately
-- left sending bare strings, which send-push reads as 'web' -- correct, because
-- those are a tablet browser and a customer's browser. Expressing a fact about
-- three functions in all seven is how a rule starts disagreeing with itself.

-- =====================================================================
-- 3. Deleting a customer
-- =====================================================================
-- Not a DELETE. Customers are referenced from orders, customer_addresses and
-- customer_sessions by foreign key, and by phone from customer_wallets,
-- wallet_transactions, customer_otp_codes and banned_customers. A plain delete
-- either fails on the FK or, with a cascade, silently takes the order history --
-- and with it the day's takings, the drivers' earnings and every refund those
-- orders justify.
--
-- The PERSON goes, the TRANSACTIONS stay. Body is live on the database as
-- admin_delete_customer(p_customer_id int, p_force boolean default false).
--
-- Refuses:
--   customer_has_live_order      -- somebody is still holding their food
--   customer_has_wallet_balance  -- that is money owed; erasing the account
--                                   erases the claim. p_force overrides.
-- Keeps:
--   orders (customer_id nulled, name/phone/total intact -- what the driver was
--           given and what the vendor cooked against)
--   customer_wallets / wallet_transactions -- the ledger behind refunds
--   banned_customers -- a delete that cleared a ban would make "delete me and
--                       sign up again" the documented way around it
--
-- Verified by execution in a rolled-back transaction: all four cases above,
-- plus a driver calling it and getting admin_only.
