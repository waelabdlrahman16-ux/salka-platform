-- Same gap my_orders() had before 20260805004605: an unpriced custom/pickup
-- order's total is the delivery fee alone (subtotal is 0 until someone quotes
-- it), and this function never said so. Profile.tsx's "طلباتي" list showed
-- that number unconditionally -- a pharmacy run mid-quote read as "65 ج.م",
-- the final price, when it was just the delivery fee.
create or replace function private.my_customer_orders()
 returns json
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select coalesce(json_agg(row_to_json(x)), '[]'::json) from (
    select o.id, o.public_token, o.total, o.status, o.created_at,
           coalesce(o.pricing_status, 'n/a') as pricing_status,
           r.name as restaurant_name
    from orders o
    join restaurants r on r.id = o.restaurant_id
    where o.customer_id = my_customer_id()
      and o.created_at > now() - interval '90 days'
    order by o.id desc limit 30
  ) x;
$function$;
