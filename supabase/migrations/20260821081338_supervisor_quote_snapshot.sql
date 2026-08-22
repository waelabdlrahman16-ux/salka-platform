-- The current offer is deliberately held apart from orders until the customer
-- accepts it. Supervisors still need to see that immutable snapshot while they
-- wait, but must not receive blanket read access to order_quotes.
create or replace function private.staff_current_custom_order_quote(p_order_id integer)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_quote public.order_quotes%rowtype;
begin
  if not (is_admin() or (is_supervisor() and supervisor_may_touch_order(p_order_id))) then
    raise exception 'not_authorized';
  end if;

  select q.* into v_quote
    from public.order_quotes q
    join public.orders o on o.current_quote_id = q.id
   where o.id = p_order_id;

  if not found then
    raise exception 'quote_not_found';
  end if;

  return json_build_object(
    'id', v_quote.id,
    'version', v_quote.version,
    'state', v_quote.state,
    'expires_at', v_quote.expires_at,
    'subtotal', v_quote.subtotal,
    'delivery_fee', v_quote.delivery_fee,
    'service_fee', v_quote.service_fee,
    'promo_discount', v_quote.promo_discount,
    'wallet_used', v_quote.wallet_used,
    'total', v_quote.total,
    'payment_method', v_quote.payment_method,
    'deposit_required', v_quote.deposit_required,
    'deposit_amount', v_quote.deposit_amount
  );
end;
$function$;

create or replace function public.staff_current_custom_order_quote(
  p_order_id integer,
  p_auth_user_id uuid default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_auth_user_id is null then
    raise exception 'not_authorized';
  end if;
  perform set_config('request.jwt.claim.sub', p_auth_user_id::text, true);
  return private.staff_current_custom_order_quote(p_order_id);
end;
$function$;

revoke all on function private.staff_current_custom_order_quote(integer) from public, anon, authenticated;
revoke all on function public.staff_current_custom_order_quote(integer, uuid) from public, anon, authenticated;
grant execute on function public.staff_current_custom_order_quote(integer, uuid) to service_role;
