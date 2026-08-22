-- A customer can renew an expired offer without a supervisor re-pricing it.
-- The old quote remains immutable history; the renewed quote copies that exact
-- financial snapshot and opens only a fresh 15-minute customer decision window.
create or replace function private.renew_expired_custom_order_quote(
  p_order_id integer, p_quote_id bigint, p_order_token uuid, p_idempotency_key uuid
)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare
  v_order orders%rowtype;
  v_quote order_quotes%rowtype;
  v_existing order_quotes%rowtype;
  v_new_quote_id bigint;
  v_version integer;
  v_expires_at timestamptz := now() + interval '15 minutes';
begin
  if p_idempotency_key is null then raise exception 'invalid_idempotency_key'; end if;
  select * into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.public_token <> p_order_token then raise exception 'invalid_quote_token'; end if;
  if v_order.status in ('Cancelled', 'Delivered') then raise exception 'order_closed'; end if;
  if v_order.order_type <> 'custom_request' or v_order.pricing_status <> 'pending_quote' then raise exception 'quote_not_pending'; end if;

  select * into v_quote from order_quotes where id = p_quote_id and order_id = p_order_id for update;
  if not found then raise exception 'quote_not_found'; end if;
  if v_order.current_quote_id is distinct from v_quote.id then raise exception 'quote_not_current'; end if;
  if v_quote.state <> 'expired' or v_order.quote_state <> 'expired' then raise exception 'quote_not_expired'; end if;

  select * into v_existing from order_quotes where order_id = p_order_id and idempotency_key = p_idempotency_key;
  if found then
    return json_build_object('quote_id', v_existing.id, 'version', v_existing.version, 'state', v_existing.state, 'expires_at', v_existing.expires_at);
  end if;

  select coalesce(max(version), 0) + 1 into v_version from order_quotes where order_id = p_order_id;
  insert into order_quotes (
    order_id, version, state, issued_by, expires_at,
    subtotal, delivery_fee, service_fee, promo_code_id,
    promo_discount, promo_discount_service, promo_discount_delivery, promo_discount_vendor,
    wallet_used, total, payment_method, deposit_required, deposit_amount, idempotency_key
  ) values (
    p_order_id, v_version, 'offered', null, v_expires_at,
    v_quote.subtotal, v_quote.delivery_fee, v_quote.service_fee, v_quote.promo_code_id,
    v_quote.promo_discount, v_quote.promo_discount_service, v_quote.promo_discount_delivery, v_quote.promo_discount_vendor,
    v_quote.wallet_used, v_quote.total, v_quote.payment_method, v_quote.deposit_required, v_quote.deposit_amount, p_idempotency_key
  ) returning id into v_new_quote_id;

  update orders set quote_state = 'offered', current_quote_id = v_new_quote_id where id = p_order_id;
  insert into order_status_events (order_id, from_status, to_status, actor, actor_uid)
  values (p_order_id, 'quote:expired', 'quote:offered', 'customer', auth.uid());
  perform private.record_order_event(
    p_order_id, 'quote.renewed_by_customer', 'quote',
    jsonb_build_object('state', 'expired', 'quote_id', v_quote.id, 'version', v_quote.version),
    jsonb_build_object('state', 'offered', 'quote_id', v_new_quote_id, 'version', v_version, 'expires_at', v_expires_at),
    'customer', 'Customer renewed the unchanged expired offer.', p_idempotency_key
  );
  return json_build_object('quote_id', v_new_quote_id, 'version', v_version, 'state', 'offered', 'expires_at', v_expires_at);
end;
$function$;

create or replace function public.renew_expired_custom_order_quote(
  p_order_id integer, p_quote_id bigint, p_order_token uuid, p_idempotency_key uuid, p_auth_user_id uuid default null
)
returns json language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_auth_user_id is not null then perform set_config('request.jwt.claim.sub', p_auth_user_id::text, true); end if;
  return private.renew_expired_custom_order_quote(p_order_id, p_quote_id, p_order_token, p_idempotency_key);
end;
$function$;

revoke all on function private.renew_expired_custom_order_quote(integer,bigint,uuid,uuid) from public, anon, authenticated;
revoke all on function public.renew_expired_custom_order_quote(integer,bigint,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.renew_expired_custom_order_quote(integer,bigint,uuid,uuid,uuid) to service_role;
