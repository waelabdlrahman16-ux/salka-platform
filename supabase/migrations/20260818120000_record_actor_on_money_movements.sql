-- Applied to production 2026-08-18 via Supabase MCP, in two steps (columns
-- first, then functions), so the columns could be verified before anything
-- executable changed. This file is the record of that change.
--
-- Admin audit finding 1: money moves with no record of who moved it.
--
-- driver_settlements held 13 rows worth 72,029.55 EGP with columns
-- (id, driver_id, kind, amount, created_at) and no actor. wallet_transactions
-- was the same. Yet the platform records actors everywhere else:
-- order_status_events has actor and actor_uid, driver_device_log has actor,
-- order_test_audit_log has marked_by, and orders.archived_by is populated on
-- all 14 archived orders. So Salka recorded who unbound a driver's phone, but
-- not who paid them seventy-two thousand pounds.
--
-- WHY THIS IS A SMALL CHANGE. The admin's identity is already inside these
-- functions. Every public wrapper does:
--
--   perform set_config('request.jwt.claim.sub', p_auth_user_id::text, true);
--
-- which is what makes is_admin() work at all, and auth.uid() reads exactly that
-- setting. So the caller is present AND already validated by the time the money
-- moves. It was simply never stored. No signature changes, no edge function
-- changes, no client changes.
--
-- ONE DELIBERATE DIVERGENCE FROM THE HOUSE PATTERN. orders.archived_by is
-- declared REFERENCES auth.users(id) ON DELETE SET NULL. These columns are NOT.
-- admin_delete_staff() exists and deleting a staff account is a normal workflow
-- -- and ON DELETE SET NULL would erase that person's settlement history at
-- exactly the moment it becomes most interesting. An audit trail that a
-- departing admin can clear by having their account removed is not an audit
-- trail. The uuid is kept raw and resolved by join when someone asks.
--
-- HISTORIC ROWS CANNOT BE BACKFILLED. The 13 existing settlements and 5 wallet
-- transactions stay null forever; that information was never captured. This
-- records from today onward.
--
-- ROLLBACK, in full:
--
--   alter table public.driver_settlements  drop column actor;
--   alter table public.wallet_transactions drop column actor;
--   alter table public.orders drop column refunded_by, drop column refunded_at;
--   -- then restore the four function bodies from the block at the end of this file.

-- 1. The columns. Nullable, no default, no FK (see note above).
alter table public.driver_settlements  add column if not exists actor uuid;
alter table public.wallet_transactions add column if not exists actor uuid;
alter table public.orders
  add column if not exists refunded_by uuid,
  add column if not exists refunded_at timestamptz;

comment on column public.driver_settlements.actor is
  'auth.users.id of the admin who performed the settlement. Null for rows written before 2026-08-18. No FK on purpose: deleting the staff account must not erase the trail.';
comment on column public.wallet_transactions.actor is
  'auth.users.id of the admin who issued the credit. Null for rows written before 2026-08-18.';
comment on column public.orders.refunded_by is
  'auth.users.id of the admin who marked the refund paid. Null for the 2 orders refunded before 2026-08-18.';

-- 2. The four functions, written out in full rather than patched. The
--    2026-08-13 outage came from a migration doing a string replace on a
--    function body, so these are complete CREATE OR REPLACE statements and
--    every line other than the recorded actor is byte-identical to what was
--    running in production when this migration was written.

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

  -- auth.uid() is the admin is_admin() just validated, three lines up.
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
  -- row already carries no other timestamp for this transition.
  update orders
     set refund_status = 'refunded',
         refunded_by = auth.uid(),
         refunded_at = now()
   where id = p_order_id;
end;
$function$;

-- 3. To read the trail:
--
--   select s.created_at, s.kind, s.amount, d.name as driver, p.name as settled_by
--     from driver_settlements s
--     join drivers d on d.id = s.driver_id
--     left join profiles p on p.id = s.actor
--    order by s.created_at desc;
--
-- Nothing in the admin UI displays this yet -- driver_settlements is not read
-- by the app at all. The data is queryable from the Supabase dashboard, which
-- is what a payment dispute needs. A settlements history screen is separate,
-- larger work.


-- VERIFIED IMMEDIATELY AFTER APPLYING, against production:
--
--   * all four columns present
--   * all four functions still SECURITY DEFINER with search_path = public
--   * all four still check is_admin() -- the guard was not disturbed
--   * all four now record auth.uid()
--   * the public wrappers are untouched and still take p_auth_user_id
--   * the 13 existing settlements and their 72,029.55 EGP are unchanged
--
--   * END TO END: inside a deliberately-aborted DO block, the claim was set the
--     way the wrapper sets it, a throwaway driver holding 7.50 was settled, and
--     the row came back with actor = the calling admin (match=t). The block then
--     raised, so nothing persisted -- confirmed afterwards: no test driver left,
--     still 13 settlements, still 72,029.55.
