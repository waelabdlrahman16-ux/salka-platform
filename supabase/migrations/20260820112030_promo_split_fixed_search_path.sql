-- Pin promo_split's search_path.
--
-- APPLIED TO PRODUCTION 2026-08-20. Recorded here so the repo and the database
-- agree; version 20260820112030.
--
-- promo_split is pure arithmetic over its arguments and touches no table, so
-- the exposure was small -- but a function with a mutable search_path is a
-- standing invitation, and this one decides which pot a discount comes out of.
-- Body byte-identical to before; only the setting is new. Verified before
-- applying: 'all' 100 off (service 20, delivery 65) still splits 20/65/15,
-- 'delivery' 30 still gives 30, 'platform' 100 still gives 20/80.
CREATE OR REPLACE FUNCTION private.promo_split(p_applies_to text, p_discount numeric, p_delivery numeric, p_service numeric, OUT cut_service numeric, OUT cut_delivery numeric, OUT cut_vendor numeric)
 RETURNS record
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
  cut_service := 0; cut_delivery := 0; cut_vendor := 0;
  if p_applies_to = 'delivery' then
    cut_delivery := p_discount;
  elsif p_applies_to = 'service' then
    cut_service := p_discount;
  elsif p_applies_to = 'vendor' then
    cut_vendor := p_discount;
  elsif p_applies_to = 'platform' then
    cut_service  := least(p_discount, p_service);
    cut_delivery := p_discount - cut_service;
  else
    -- 'all' waterfalls: drain both platform fees before touching the vendor.
    cut_service  := least(p_discount, p_service);
    cut_delivery := least(p_discount - cut_service, p_delivery);
    cut_vendor   := p_discount - cut_service - cut_delivery;
  end if;
end $function$;
