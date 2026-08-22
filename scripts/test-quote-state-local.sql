-- Run only against the disposable schema-only local database.
-- It creates no production data and rolls every fixture back at the end.
begin;

do $test$
declare
  v_supervisor uuid := '11111111-1111-4111-8111-111111111111';
  v_admin uuid := '22222222-2222-4222-8222-222222222222';
  v_order integer;
  v_expiring_order integer;
  v_reminder_order integer;
  v_rejected_order integer;
  v_admin_order integer;
  v_quote bigint;
  v_reminder_quote bigint;
  v_repeat json;
  v_accept json;
  v_expired json;
  v_rejected json;
  v_rejected_state text;
  v_sweep integer;
begin
  insert into public.settings (key, value, label, kind, required, min_value, max_value)
  values
    ('service_fee_percent', '0', 'test', 'numeric', true, 0, 100),
    ('cod_deposit_threshold_egp', '300', 'test', 'numeric', true, 0, 1000000),
    ('cod_deposit_percent', '50', 'test', 'numeric', true, 0, 100),
    ('quote_admin_approval_ceiling_egp', '3000', 'test', 'numeric', true, 0, 1000000)
  on conflict (key) do update set value = excluded.value;

  insert into auth.users (id, aud, role, email, created_at, updated_at)
  values (v_supervisor, 'authenticated', 'authenticated', 'quote-supervisor@example.test', now(), now()),
         (v_admin, 'authenticated', 'authenticated', 'quote-admin@example.test', now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, role, name)
  values (v_supervisor, 'supervisor', 'Quote test supervisor'),
         (v_admin, 'admin', 'Quote test admin')
  on conflict (id) do update set role = excluded.role;

  insert into public.orders (
    customer_name, customer_phone, zone, unit_number, subtotal, delivery_fee,
    total, order_type, pricing_status, status, payment_method
  ) values ('Quote test', '01000000001', 'test', '1', 0, 50, 50,
            'custom_request', 'pending_quote', 'awaiting_quote', 'cod')
  returning id into v_order;

  if (select quote_state from public.orders where id = v_order) <> 'pending' then
    raise exception 'new_custom_order_did_not_start_pending';
  end if;

  select (public.issue_custom_order_quote(v_order, 100, null, gen_random_uuid(), v_supervisor)->>'quote_id')::bigint
    into v_quote;
  if (select quote_state from public.orders where id = v_order) <> 'offered' then
    raise exception 'issue_did_not_offer_quote';
  end if;

  v_repeat := public.issue_custom_order_quote(v_order, 100, null, gen_random_uuid(), v_supervisor);
  if (v_repeat->>'quote_id')::bigint <> v_quote then
    raise exception 'identical_offer_did_not_reuse_current_version';
  end if;

  begin
    update public.orders set kitchen_status = 'preparing' where id = v_order;
    raise exception 'unaccepted_quote_allowed_fulfilment';
  exception when others then
    if sqlerrm <> 'quote_not_accepted' then raise; end if;
  end;

  v_accept := public.accept_custom_order_quote(
    v_order, v_quote, (select public_token from public.orders where id = v_order), gen_random_uuid(), null
  );
  if v_accept->>'state' <> 'accepted'
     or (select quote_state from public.orders where id = v_order) <> 'accepted'
     or (select total from public.orders where id = v_order) <> 150 then
    raise exception 'acceptance_did_not_persist_frozen_quote';
  end if;

  begin
    perform public.issue_custom_order_quote(v_order, 110, null, gen_random_uuid(), v_supervisor);
    raise exception 'accepted_quote_was_repriced';
  exception when others then
    if sqlerrm <> 'quote_not_pending' then raise; end if;
  end;

  insert into public.orders (
    customer_name, customer_phone, zone, unit_number, subtotal, delivery_fee,
    total, order_type, pricing_status, status, payment_method
  ) values ('Expiry test', '01000000002', 'test', '2', 0, 50, 50,
            'custom_request', 'pending_quote', 'awaiting_quote', 'cod')
  returning id into v_expiring_order;
  select (public.issue_custom_order_quote(v_expiring_order, 100, null, gen_random_uuid(), v_supervisor)->>'quote_id')::bigint
    into v_quote;
  update public.order_quotes
     set issued_at = now() - interval '20 minutes', expires_at = now() - interval '5 minutes'
   where id = v_quote;
  v_expired := public.accept_custom_order_quote(
    v_expiring_order, v_quote,
    (select public_token from public.orders where id = v_expiring_order), gen_random_uuid(), null
  );
  if v_expired->>'state' <> 'expired'
     or (select quote_state from public.orders where id = v_expiring_order) <> 'expired' then
    raise exception 'late_acceptance_did_not_persist_expiry';
  end if;

  -- The minute sweep must mark a final-two-minute reminder once, then persist
  -- one expiry and return zero on a repeat sweep. Push transport is intentionally
  -- not asserted here because this isolated database has no device token.
  insert into public.orders (
    customer_name, customer_phone, zone, unit_number, subtotal, delivery_fee,
    total, order_type, pricing_status, status, payment_method
  ) values ('Reminder test', '01000000005', 'test', '5', 0, 50, 50,
            'custom_request', 'pending_quote', 'awaiting_quote', 'cod')
  returning id into v_reminder_order;
  select (public.issue_custom_order_quote(v_reminder_order, 100, null, gen_random_uuid(), v_supervisor)->>'quote_id')::bigint
    into v_reminder_quote;
  update public.order_quotes set expires_at = now() + interval '1 minute'
   where id = v_reminder_quote;
  v_sweep := public.expire_custom_order_quotes();
  if v_sweep <> 0
     or (select reminder_sent_at is not null from public.order_quotes where id = v_reminder_quote) is not true then
    raise exception 'final_two_minute_reminder_did_not_persist: result=%, state=%, expiry=%, reminder=%',
      v_sweep,
      (select state from public.order_quotes where id = v_reminder_quote),
      (select expires_at from public.order_quotes where id = v_reminder_quote),
      (select reminder_sent_at from public.order_quotes where id = v_reminder_quote);
  end if;
  if public.expire_custom_order_quotes() <> 0 then
    raise exception 'reminder_sweep_should_not_expire_live_quote';
  end if;
  update public.order_quotes
     set issued_at = now() - interval '3 minutes',
         expires_at = now() - interval '1 second'
   where id = v_reminder_quote;
  v_sweep := public.expire_custom_order_quotes();
  if v_sweep <> 1
     or (select quote_state from public.orders where id = v_reminder_order) <> 'expired' then
    raise exception 'sweep_did_not_persist_expiry: result=%, quote_state=%, quote_row_state=%',
      v_sweep,
      (select quote_state from public.orders where id = v_reminder_order),
      (select state from public.order_quotes where id = v_reminder_quote);
  end if;
  if public.expire_custom_order_quotes() <> 0 then
    raise exception 'repeat_expiry_sweep_was_not_idempotent';
  end if;

  insert into public.orders (
    customer_name, customer_phone, zone, unit_number, subtotal, delivery_fee,
    total, order_type, pricing_status, status, payment_method
  ) values ('Reject test', '01000000004', 'test', '4', 0, 50, 50,
            'custom_request', 'pending_quote', 'awaiting_quote', 'cod')
  returning id into v_rejected_order;
  select (public.issue_custom_order_quote(v_rejected_order, 100, null, gen_random_uuid(), v_supervisor)->>'quote_id')::bigint
    into v_quote;
  v_rejected := public.reject_custom_order_quote(
        v_rejected_order, v_quote,
        (select public_token from public.orders where id = v_rejected_order),
        'test rejection', gen_random_uuid(), null
      );
  select quote_state into v_rejected_state from public.orders where id = v_rejected_order;
  if v_rejected->>'state' <> 'rejected' or v_rejected_state <> 'rejected' then
    raise exception 'rejection_did_not_persist: response=%, state=%', v_rejected, v_rejected_state;
  end if;

  begin
    perform public.issue_custom_order_quote(v_expiring_order, 4000, null, gen_random_uuid(), v_supervisor);
    raise exception 'supervisor_bypassed_quote_ceiling';
  exception when others then
    if sqlerrm <> 'quote_requires_admin_approval' then raise; end if;
  end;

  insert into public.orders (
    customer_name, customer_phone, zone, unit_number, subtotal, delivery_fee,
    total, order_type, pricing_status, status, payment_method
  ) values ('Admin ceiling test', '01000000003', 'test', '3', 0, 50, 50,
            'custom_request', 'pending_quote', 'awaiting_quote', 'cod')
  returning id into v_admin_order;
  if (public.issue_custom_order_quote(v_admin_order, 4000, null, gen_random_uuid(), v_admin)->>'state') <> 'offered' then
    raise exception 'admin_could_not_issue_over_ceiling_quote';
  end if;
end;
$test$;

rollback;
