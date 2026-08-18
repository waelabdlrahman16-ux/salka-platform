-- Applied to production 2026-08-18 via Supabase MCP. This file is the record.
--
-- Admin audit finding 2: a wallet credit could be issued twice.
--
-- credit_wallet ADDS to a balance. That makes it unlike every other money
-- action in this system: settle_driver_earnings and settle_driver_cash drain to
-- zero, so a second tap finds nothing to pay and does nothing; mark_refunded
-- refuses outright with refund_not_pending. Those are idempotent by shape. A
-- wallet credit is not -- two calls credit twice -- and the button had no busy
-- state, so on slow mobile data an operator who thought nothing had happened
-- could tap again and pay twice.
--
-- Measured before changing anything: ZERO duplicates in production, across 5
-- transactions totalling 162 EGP. The confirmation dialog was doing real work
-- and the volume is low. This closes a live risk that had not yet fired.
--
-- WHY THE GUARD IS HERE AND NOT ONLY ON THE BUTTON. Disabling the button stops
-- the common case and nothing else. It does not cover two admins working at
-- once, a retry after a timeout, or a request that succeeded while its response
-- was lost -- and lib/rpc.ts is explicit that a lost response is not a lost
-- write. The database is the only layer that sees all of those.
--
-- WHY THE LOCK MOVED. The `for update` on customer_wallets is now taken BEFORE
-- the duplicate check, not after. Two concurrent credits to the same wallet
-- serialize there; without it both could read "no duplicate" and both insert,
-- which is the exact race this exists to stop.
--
-- WHY TWO MINUTES, AND WHY REASON IS PART OF THE KEY. Same wallet, same amount
-- AND same reason inside two minutes is a repeat, not a decision. A genuine
-- second credit for a different problem carries a different reason and passes.
-- A genuine identical credit later that day also passes. The window is
-- deliberately short: this is a double-tap guard, not a spending policy.
--
-- ROLLBACK: restore the function from migration
-- 20260818120000_record_actor_on_money_movements.sql, which is the same body
-- without the lock reorder and without the duplicate_credit check.

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

  -- Taken BEFORE the duplicate check so concurrent credits serialize here.
  select id into v_wallet_id
    from customer_wallets
   where phone = v_phone
   for update;

  if exists (
    select 1 from wallet_transactions
     where wallet_id = v_wallet_id
       and amount = p_amount
       and coalesce(reason, '') = coalesce(v_reason, '')
       and created_at > now() - interval '2 minutes'
  ) then
    raise exception 'duplicate_credit';
  end if;

  update customer_wallets
     set balance = balance + p_amount
   where id = v_wallet_id;

  insert into wallet_transactions (wallet_id, amount, reason, order_id, actor)
  values (v_wallet_id, p_amount, v_reason, p_order_id, auth.uid());
end;
$function$;

-- VERIFIED ON PRODUCTION, inside a deliberately-aborted block:
--
--   first_credit_ok       = t   a genuine credit still works
--   duplicate_blocked     = t   the identical repeat raised duplicate_credit
--   different_reason_ok   = t   same amount, different reason still passes
--   balance = 50.00, rows = 2   THREE attempts, TWO credits -- the duplicate
--                               was actually blocked, not merely reported
--
-- Nothing persisted: no test wallet left, still 5 transactions, still 162.00.
