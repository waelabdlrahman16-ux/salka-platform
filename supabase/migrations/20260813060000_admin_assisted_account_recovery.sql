-- Temporary no-SMS account recovery. A customer may REQUEST a link, but only
-- an admin who has called the already-known number may approve it.
create table if not exists public.account_recovery_requests (
  id bigint generated always as identity primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (auth_user_id, phone, status)
);
alter table public.account_recovery_requests enable row level security;
revoke all on public.account_recovery_requests from anon, authenticated;

create or replace function private.request_customer_account_recovery(p_phone text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_phone text; v_auth uuid := auth.uid(); v_existing integer;
begin
  if v_auth is null then raise exception 'not_logged_in'; end if;
  v_phone := normalize_phone(p_phone);
  if v_phone is null or v_phone !~ '^1[0-25][0-9]{8}$' then raise exception 'invalid_phone'; end if;
  select id into v_existing from customers where phone = v_phone;
  if v_existing is null then raise exception 'no_account_for_phone'; end if;
  if exists(select 1 from customers where auth_user_id = v_auth and phone = v_phone) then
    raise exception 'already_linked';
  end if;
  insert into account_recovery_requests(auth_user_id, phone)
  values (v_auth, v_phone)
  on conflict (auth_user_id, phone, status) do nothing;
  return json_build_object('ok',true);
end $$;

create or replace function private.admin_pending_account_recoveries()
returns json language plpgsql stable security definer set search_path to 'public' as $$
declare v_result json;
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  select coalesce(json_agg(row_to_json(x) order by x.created_at), '[]'::json) into v_result
    from (select r.id,r.phone,r.created_at,u.email from account_recovery_requests r join auth.users u on u.id=r.auth_user_id where r.status='pending') x;
  return v_result;
end $$;

create or replace function private.admin_approve_account_recovery(p_request_id bigint)
returns json language plpgsql security definer set search_path to 'public' as $$
declare r account_recovery_requests%rowtype; v_legacy integer; v_requester integer; v_claimed integer;
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  select * into r from account_recovery_requests where id=p_request_id and status='pending' for update;
  if not found then raise exception 'recovery_not_pending'; end if;
  select id into v_legacy from customers where phone=r.phone for update;
  if v_legacy is null then raise exception 'no_account_for_phone'; end if;
  if exists(select 1 from customers where id=v_legacy and auth_user_id is not null and auth_user_id<>r.auth_user_id) then raise exception 'phone_already_used'; end if;
  select id into v_requester from customers where auth_user_id=r.auth_user_id for update;
  if v_requester is not null and v_requester<>v_legacy then
    update orders set customer_id=v_legacy where customer_id=v_requester;
    update customer_addresses set customer_id=v_legacy where customer_id=v_requester;
    update customer_sessions set customer_id=v_legacy where customer_id=v_requester;
    delete from customers where id=v_requester;
  end if;
  update customers set auth_user_id=r.auth_user_id where id=v_legacy;
  update orders set customer_id=v_legacy where customer_id is null and normalize_phone(customer_phone)=r.phone;
  get diagnostics v_claimed = row_count;
  update account_recovery_requests set status='approved',reviewed_by=auth.uid(),reviewed_at=now() where id=r.id;
  return json_build_object('ok',true,'claimed_orders',v_claimed);
end $$;

create or replace function public.request_customer_account_recovery(p_phone text,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.request_customer_account_recovery(p_phone); end $$;
create or replace function public.admin_pending_account_recoveries(p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_pending_account_recoveries(); end $$;
create or replace function public.admin_approve_account_recovery(p_request_id bigint,p_auth_user_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $$ begin perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true); return private.admin_approve_account_recovery(p_request_id); end $$;
revoke all on function public.request_customer_account_recovery(text,uuid) from public,anon;
grant execute on function public.request_customer_account_recovery(text,uuid) to authenticated;
revoke all on function public.admin_pending_account_recoveries(uuid),public.admin_approve_account_recovery(bigint,uuid) from public,anon,authenticated;
