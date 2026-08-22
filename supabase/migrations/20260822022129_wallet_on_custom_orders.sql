-- A wallet balance that هنجبلك orders could never spend.
--
-- Canonical rule 2 says the backend calculates "delivery, service fee,
-- discounts, wallet use, total, and deposit". Wallet use was the one it could
-- not: submit_custom_order inserts an order without touching wallet_used, the
-- quote snapshot then computed `least(orders.wallet_used, total)` against that
-- permanent zero, and accept_custom_order_quote copied the zero onto the order.
-- Its refund branch -- greatest(0, order.wallet_used - quote.wallet_used) --
-- could never fire, because both sides were always 0.
--
-- The data agreed: 0 of 108 custom orders and 0 of 14 pickup orders have ever
-- used wallet balance. 1 of 165 catalog orders has. Customers with credit were
-- quietly unable to spend it on the one order type where the amounts are
-- largest.
--
-- WHERE THE CUSTOMER CHOOSES. At submit, exactly like pending_promo_code: the
-- request records what was asked for, and it is applied once there is a price.
-- Not automatically, because a balance is the customer's to spend where they
-- want, and catalog checkout already asks. Not at acceptance, because the
-- amount has to be inside the frozen quote for the customer to accept it.
--
-- WHAT HAPPENS IF THE BALANCE MOVES between issue and acceptance. Acceptance
-- refuses with wallet_balance_changed and the customer renews. The alternative
-- -- spend what is left and raise the amount due -- would charge a total the
-- customer never agreed to, which is the exact surprise a 15-minute immutable
-- quote exists to prevent. Renewing costs one tap and produces an honest offer.
--
-- SCOPE. custom_request only. pickup_request is untouched: there the driver
-- pays the vendor at the door and collects cash, so there is no Salka-side
-- balance to draw down. Say so out loud rather than leave it looking forgotten.

-- ---------------------------------------------------------------------------
-- 1. The customer's intent, recorded at submit.
-- ---------------------------------------------------------------------------
alter table orders add column if not exists use_wallet boolean not null default false;

comment on column orders.use_wallet is
  'Customer asked at submit to spend wallet balance on this order. Read by custom_order_quote_snapshot when it prices a quote; settled by accept_custom_order_quote.';

-- ---------------------------------------------------------------------------
-- 2. Carry the intent through submit.
-- ---------------------------------------------------------------------------
-- Dropped and recreated rather than given a new overload: a defaulted extra
-- parameter would leave two candidates for a call that omits it, and PostgREST
-- resolves by argument name. Both statements are in this one migration, so the
-- swap is atomic and no request can land between them.
--
-- private.submit_custom_order is deliberately NOT touched. The intent is
-- stamped here afterwards, in the same transaction, exactly as customer_id
-- already is -- the hot path keeps the signature it has today.
drop function if exists public.submit_custom_order(integer,text,text,text,text,text,numeric,json,text,integer,uuid,integer,date,text,text,uuid,text);

create function public.submit_custom_order(
  p_restaurant_id integer, p_customer_name text, p_customer_phone text, p_zone text,
  p_unit_number text, p_address_notes text, p_delivery_fee numeric, p_request_items json,
  p_request_notes text, p_compound_id integer default null::integer,
  p_session_token uuid default null::uuid, p_slot_id integer default null::integer,
  p_scheduled_date date default null::date, p_prescription_path text default null::text,
  p_rate_key text default null::text, p_auth_user_id uuid default null::uuid,
  p_promo_code text default null::text, p_use_wallet boolean default false)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone text; v_items json := coalesce(p_request_items, '[]'::json);
  v_bucket text; v_recent integer; v_result json; v_customer_id integer;
