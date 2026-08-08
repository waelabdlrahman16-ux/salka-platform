-- Applied to production 2026-08-07 evening. Third file from that day; see also
-- push-and-supervisor-2026-08-07.sql and notifications-flow-audit-2026-08-07.sql.
--
-- Recorded here because push-and-supervisor-2026-08-07.sql opens by stating the
-- rule -- "supabase/*.sql is the only place a future session can read what the
-- database actually does" -- and then three more objects were deployed without
-- being written down. A review caught it. The rule only works if it is followed
-- on the day.
--
-- Migrations:
--   admin_daily_report
--   fix_admin_daily_report_nested_aggregate      (corrects the one above)
--   restaurant_display_order_and_featured
--   push_tokens_one_row_per_device
--   cap_push_tokens_per_profile                  (closes a hole the one above opened)
--   cap_push_tokens_deterministic_tiebreak


-- =====================================================================
-- 1. push_tokens: one row per DEVICE, not per person
-- =====================================================================
-- The table carried `unique (profile_id)`, so a person was reachable on exactly
-- one device. Watched live: the admin's token changed three times in eight
-- minutes as a laptop and a phone each reclaimed the single row on load, and
-- the nudge for order #88 landed on whichever had loaded most recently rather
-- than the one in his hand. That is the final form of "it works once or twice
-- and then stops" -- not intermittent, not the cache, one row.
--
-- The original rationale was that driver_claim_device() binds a driver to a
-- single phone so two rows would mean two banners. True for a DRIVER; it does
-- not generalise to an admin who works from a desk and a pocket. Uniqueness
-- belongs on the token.
--
-- No notifier changes were needed: they all already do
-- `jsonb_agg(...) from push_tokens pt join profiles p ... where p.role = ...`,
-- so they fan out across rows and had simply never found more than one.

alter table public.push_tokens drop constraint if exists push_tokens_profile_id_key;
create unique index if not exists push_tokens_token_key on public.push_tokens (token);
create index if not exists push_tokens_profile_id_idx on public.push_tokens (profile_id);

-- save_my_push_token now conflicts on the TOKEN, so "someone else signed in on
-- this phone" MOVES the row rather than duplicating it -- one device still
-- cannot ring for two people, which was the real hazard the old unique guarded.
-- It also prunes anything untouched for 60 days, so a browser that keeps
-- re-minting registrations cannot accumulate dead strings that every alert then
-- fans out to.
--
-- Verified in a rolled-back transaction, four assertions:
--   two devices for one admin      -> 2 rows, both kept
--   notify_admin fans out to       -> both, with no code change
--   same device, new owner         -> 1 row, profile_id moved
--   dead device                    -> pruned by record_push_result as before
--
-- THE HOLE THIS OPENED, and the cap that closes it.
--
-- The old unique(profile_id) was also, accidentally, a CAP. Without it a browser
-- stuck re-minting registrations accumulates a row per visit instead of
-- replacing one. Observed within two hours: the admin held 5 rows, two sharing
-- the instance prefix `crq8tUz9bf` -- the same lineage that put `eWkGyokB5VNl`
-- into dead_push_tokens twice earlier the same day. Every alert then pays for
-- five FCM round trips to reach one phone, and push_send_log fills with
-- failures that read like an outage.
--
-- record_push_result does prune on the first rejection, so it self-corrects on
-- the next send -- but "eventually" is not a cap, and the 60-day age prune is
-- far too slow to matter. save_my_push_token now keeps the newest FOUR per
-- profile: a phone, a tablet, a laptop and a spare covers any real person, and
-- it is small enough that a re-minting browser cannot push a working device out
-- of the window.
--
-- `order by updated_at desc, id desc` -- the id tiebreak is load-bearing.
-- now() is the TRANSACTION timestamp, so several saves in one transaction share
-- an updated_at and the cap kept an arbitrary four. A loop test kept REMINT_1..4
-- instead of 5..8.
--
-- Re-verified, four more assertions:
--   after the trim              -> admin at 4
--   8 re-mints from one browser -> 4 rows, kept 8,7,6,5
--   a real second device        -> gets in, evicts the oldest
--   a known-dead token          -> still refused outright


-- =====================================================================
-- 2. Who appears first is now Wael's decision, not the alphabet's
-- =====================================================================
-- restaurants_for_compound sorted: open first, then vendors with real reviews,
-- then rating, then name. order_ratings is EMPTY -- not one rating has ever
-- been left -- so review_count is 0 for every vendor, both tiebreakers collapse,
-- and the list fell through to `x.name`.
--
-- Measured for compound 50 before the change:
--   أرابياتا · ديڤادو · ستوديو مصر · سينابون · ماكدونالدز · هارت أتاك
-- which is Arabic alphabetical order. The most valuable placement in the app was
-- being allocated by spelling, and ماكدونالدز -- the one vendor with a real
-- cover image -- sat fifth because م is late in the alphabet.

alter table public.restaurants
  add column if not exists display_order integer,
  add column if not exists featured boolean not null default false;

create index if not exists restaurants_display_order_idx
  on public.restaurants (display_order) where display_order is not null;

