-- confirm_custom_order_price could brick an order, silently.
--
-- WHAT IT DID. It set subtotal, service_fee and pricing_status = 'confirmed',
-- moved the order to 'pending', and never issued a quote. quote_state stayed
-- 'pending' with current_quote_id null and no row in order_quotes. The quote
-- guards -- correctly -- then refused preparation and dispatch, because
-- quote_state <> 'accepted'. The order was priced, live, and unable to move.
--
-- WHAT THAT COST. Order #1187 on 2026-08-22: priced at 02:00, stuck for an hour
-- and a half, staff left with cancel as the only button on an order the courier
-- had already delivered. The portal's "record as delivered" is rendered per
-- delivery assignment, and the order had none, because it could never be
-- dispatched. Nothing in the product could reach it.
--
-- WHY IT WAS STILL REACHABLE. Quote issuing moved to quote-operations and the
-- Supervisor screen went with it, but vendor-operations kept a confirmPrice
-- action -- restored by #190 after a deploy without it broke pricing outright,
-- and knowingly left in place on 2026-08-22 on the reasoning that an action
-- nobody calls costs nothing. #1187 is the counter-example: a staff tab holding
-- the older bundle called it, and the cost was not nothing.
--
-- WHY REFUSE RATHER THAN DROP. A missing function surfaces as a 500 and a
-- generic 'حصل خطأ'; refusing surfaces a code the caller can translate into
-- "use the quote screen", which is the sentence that actually gets the order
-- priced. It also keeps the guarantee one-directional: this path can no longer
-- create state that the rest of the system refuses to honour.
--
-- WHY NOT MAKE IT SET quote_state = 'accepted'. Because the customer has not
-- accepted. Rule 4 of the flow is that they must, explicitly, before anything
-- proceeds, and a staff-entered price standing in for the customer's agreement
-- is precisely the thing the quote flow was built to stop.
create or replace function private.confirm_custom_order_price(p_order_id integer, p_subtotal numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Authorisation first, so an unauthorised caller still learns it is
  -- unauthorised rather than being told to use a screen it cannot open.
  if not is_supervisor() then raise exception 'not_authorized'; end if;

  raise exception 'use_quote_flow';
end $function$;

comment on function private.confirm_custom_order_price(integer, numeric) is
  'Retired 2026-08-22. Priced an order without issuing a quote, leaving quote_state <> accepted and the order unable to progress (see order #1187). Raises use_quote_flow; price through issue_custom_order_quote instead.';