begin
  v_phone := normalize_phone(p_customer_phone);
  if length(btrim(coalesce(p_customer_name, ''))) not between 2 and 100 then raise exception 'invalid_customer_name'; end if;
  if v_phone is null or v_phone !~ '^1[0-25][0-9]{8}$' then raise exception 'invalid_phone'; end if;
  if length(btrim(coalesce(p_zone, ''))) not between 1 and 120 then raise exception 'invalid_zone'; end if;
  if length(btrim(coalesce(p_unit_number, ''))) not between 1 and 100 then raise exception 'invalid_unit_number'; end if;
  if length(coalesce(p_address_notes, '')) > 1000 or length(coalesce(p_request_notes, '')) > 2000 then raise exception 'notes_too_long'; end if;
  if json_typeof(v_items) <> 'array' then raise exception 'invalid_items'; end if;
  if json_array_length(v_items) > 50 then raise exception 'invalid_item_count'; end if;
  if exists (select 1 from json_array_elements(v_items) item where json_typeof(item) <> 'object'
    or length(btrim(coalesce(item->>'name',''))) not between 1 and 200
    or not (coalesce(item->>'qty','') ~ '^[0-9]{1,3}$' and (item->>'qty')::numeric between 1 and 100)
  ) then raise exception 'invalid_item'; end if;
  if p_rate_key is null or p_rate_key !~ '^[0-9a-f]{64}$' then raise exception 'invalid_rate_key'; end if;

  v_bucket := 'order-hmac:' || p_rate_key;
  perform pg_advisory_xact_lock(hashtextextended(v_bucket, 0));
  select count(*) into v_recent from rate_limit_log where bucket = v_bucket and called_at > now() - interval '15 minutes';
  if v_recent >= 5 then raise exception 'order_rate_limit'; end if;
  select count(*) into v_recent from rate_limit_log where bucket = v_bucket and called_at > now() - interval '24 hours';
  if v_recent >= 20 then raise exception 'daily_order_limit'; end if;

  if p_auth_user_id is not null then
    perform set_config('request.jwt.claim.sub', p_auth_user_id::text, true);
    select id into v_customer_id from customers where auth_user_id = p_auth_user_id limit 1;
  end if;

  v_result := private.submit_custom_order(
    p_restaurant_id, p_customer_name, v_phone, p_zone, p_unit_number, p_address_notes,
    p_delivery_fee, v_items, p_request_notes, p_compound_id, p_session_token,
    p_slot_id, p_scheduled_date, p_prescription_path, p_promo_code
  );

  if v_customer_id is not null then
    update orders
       set customer_id = v_customer_id
     where id = (v_result->>'id')::integer;
  end if;

  -- Same transaction as the insert above, so an order can never exist without
  -- the answer to "did they ask to use their balance?".
  if coalesce(p_use_wallet, false) then
    update orders set use_wallet = true where id = (v_result->>'id')::integer;
  end if;

  insert into rate_limit_log(bucket) values (v_bucket);
  return v_result;
end;
$function$;

