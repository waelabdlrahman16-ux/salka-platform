CREATE OR REPLACE FUNCTION private.settle_driver_earnings(p_driver_id integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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

  -- auth.uid() is the admin is_admin() just validated, at the top of this body.
  insert into driver_settlements (driver_id, kind, amount, actor)
  values (p_driver_id, 'earnings_paid', v_amount, auth.uid());

  update settlement_requests
     set status = 'fulfilled', resolved_at = now()
   where driver_id = p_driver_id and status = 'pending';
end;
$function$;

CREATE OR REPLACE FUNCTION private.settle_driver_cash(p_driver_id integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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

  insert into driver_settlements (driver_id, kind, amount, actor)
  values (p_driver_id, 'cash_remitted', v_amount, auth.uid());

  update drivers set cash_held = 0 where id = p_driver_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.credit_wallet(p_phone text, p_amount numeric, p_reason text, p_order_id integer DEFAULT NULL::integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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

  insert into wallet_transactions (wallet_id, amount, reason, order_id, actor)
  values (v_wallet_id, p_amount, v_reason, p_order_id, auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION private.mark_refunded(p_order_id integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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

  -- refunded_at as well as refunded_by: "when" is half the question, and the
  -- row carries no other timestamp for this transition.
  update orders
     set refund_status = 'refunded',
         refunded_by = auth.uid(),
         refunded_at = now()
   where id = p_order_id;
end;
$function$;
