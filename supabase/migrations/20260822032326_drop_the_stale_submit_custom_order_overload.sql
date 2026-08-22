-- Two versions of submit_custom_order were live: the current 18-argument one
-- (promo + wallet) and a 16-argument leftover with neither.
--
-- Nothing was broken by it -- PostgREST resolves by argument NAME, and the only
-- caller, the customer-order-creation Edge Function, always sends p_promo_code
-- and p_use_wallet, so it always reached the right function. But a caller that
-- ever omitted those two names would have silently landed on the old one and
-- lost the promo and the wallet with no error at all. Same reason
-- 20260725013508 dropped the old place_order overload.
--
-- Only the exact old signature is dropped, so if this were somehow the wrong
-- one the statement would fail rather than remove the live function.
drop function if exists public.submit_custom_order(
  integer, text, text, text, text, text, numeric, json, text,
  integer, uuid, integer, date, text, text, uuid);