-- Restored exactly as they were on the dropped function.
grant execute on function public.submit_custom_order(integer,text,text,text,text,text,numeric,json,text,integer,uuid,integer,date,text,text,uuid,text,boolean) to public;
grant execute on function public.submit_custom_order(integer,text,text,text,text,text,numeric,json,text,integer,uuid,integer,date,text,text,uuid,text,boolean) to anon;
grant execute on function public.submit_custom_order(integer,text,text,text,text,text,numeric,json,text,integer,uuid,integer,date,text,text,uuid,text,boolean) to authenticated;
grant execute on function public.submit_custom_order(integer,text,text,text,text,text,numeric,json,text,integer,uuid,integer,date,text,text,uuid,text,boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Price the wallet into the quote.
-- ---------------------------------------------------------------------------
-- The only change from 20260822004717 is the wallet block. It reads the LIVE
-- balance instead of orders.wallet_used, which was the permanent zero.
--
-- `balance + already-held` is not double counting: anything this order has
-- already taken from the wallet is money the order is holding, and re-pricing
-- it must be able to offer that same money back. accept_custom_order_quote
-- settles only the difference, so the two functions agree by construction.
create or replace function private.custom_order_quote_snapshot(p_order_id integer, p_subtotal numeric)
returns table(subtotal numeric, delivery_fee numeric, service_fee numeric, promo_code_id integer, promo_discount numeric, promo_discount_service numeric, promo_discount_delivery numeric, promo_discount_vendor numeric, wallet_used numeric, total numeric, payment_method text, deposit_required boolean, deposit_amount numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order orders%rowtype;
  v_promo promo_codes%rowtype;
  v_service numeric;
  v_discount numeric := 0;
  v_discount_service numeric := 0;
  v_discount_delivery numeric := 0;
  v_discount_vendor numeric := 0;
  v_total numeric;
  v_wallet numeric;
  v_balance numeric;
  v_deposit numeric := 0;
begin
  if p_subtotal is null or p_subtotal < 0 then raise exception 'invalid_amount'; end if;

  select * into v_order
    from orders
   where id = p_order_id and order_type = 'custom_request';
  if not found then raise exception 'order_not_found'; end if;
  if v_order.status = 'Cancelled' then raise exception 'order_closed'; end if;

  v_service := private.service_fee_for(p_subtotal);

  if v_order.promo_code_id is not null then
    select * into v_promo from promo_codes where id = v_order.promo_code_id;
    if found then
      v_discount := private.promo_discount_for(
        v_promo, p_subtotal, coalesce(v_order.delivery_fee, 0), v_service);
      select cut_service, cut_delivery, cut_vendor
        into v_discount_service, v_discount_delivery, v_discount_vendor
        from private.promo_split(
          v_promo.applies_to, v_discount, coalesce(v_order.delivery_fee, 0), v_service);
    end if;
  end if;

  v_total := greatest(0, p_subtotal + coalesce(v_order.delivery_fee, 0) + v_service - v_discount);

  -- Only if the customer asked at submit. A balance is theirs to spend where
  -- they choose, and this is the screen that tells them what it bought.
  if coalesce(v_order.use_wallet, false) then
    select coalesce(w.balance, 0) into v_balance
      from customer_wallets w
     where w.phone = normalize_phone(v_order.customer_phone);
    v_wallet := least(coalesce(v_balance, 0) + coalesce(v_order.wallet_used, 0), v_total);
  else
    v_wallet := 0;
  end if;

  -- orders.total is the net amount due after any wallet contribution. The
  -- deposit threshold and amount must use that same net number.
  v_total := v_total - v_wallet;

  if v_order.payment_method = 'cod'
     and v_total > private.setting_num('cod_deposit_threshold_egp') then
    v_deposit := least(
      ceil(v_total * private.setting_num('cod_deposit_percent') / 100.0),
      v_total
    );
  end if;

  return query select
    p_subtotal,
    coalesce(v_order.delivery_fee, 0),
    v_service,
    v_order.promo_code_id::integer,
    v_discount,
    v_discount_service,
    v_discount_delivery,
    v_discount_vendor,
    v_wallet,
    v_total,
    v_order.payment_method,
    v_deposit > 0,
    v_deposit;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Move the money at acceptance -- once, and only what is owed.
-- ---------------------------------------------------------------------------
-- The old code only ever refunded. It never debited, so accepting a quote set
-- orders.wallet_used and reduced the total while the customer's balance sat
-- untouched: had the snapshot ever produced a number, the discount would have
-- been given away for free.
--
-- Settling a DELTA rather than debiting outright is what makes this safe to run
-- more than once. First acceptance: held = 0, so the delta is the whole amount.
-- After a re-quote: only the difference moves, in whichever direction. And a
-- second call on an already-accepted quote returns early above, so nothing
-- double-debits.
create or replace function private.accept_custom_order_quote(p_order_id integer, p_quote_id bigint, p_order_token uuid, p_idempotency_key uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order orders%rowtype;
  v_quote order_quotes%rowtype;
  v_held numeric;
  v_delta numeric;
  v_balance numeric;
  v_wallet_id int;
  v_payment_due boolean;
  v_next_status text;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.public_token <> p_order_token then raise exception 'invalid_quote_token'; end if;
  if v_order.status = 'Cancelled' then raise exception 'order_closed'; end if;

  select * into v_quote from order_quotes where id = p_quote_id and order_id = p_order_id for update;
  if not found then raise exception 'quote_not_found'; end if;
  if v_order.current_quote_id is distinct from v_quote.id then raise exception 'quote_not_current'; end if;
  if v_quote.state = 'accepted' then
    return json_build_object('quote_id', v_quote.id, 'state', 'accepted', 'order_status', v_order.status);
  end if;
  if v_quote.state <> 'offered' then raise exception 'quote_not_offered'; end if;
  if v_quote.expires_at <= now() then
    update order_quotes set state = 'expired' where id = v_quote.id;
    update orders set quote_state = 'expired' where id = p_order_id;
    insert into order_status_events (order_id, from_status, to_status, actor)
      values (p_order_id, 'quote:offered', 'quote:expired', 'system');
    perform private.record_order_event(
      p_order_id, 'quote.expired', 'quote',
      jsonb_build_object('state', 'offered', 'quote_id', v_quote.id),
      jsonb_build_object('state', 'expired', 'quote_id', v_quote.id),
      'system', null, p_idempotency_key
    );
    perform private.notify_quote_customer(
      p_order_id, v_quote.id, 'quote_expired', 'سالكة — انتهت صلاحية عرض السعر',
      'العرض انتهى. هنراجع طلبك ونبعتلك عرض جديد لو لسه محتاجه'
    );
    -- Do not raise here: an uncaught exception would roll back the state/event
    -- and transactional push request above. The caller reloads and renders the
    -- persisted terminal quote state instead.
    return json_build_object('quote_id', v_quote.id, 'state', 'expired');
  end if;

  -- The quote snapshot is now authoritative. No live pricing helper is called
  -- here, so later settings or promotion changes cannot rewrite customer terms.
  --
  -- SETTLE THE WALLET. v_held is what this order already holds from the wallet;
  -- v_delta is what still has to move to match the frozen quote.
  v_held  := coalesce(v_order.wallet_used, 0);
  v_delta := coalesce(v_quote.wallet_used, 0) - v_held;

  if v_delta <> 0 then
    select id, balance into v_wallet_id, v_balance
      from customer_wallets
     where phone = normalize_phone(v_order.customer_phone)
     for update;

    if v_delta > 0 then
      -- The customer accepted "wallet -X, pay Y". If the balance moved since
      -- the quote was issued we cannot fund X, and charging a different Y is
      -- the precise surprise a frozen quote exists to prevent. Refuse, and let
      -- them renew into an offer that is true.
      if v_wallet_id is null or coalesce(v_balance, 0) < v_delta then
        raise exception 'wallet_balance_changed';
      end if;
      update customer_wallets set balance = balance - v_delta where id = v_wallet_id;
      insert into wallet_transactions (wallet_id, amount, reason, order_id)
        values (v_wallet_id, -v_delta, 'استخدام الرصيد في طلب #' || p_order_id, p_order_id);
    elsif v_wallet_id is not null then
      -- Negative delta: this order holds more than the new quote uses. Give the
      -- difference back. (balance - v_delta with v_delta < 0 is a credit.)
      update customer_wallets set balance = balance - v_delta where id = v_wallet_id;
      insert into wallet_transactions (wallet_id, amount, reason, order_id)
        values (v_wallet_id, -v_delta, 'استرجاع رصيد بعد قبول عرض سعر', p_order_id);
    end if;
  end if;

  v_payment_due := (v_quote.deposit_required or (v_quote.payment_method in ('online', 'instapay') and v_quote.total > 0));
  v_next_status := case
    when v_payment_due then 'awaiting_payment'
    when v_order.slot_id is not null and coalesce(v_order.dispatch_at, v_order.created_at) > now() then 'Scheduled'
    else 'pending'
  end;

  update order_quotes
     set state = 'accepted', accepted_at = now(), accepted_by = auth.uid()
   where id = v_quote.id;

  update orders
     set quote_state = 'accepted',
         subtotal = v_quote.subtotal,
         delivery_fee = v_quote.delivery_fee,
         service_fee = v_quote.service_fee,
         promo_code_id = v_quote.promo_code_id,
         promo_discount = v_quote.promo_discount,
         promo_discount_service = v_quote.promo_discount_service,
         promo_discount_delivery = v_quote.promo_discount_delivery,
         promo_discount_vendor = v_quote.promo_discount_vendor,
         wallet_used = v_quote.wallet_used,
         total = v_quote.total,
         pricing_status = 'confirmed',
         cod_deposit_amount = case when v_quote.deposit_required then v_quote.deposit_amount else null end,
         online_payment_status = case when v_payment_due then 'pending' else null end,
         status = v_next_status
   where id = p_order_id;

  insert into order_status_events (order_id, from_status, to_status, actor, actor_uid)
    values (p_order_id, 'quote:offered', 'quote:accepted', 'customer', auth.uid());
  perform private.record_order_event(
    p_order_id, 'quote.accepted', 'quote', jsonb_build_object('state', 'offered', 'quote_id', v_quote.id),
    jsonb_build_object('state', 'accepted', 'quote_id', v_quote.id), 'customer', null, p_idempotency_key
  );
  perform private.record_order_event(
    p_order_id, 'payment.required', 'payment', null,
    jsonb_build_object('deposit_required', v_quote.deposit_required, 'deposit_amount', v_quote.deposit_amount,
      'payment_pending', v_payment_due), 'system', null, p_idempotency_key
  );

  return json_build_object('quote_id', v_quote.id, 'state', 'accepted', 'order_status', v_next_status);
end;
$function$;
