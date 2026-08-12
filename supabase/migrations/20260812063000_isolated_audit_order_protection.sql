-- A restaurant-wide test flag is safe for fixtures, but it is not usable for
-- one live-production audit. This gives administrators a narrow, one-way way
-- to classify a still-unassigned order as an audit test before anyone can
-- collect cash or earn from it.

create table if not exists public.order_test_audit_log (
  id bigint generated always as identity primary key,
  order_id integer not null unique references public.orders(id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  marked_by uuid not null,
  created_at timestamptz not null default now()
);

alter table public.order_test_audit_log enable row level security;
revoke all on table public.order_test_audit_log from public, anon, authenticated;

create or replace function private.admin_mark_order_as_test(
  p_order_id integer,
  p_reason text
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  if p_order_id is null or p_order_id <= 0 then raise exception 'invalid_order_id'; end if;
  if v_reason is null or length(v_reason) > 500 then raise exception 'invalid_audit_reason'; end if;

  -- Lock first. The test classification must happen before dispatch or any
  -- financial side effect, never as a way to rewrite a completed real order.
  select status into v_status
    from orders
   where id = p_order_id
   for update;
  if v_status is null then raise exception 'order_not_found'; end if;
  if v_status not in ('pending', 'Scheduled', 'awaiting_quote', 'awaiting_payment') then
    raise exception 'audit_mark_too_late';
  end if;
  if exists (select 1 from delivery_assignments where order_id = p_order_id)
     or exists (select 1 from driver_earnings where order_id = p_order_id)
     or exists (select 1 from order_test_audit_log where order_id = p_order_id) then
    raise exception 'audit_mark_too_late';
  end if;

  update orders set is_test = true where id = p_order_id;
  insert into order_test_audit_log (order_id, reason, marked_by)
  values (p_order_id, v_reason, auth.uid());

  return json_build_object('order_id', p_order_id, 'is_test', true,
                           'reason', v_reason, 'marked_at', now());
end;
$function$;

create or replace function public.admin_mark_order_as_test(
  p_order_id integer,
  p_reason text,
  p_auth_user_id uuid default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_auth_user_id is not null then
    perform set_config('request.jwt.claim.sub', p_auth_user_id::text, true);
  end if;
  return private.admin_mark_order_as_test(p_order_id, p_reason);
end;
$function$;

revoke all on function private.admin_mark_order_as_test(integer, text) from public, anon, authenticated;
revoke all on function public.admin_mark_order_as_test(integer, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_mark_order_as_test(integer, text, uuid) to service_role;

do $verification$
declare v_audit boolean;
begin
  if has_function_privilege('anon', 'public.admin_mark_order_as_test(integer,text,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.admin_mark_order_as_test(integer,text,uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_mark_order_as_test(integer,text,uuid)', 'execute') then
    raise exception 'invalid audit-order wrapper privilege';
  end if;
  select relrowsecurity into v_audit
    from pg_class where oid = 'public.order_test_audit_log'::regclass;
  if not coalesce(v_audit, false) then
    raise exception 'audit log RLS is not enabled';
  end if;
end;
$verification$;
