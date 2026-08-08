-- Financial admin RPCs keep SECURITY DEFINER because they must write through
-- RLS, but every entry point authenticates the admin and serializes changes
-- that could otherwise be applied twice by concurrent requests.

create or replace function public.credit_wallet(
  p_phone text,
  p_amount numeric,
  p_reason text,
  p_order_id integer default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_wallet_id integer;
  v_phone text;
  v_reason text;
begin
  if not is_admin() then raise exception 'admin_only'; end if;

  v_phone := normalize_phone(p_phone);
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  if coalesce(v_phone, '') = '' then raise exception 'invalid_phone'; end if;
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount <= 0 then
    raise exception 'invalid_credit_amount';
  end if;
  if v_reason is null then raise exception 'reason_required'; end if;
  if length(v_reason) > 500 then raise exception 'reason_too_long'; end if;
  if p_order_id is not null
     and not exists (select 1 from orders where id = p_order_id) then
    raise exception 'order_not_found';
  end if;

  insert into customer_wallets (phone, balance) values (v_phone, 0)
  on conflict (phone) do nothing;

  select id into v_wallet_id
    from customer_wallets
   where phone = v_phone
   for update;

  update customer_wallets
     set balance = balance + p_amount
   where id = v_wallet_id;

  insert into wallet_transactions (wallet_id, amount, reason, order_id)
  values (v_wallet_id, p_amount, v_reason, p_order_id);
end;
$function$;

create or replace function public.mark_refunded(p_order_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
begin
  if not is_admin() then raise exception 'admin_only'; end if;

  select refund_status into v_status
    from orders
   where id = p_order_id
   for update;

  if not found then raise exception 'order_not_found'; end if;
  if v_status is distinct from 'pending' then
    raise exception 'refund_not_pending';
  end if;

  update orders set refund_status = 'refunded' where id = p_order_id;
end;
$function$;

create or replace function public.settle_driver_cash(p_driver_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_amount numeric;
begin
  if not is_admin() then raise exception 'admin_only'; end if;

  select cash_held into v_amount
    from drivers
   where id = p_driver_id
   for update;

  if not found then raise exception 'driver_not_found'; end if;
  if coalesce(v_amount, 0) <= 0 then return; end if;

  insert into driver_settlements (driver_id, kind, amount)
  values (p_driver_id, 'cash_remitted', v_amount);

  update drivers set cash_held = 0 where id = p_driver_id;
end;
$function$;

create or replace function public.settle_driver_earnings(p_driver_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_amount numeric;
begin
  if not is_admin() then raise exception 'admin_only'; end if;

  -- The driver row is the per-driver settlement lock. Concurrent requests for
  -- the same driver serialize before either can calculate unpaid earnings.
  perform 1 from drivers where id = p_driver_id for update;
  if not found then raise exception 'driver_not_found'; end if;

  select coalesce(sum(driver_earning), 0) into v_amount
    from driver_earnings
   where driver_id = p_driver_id and not paid;

  if v_amount <= 0 then return; end if;

  update driver_earnings
     set paid = true, paid_at = now()
   where driver_id = p_driver_id and not paid;

  insert into driver_settlements (driver_id, kind, amount)
  values (p_driver_id, 'earnings_paid', v_amount);

  update settlement_requests
     set status = 'fulfilled', resolved_at = now()
   where driver_id = p_driver_id and status = 'pending';
end;
$function$;

revoke all on function public.credit_wallet(text,numeric,text,integer) from public, anon;
revoke all on function public.mark_refunded(integer) from public, anon;
revoke all on function public.settle_driver_cash(integer) from public, anon;
revoke all on function public.settle_driver_earnings(integer) from public, anon;

grant execute on function public.credit_wallet(text,numeric,text,integer) to authenticated;
grant execute on function public.mark_refunded(integer) to authenticated;
grant execute on function public.settle_driver_cash(integer) to authenticated;
grant execute on function public.settle_driver_earnings(integer) to authenticated;

do $verification$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.credit_wallet(text,numeric,text,integer)',
    'public.mark_refunded(integer)',
    'public.settle_driver_cash(integer)',
    'public.settle_driver_earnings(integer)'
  ] loop
    if has_function_privilege('anon', v_signature, 'execute') then
      raise exception 'anonymous execute still enabled for %', v_signature;
    end if;
    if not has_function_privilege('authenticated', v_signature, 'execute') then
      raise exception 'authenticated execute missing for %', v_signature;
    end if;
  end loop;
end
$verification$;
