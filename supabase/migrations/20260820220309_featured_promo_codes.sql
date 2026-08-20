-- Offer a promo code to every customer, chosen in the admin portal.
--
-- APPLIED TO PRODUCTION 2026-08-20. Recorded here so the repo and the database
-- agree; version 20260820220309.
--
-- WHY A FLAG AND NOT "the active code". There are two live codes and they are
-- not the same kind of thing. SOKHNA30 is marketing. SORRY200 is an APOLOGY
-- code, handed to one wronged customer at a time -- max_redemptions is 1. A
-- screen that offered "whatever is active" would advertise it to everybody.
-- So nothing is public until an admin ticks it, and the default is false.

alter table promo_codes add column if not exists featured boolean not null default false;

comment on column promo_codes.featured is
  'Offer this code to every customer on the checkout screen. FALSE by default and deliberately so: SORRY200 is an apology code and must never be advertised. Only an admin ticking this box makes a code public.';

-- What the checkout may show, and nothing more.
--
-- Returns only codes that are ticked, active, inside their date window, and
-- scoped to this restaurant/area. A code for a different vendor is not shown at
-- all -- it is noise, not an offer. A code that IS for this vendor but does not
-- currently qualify (basket under the minimum, nothing left to discount) IS
-- returned, carrying its reason, so the card can be shown greyed with the
-- reason rather than vanishing. Telling someone "add 50 EGP and you save 30" is
-- worth more than hiding it.
--
-- The quote is computed here rather than trusted from the client: the same
-- private.quote_promo_code that checkout already uses, so the number on the
-- card and the number charged come from one place and cannot drift apart.
create or replace function public.featured_promos(
  p_restaurant_id integer,
  p_compound_id integer,
  p_subtotal numeric,
  p_delivery_fee numeric,
  p_service_fee numeric
) returns json
language sql stable security definer set search_path to 'public'
as $fn$
  select coalesce(json_agg(json_build_object(
           'code',      code,
           'applies_to',applies_to,
           'valid',     (quote->>'valid')::boolean,
           'discount',  (quote->>'discount')::numeric,
           'reason',    quote->>'reason',
           'minimum',   (quote->>'minimum')::numeric
         ) order by code), '[]'::json)
  from (
    select pc.code, pc.applies_to,
           private.quote_promo_code(pc.code, p_restaurant_id, p_compound_id,
             coalesce(p_subtotal,0), coalesce(p_delivery_fee,0), coalesce(p_service_fee,0)) as quote
      from promo_codes pc
     where pc.featured
       and pc.active
       and (pc.starts_at is null or now() >= pc.starts_at)
       and (pc.ends_at  is null or now() <  pc.ends_at)
       and (pc.restaurant_id is null or pc.restaurant_id = p_restaurant_id)
       and (pc.compound_id  is null or pc.compound_id  = p_compound_id)
     order by pc.code
     limit 5
  ) t
$fn$;

revoke all on function public.featured_promos(integer,integer,numeric,numeric,numeric) from public;
grant execute on function public.featured_promos(integer,integer,numeric,numeric,numeric) to anon, authenticated;

-- Wael's instruction, 2026-08-20: SOKHNA30 only. SORRY200 stays unticked and
-- keeps working exactly as before for anyone who types it.
update promo_codes set featured = true where code = 'SOKHNA30';
