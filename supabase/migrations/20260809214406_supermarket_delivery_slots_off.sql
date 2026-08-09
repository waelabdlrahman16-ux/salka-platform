-- Turn fixed delivery windows OFF for the supermarket, so it takes on-demand
-- orders exactly like the pharmacy.
--
-- APPLY THIS ONLY AFTER THE FRONTEND IN THIS PR IS LIVE. Before it, the
-- scheduling UI reads `vendor_type === 'supermarket'` rather than this column,
-- so flipping the flag alone leaves the customer facing a mandatory slot step
-- whose list is empty -- open_slots() returns '[]' when the flag is off -- and
-- the confirm button can never enable. Code first, flag second.
--
-- No slot rows are deleted. delivery_slots for this vendor stay configured, so
-- the admin switch can turn windows back on and get the same times and
-- capacities back.
--
-- Nothing on the server needs changing: submit_custom_order() already treats a
-- null p_slot_id as "ready in prep_minutes, dispatch as soon as it is priced",
-- which is the pharmacy's path, and order_is_dispatchable() already gates
-- pharmacy and supermarket identically on somebody accepting the errand.

update restaurants
   set uses_delivery_slots = false
 where vendor_type = 'supermarket'
   and uses_delivery_slots;

do $v$
declare n int;
begin
  select count(*) into n
    from restaurants
   where vendor_type = 'supermarket' and uses_delivery_slots;
  if n > 0 then
    raise exception 'supermarket still on delivery slots: % vendor(s)', n;
  end if;
end $v$;
