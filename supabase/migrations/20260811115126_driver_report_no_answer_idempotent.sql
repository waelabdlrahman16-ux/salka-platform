-- Reconciled from production migration history. Already applied in project pqpnwxyevrsipklzmwex.
-- Do not apply this file to production again.

create or replace function private.driver_report_no_answer(p_assignment_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_driver int; v_order_id int; v_out_at timestamptz; v_called_at timestamptz; v_already timestamptz;
begin
  v_driver := my_driver_id();
  if v_driver is null then raise exception 'not_a_driver'; end if;

  select order_id, out_for_delivery_at, called_customer_at, no_answer_reported_at
    into v_order_id, v_out_at, v_called_at, v_already
    from delivery_assignments where id = p_assignment_id and driver_id = v_driver;
  if v_order_id is null then raise exception 'not_your_assignment'; end if;
  if v_called_at is null then raise exception 'must_call_customer_first'; end if;
  if v_out_at is null or now() - v_out_at < interval '5 minutes' then raise exception 'too_early'; end if;
  -- Idempotent: a second tap (or the client's built-in retry-on-network-failure)
  -- must not page admin a second time about the same no-answer event.
  if v_already is not null then return; end if;

  update delivery_assignments set no_answer_reported_at = now() where id = p_assignment_id;
  perform notify_admin('العميل ما ردش ☎️', 'طلب #' || v_order_id || ' — المندوب اتصل والعميل ما ردش، محتاج قرار',
    jsonb_build_object('order_id', v_order_id, 'type', 'no_answer'));
end; $function$;
