-- Production already has the canonical guard function, but its trigger was
-- absent from delivery assignments. Attach it so a custom request cannot reach dispatch
-- before its current quote has been accepted by the customer.
drop trigger if exists guard_custom_order_quote_dispatch on public.delivery_assignments;

create trigger guard_custom_order_quote_dispatch
before insert or update of order_id on public.delivery_assignments
for each row execute function private.guard_custom_order_quote_dispatch();
