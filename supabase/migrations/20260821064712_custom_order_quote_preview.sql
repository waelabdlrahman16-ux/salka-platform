-- Staff must see the exact server-owned financial snapshot before sending a
-- customer offer. This exposes no customer capability: only the trusted edge
-- function (service_role) can call it after it forwards the signed-in staff ID.
create or replace function public.preview_custom_order_quote(
  p_order_id integer,
  p_subtotal numeric,
  p_auth_user_id uuid default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_snapshot record;
begin
  if p_auth_user_id is null then raise exception 'not_authorized'; end if;
  perform set_config('request.jwt.claim.sub', p_auth_user_id::text, true);
  if not is_supervisor() then raise exception 'not_authorized'; end if;
  if p_subtotal is null or p_subtotal < 0 then raise exception 'invalid_amount'; end if;

  select * into v_snapshot
    from private.custom_order_quote_snapshot(p_order_id, p_subtotal);

  if not is_admin()
     and v_snapshot.total > private.setting_num('quote_admin_approval_ceiling_egp') then
    raise exception 'quote_requires_admin_approval';
  end if;

  return json_build_object(
    'subtotal', v_snapshot.subtotal,
    'delivery_fee', v_snapshot.delivery_fee,
    'service_fee', v_snapshot.service_fee,
    'promo_discount', v_snapshot.promo_discount,
    'wallet_used', v_snapshot.wallet_used,
    'total', v_snapshot.total,
    'payment_method', v_snapshot.payment_method,
    'deposit_required', v_snapshot.deposit_required,
    'deposit_amount', v_snapshot.deposit_amount
  );
end;
$function$;

revoke all on function public.preview_custom_order_quote(integer,numeric,uuid) from public, anon, authenticated;
grant execute on function public.preview_custom_order_quote(integer,numeric,uuid) to service_role;
