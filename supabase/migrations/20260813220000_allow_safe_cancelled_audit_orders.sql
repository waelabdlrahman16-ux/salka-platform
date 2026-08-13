-- Allow an admin to classify a safely-cancelled audit order as a test order.
-- A cancelled real order with financial/customer history remains immutable.
create or replace function private.admin_mark_order_as_test(p_order_id integer, p_reason text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_cancelled_safe boolean := false;
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  if p_order_id is null or p_order_id <= 0 then raise exception 'invalid_order_id'; end if;
  if v_reason is null or length(v_reason) > 500 then raise exception 'invalid_audit_reason'; end if;

  select status into v_status
    from orders
   where id = p_order_id
   for update;
  if v_status is null then raise exception 'order_not_found'; end if;

  if v_status = 'Cancelled' then
    v_cancelled_safe :=
      not exists (select 1 from driver_earnings where order_id = p_order_id)
      and not exists (select 1 from wallet_transactions where order_id = p_order_id)
      and not exists (select 1 from driver_tips where order_id = p_order_id)
      and not exists (select 1 from promo_redemptions where order_id = p_order_id)
      and not exists (select 1 from complaints where order_id = p_order_id)
      and not exists (select 1 from order_ratings where order_id = p_order_id)
      and not exists (
        select 1 from delivery_assignments
         where order_id = p_order_id and delivered_at is not null
      );

    if not v_cancelled_safe then
      raise exception 'test_order_has_financial_or_customer_history';
    end if;
  elsif v_status not in ('pending', 'Scheduled', 'awaiting_quote', 'awaiting_payment') then
    raise exception 'audit_mark_too_late';
  end if;

  if exists (select 1 from order_test_audit_log where order_id = p_order_id) then
    raise exception 'audit_mark_too_late';
  end if;

  update orders set is_test = true where id = p_order_id;
  insert into order_test_audit_log (order_id, reason, marked_by)
  values (p_order_id, v_reason, auth.uid());

  return json_build_object('order_id', p_order_id, 'is_test', true,
                           'reason', v_reason, 'marked_at', now());
end;
$$;
