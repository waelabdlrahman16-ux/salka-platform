-- Applied to production 2026-08-19 via MCP while investigating order 409;
-- recorded here so the repo and the database do not drift.
--
-- Two faults on promo_codes, found together:
--   1. A cancelled order held its redemption forever. SOKHNA30 had 6 of its
--      first 13 redemptions locked to orders that never happened, so the code
--      would have hit its 50 cap having delivered ~27.
--   2. The per-customer key was 'customer:<id>' when signed in and
--      'phone:<number>' when not, so the same person got a fresh allowance by
--      signing in between two orders. One phone with two customer rows did the
--      same. Three phones used the code twice; one of those was delivered.

alter table promo_redemptions add column if not exists released_at timestamptz;

comment on column promo_redemptions.released_at is
  'Set when the order was cancelled. Released rows keep their discount_amount for reporting but stop counting against max_redemptions and max_redemptions_per_customer.';

create index if not exists promo_redemptions_live_idx
  on promo_redemptions (promo_code_id, customer_key) where released_at is null;

update promo_redemptions r
   set released_at = coalesce(o.cancelled_at, now())
  from orders o
 where o.id = r.order_id and o.status = 'Cancelled' and r.released_at is null;

update promo_redemptions r
   set customer_key = 'phone:' || normalize_phone(o.customer_phone)
  from orders o
 where o.id = r.order_id
   and coalesce(normalize_phone(o.customer_phone), '') <> ''
   and r.customer_key is distinct from 'phone:' || normalize_phone(o.customer_phone);