-- The sort keys, in order, inside restaurants_for_compound():
--
--   vendor_is_open_now(x.id) desc          CLOSED ALWAYS SINKS. First, ahead of
--                                          anything the admin sets, so a pinned
--                                          vendor that has shut cannot outrank
--                                          one that can actually take the order.
--   (x.display_order is not null) desc     explicit pins…
--   x.display_order asc nulls last         …in the order given
--   x.featured desc                        then the flagged, above the unranked
--   (review_count > 0) desc                then the original rules, untouched
--   case when review_count > 0 then rating end desc nulls last
--   x.name
--
-- Verified in a rolled-back transaction, four assertions:
--   before                -> أرابياتا · ديڤادو · ستوديو مصر · سينابون · ماكدونالدز · هارت أتاك
--   pin 1/2/3             -> ماكدونالدز · هارت أتاك · أرابياتا · (rest, alphabetical)
--   + featured سينابون    -> سينابون lifts above the unranked, stays below the pins
--   pinned vendor CLOSES  -> drops to LAST despite being rank 1

create or replace function public.admin_set_restaurant_rank(
  p_restaurant_id integer, p_display_order integer, p_featured boolean default null)
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  -- An RPC rather than a direct table update, unlike the image fields beside it
  -- in the admin UI: placement decides which vendor gets the top of the home
  -- screen, so it gets a real gate here rather than relying on an RLS policy
  -- that happens to permit the update today.
  if not is_admin() then raise exception 'admin_only'; end if;
  if p_display_order is not null and p_display_order < 1 then
    raise exception 'rank_must_be_positive';
  end if;
  update restaurants
     set display_order = p_display_order,
         featured = coalesce(p_featured, featured)
   where id = p_restaurant_id;
  if not found then raise exception 'restaurant_not_found'; end if;
end;
$$;

-- NO CUSTOMER-FACING BADGE, and that is a decision rather than an omission.
-- Rendered both ways for Wael before building. A «مميز» chip that only says "we
-- chose this" reads as a paid advert and makes the rest of the list read as
-- "not chosen"; placement does the same commercial work silently. If the slot is
-- ever SOLD, the chip is ~8 lines in RestaurantCard and the vendor paying for it
-- will want it.


-- =====================================================================
-- 3. admin_daily_report(date) -- the end-of-day audit, live
-- =====================================================================
-- Three things it does that a naive dashboard does not:
--
--   * Reports what SALKA KEPT, not GMV. On 6 August the app moved 8,167 ج.م of
--     food and Salka's share was 737. A dashboard leading with the big number
--     tells you a loss-making day was a triumph.
--   * Counts the funnel by DEVICE, not by event. 408 arrivals from 267 phones is
--     a denominator that flatters every rate underneath it.
--   * Names its own assumption. Rider salary is paid OUTSIDE the system --
--     driver_pay_model and driver_daily_salary_egp are read by zero functions and
--     driver_flat_earning_egp is 0, so every delivered order credits the driver
--     nothing -- and the report returns `assumed_rider_cost` so the screen can
--     say so out loud rather than presenting it as fact.
--
-- It also splits arrivals by whether they came from an in-app browser, because
-- of what that found on day one: 102 devices arrived inside Facebook's embedded
-- browser and ONE reached step two, against 27% of everyone else. Whether that
-- is a broken experience in that webview or Facebook prefetching the page, it is
-- the difference between an ad budget working and evaporating -- so it is
-- measured every day rather than rediscovered.
--
-- Gated on is_admin() or is_supervisor(). Day boundaries are Africa/Cairo, not
-- UTC: a "day" that ends at 2am local is not a trading day.
--
-- TWO THINGS THIS FUNCTION TAUGHT, both worth keeping:
--
--   1. The first version wrapped json_agg around count(*) over a GROUP BY --
--      "aggregate function calls cannot be nested", which Postgres raises at RUN
--      time. apply_migration returned {"success": true} and the function was
--      broken on every call. plpgsql parses; it does not plan the inner SQL.
--   2. It was found by CALLING it as a real admin (set request.jwt.claims, check
--      is_admin(), then invoke), not by reading it back. Do both.
--
-- The full body is deployed; see pg_get_functiondef('admin_daily_report').
-- Its return shape, which the Admin screen depends on:
--
--   day, orders_created, delivered, cancelled, cancel_pct,
--   gmv, revenue, delivery_fees, service_fees, revenue_per_delivered,
--   assumed_rider_cost, riders_active, rider_daily_salary,
--   result, breakeven_orders, pct_of_breakeven, cost_per_delivered,
--   funnel {arrived, chose_place, opened_vendor, added_item, checkout, ordered},
--   by_browser [{segment: 'in_app'|'browser', devices, chose_place, ordered}],
--   unpriced_left_open, unpaid_left_open
--
-- Sample, run for 2026-08-06 and 2026-08-07:
--   06 Aug: delivered 4, revenue 737, cost 2400, result -1663, 31% of breakeven
--   07 Aug: delivered 2, revenue 140, created 6, cancelled 4 (67%), result -2260


-- =====================================================================
-- Also still unrecorded before tonight, and older: vendor_open_states()
-- =====================================================================
-- Returns the COMPUTED open state per vendor. Exists because
-- restaurants.is_open is a stale column that vendor_is_open_now() never reads
-- and nothing resets after a temporary close expires -- all 12 live vendors sat
-- at false permanently, and the customer-facing lists that read it raw were
-- hiding 8 of 12 open vendors. Three client call sites were added on 2026-08-07
-- (Offers, CustomOrder, Vendor). Nothing in the client may read
-- restaurants.is_open directly.
