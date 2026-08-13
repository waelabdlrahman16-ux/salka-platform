-- Safe cleanup controls: archive closed orders; permanently remove only proven test orders
alter table public.orders
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

create index if not exists orders_archived_at_idx on public.orders (archived_at) where archived_at is not null;

create or replace function private.admin_archive_order(p_order_id integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_status text;
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  if p_order_id is null or p_order_id <= 0 then raise exception 'invalid_order_id'; end if;
  select status into v_status from orders where id = p_order_id for update;
  if v_status is null then raise exception 'order_not_found'; end if;
  if v_status not in ('Delivered', 'Cancelled') then raise exception 'order_not_closed'; end if;
  update orders set archived_at = now(), archived_by = auth.uid() where id = p_order_id;
  return json_build_object('order_id', p_order_id, 'archived_at', now());
end;
$$;

create or replace function public.admin_archive_order(p_order_id integer, p_auth_user_id uuid default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_auth_user_id is not null then
    perform set_config('request.jwt.claim.sub', p_auth_user_id::text, true);
  end if;
  return private.admin_archive_order(p_order_id);
end;
$$;

create or replace function private.admin_delete_test_order(p_order_id integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_is_test boolean; v_status text;
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  if p_order_id is null or p_order_id <= 0 then raise exception 'invalid_order_id'; end if;
  select is_test, status into v_is_test, v_status from orders where id = p_order_id for update;
  if v_status is null then raise exception 'order_not_found'; end if;
  if not coalesce(v_is_test, false) then raise exception 'test_order_required'; end if;
  if v_status not in ('Delivered', 'Cancelled') then raise exception 'order_not_closed'; end if;
  if exists (select 1 from driver_earnings where order_id = p_order_id)
     or exists (select 1 from wallet_transactions where order_id = p_order_id)
     or exists (select 1 from driver_tips where order_id = p_order_id)
     or exists (select 1 from promo_redemptions where order_id = p_order_id)
     or exists (select 1 from complaints where order_id = p_order_id)
     or exists (select 1 from order_ratings where order_id = p_order_id) then
    raise exception 'test_order_has_financial_or_customer_history';
  end if;
  delete from order_test_audit_log where order_id = p_order_id;
  delete from orders where id = p_order_id;
  return json_build_object('order_id', p_order_id, 'deleted', true);
end;
$$;

create or replace function public.admin_delete_test_order(p_order_id integer, p_auth_user_id uuid default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_auth_user_id is not null then
    perform set_config('request.jwt.claim.sub', p_auth_user_id::text, true);
  end if;
  return private.admin_delete_test_order(p_order_id);
end;
$$;

revoke all on function public.admin_archive_order(integer, uuid) from public, anon, authenticated;
revoke all on function public.admin_delete_test_order(integer, uuid) from public, anon, authenticated;
grant execute on function public.admin_archive_order(integer, uuid) to service_role;
grant execute on function public.admin_delete_test_order(integer, uuid) to service_role;
