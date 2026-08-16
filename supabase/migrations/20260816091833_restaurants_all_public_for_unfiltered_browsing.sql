-- Applied to production 2026-08-16 09:18 UTC via Supabase MCP (audit step 4,
-- layer 1). This file is the record of that change.
--
-- Audit finding 01: a first-time visitor was shown an empty screen and a
-- location prompt before any product. 4,770 Meta ad clicks over nine days
-- produced zero orders, while organic traffic -- people who already knew what
-- was behind the gate -- chose a compound 48% of the time.
--
-- The fix is to let people browse before choosing a place. That needs a way to
-- read the catalogue without a compound, which did not exist:
-- restaurants_for_compound() requires one and filters on
-- vendor_covers_compound().
--
-- This function is that reader. It is a VERBATIM copy of
-- restaurants_for_compound with exactly one line removed -- the coverage
-- filter -- and no other difference. Deliberately additive: the existing
-- function is untouched, so the path every current customer is on cannot
-- regress, and rolling this feature back means reverting the frontend only.
-- If this function is wrong the failure is "the home screen lists no vendors",
-- not "checkout is broken".
--
-- Ordering is preserved exactly, including the rule that closed vendors sink
-- below open ones regardless of pinning, so the filtered and unfiltered lists
-- cannot disagree about precedence.
--
-- Measured at the time of writing: 16 vendors platform-wide against a
-- per-compound average of 15.3 (min 7, max 16, across 85 active compounds,
-- none with zero coverage). So the unfiltered list is accurate to within one
-- vendor for a typical customer, and nobody can reach a dead end.
--
-- Coverage is still enforced where it matters. This is a browse-time read
-- only; place_order continues to reject an order from a vendor that does not
-- cover the customer's compound (vendor_not_covering_compound), and Home
-- re-queries the compound-scoped list the moment a place is chosen.
CREATE OR REPLACE FUNCTION public.restaurants_all_public()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select coalesce(json_agg(
           (row_to_json(x)::jsonb || jsonb_build_object(
              'is_open',      vendor_is_open_now(x.id),
              'next_open_at', vendor_next_open_at(x.id)
           ))::json
           order by vendor_is_open_now(x.id) desc,
                    (x.display_order is not null) desc,
                    x.display_order asc nulls last,
                    x.featured desc,
                    (coalesce(x.review_count, 0) > 0) desc,
                    case when coalesce(x.review_count, 0) > 0 then x.rating end desc nulls last,
                    x.name
         ), '[]'::json)
  from (
    select r.*,
           coalesce(rc.n, 0)::int as review_count,
           coalesce(
             nullif(btrim(r.cover_image_url), ''),
             (select m.image_url
                from menu_items m
                left join (
                  select oi.menu_item_id, count(*)::int as sold
                    from order_items oi
                    join orders o on o.id = oi.order_id
                   where o.created_at > now() - interval '30 days'
                   group by oi.menu_item_id
                ) s on s.menu_item_id = m.id
               where m.restaurant_id = r.id and m.available
                 and m.image_url is not null and m.image_url <> ''
                 and not coalesce(m.is_shelf_label, false)
               order by coalesce(s.sold, 0) desc, m.price desc, m.id
               limit 1)
           ) as hero_image_url
      from restaurants r
      left join (
        select o.restaurant_id, count(*)::int as n
          from order_ratings rt
          join orders o on o.id = rt.order_id
         where rt.restaurant_rating is not null
         group by o.restaurant_id
      ) rc on rc.restaurant_id = r.id
     where not r.archived
       and not r.is_test
       -- and vendor_covers_compound(r.id, p_compound_id)  <-- the only removal
       and exists (select 1 from menu_items m2
                    where m2.restaurant_id = r.id and m2.available
                      and not coalesce(m2.is_shelf_label, false))
  ) x;
$function$;

-- Finding 02 was caused by a new function inheriting Postgres' default
-- EXECUTE TO PUBLIC because nobody revoked it. Not repeating that here: this is
-- called only by the public-catalog edge function via the service role, which
-- is unaffected by these grants.
REVOKE ALL ON FUNCTION public.restaurants_all_public() FROM public, anon, authenticated;
