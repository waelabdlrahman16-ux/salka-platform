-- ============================================================
-- Talah Platform - Driver shifts + swap requests
-- Run ONCE in Supabase SQL Editor, after launch.sql
-- ============================================================

create table if not exists shifts (
  id serial primary key,
  driver_id int references drivers(id) not null,
  shift_date date not null,
  start_time time not null,
  end_time time not null,
  status text not null default 'scheduled',  -- scheduled / swapped / cancelled
  created_at timestamptz default now()
);

create table if not exists shift_swap_requests (
  id serial primary key,
  shift_id int references shifts(id) not null,
  requested_by int references drivers(id) not null,
  reason text default '',
  status text not null default 'open',  -- open / accepted / escalated / cancelled
  accepted_by int references drivers(id),
  accepted_at timestamptz,
  escalated_at timestamptz,
  created_at timestamptz default now()
);

alter table shifts enable row level security;
alter table shift_swap_requests enable row level security;

drop policy if exists "read shifts" on shifts;
create policy "read shifts" on shifts for select
  using (is_admin() or driver_id = my_driver_id());
drop policy if exists "admin writes shifts" on shifts;
create policy "admin writes shifts" on shifts for all
  using (is_admin()) with check (is_admin());
drop policy if exists "driver reads own shift via swap" on shifts;
create policy "driver reads open swap shifts" on shifts for select
  using (exists (
    select 1 from shift_swap_requests r
    where r.shift_id = shifts.id and r.status = 'open'
  ));

drop policy if exists "read swap requests" on shift_swap_requests;
create policy "read swap requests" on shift_swap_requests for select
  using (is_admin() or requested_by = my_driver_id() or status = 'open');
drop policy if exists "admin manages swap requests" on shift_swap_requests;
create policy "admin manages swap requests" on shift_swap_requests for all
  using (is_admin()) with check (is_admin());

-- Driver requests a swap on his own shift
create or replace function request_swap(p_shift_id int, p_reason text default '')
returns json language plpgsql security definer as $$
declare v_driver int; v_id int;
begin
  v_driver := my_driver_id();
  if v_driver is null then raise exception 'not_a_driver'; end if;

  if not exists (select 1 from shifts where id = p_shift_id and driver_id = v_driver
                 and status = 'scheduled') then
    raise exception 'not_your_shift';
  end if;

  if exists (select 1 from shift_swap_requests
             where shift_id = p_shift_id and status = 'open') then
    raise exception 'already_requested';
  end if;

  insert into shift_swap_requests (shift_id, requested_by, reason)
  values (p_shift_id, v_driver, trim(p_reason))
  returning id into v_id;

  return json_build_object('request_id', v_id);
end; $$;

-- Another driver accepts and takes over the shift
create or replace function accept_swap(p_request_id int)
returns json language plpgsql security definer as $$
declare v_driver int; v_shift int; v_owner int;
begin
  v_driver := my_driver_id();
  if v_driver is null then raise exception 'not_a_driver'; end if;

  select shift_id, requested_by into v_shift, v_owner
  from shift_swap_requests where id = p_request_id and status = 'open' for update;

  if v_shift is null then raise exception 'request_unavailable'; end if;
  if v_owner = v_driver then raise exception 'cannot_accept_own_request'; end if;

  update shift_swap_requests
  set status = 'accepted', accepted_by = v_driver, accepted_at = now()
  where id = p_request_id;

  update shifts set driver_id = v_driver, status = 'swapped' where id = v_shift;

  return json_build_object('ok', true);
end; $$;

-- No one accepted - forward straight to admin
create or replace function escalate_swap(p_request_id int)
returns void language plpgsql security definer as $$
declare v_driver int;
begin
  v_driver := my_driver_id();
  if v_driver is null then raise exception 'not_a_driver'; end if;

  if not exists (select 1 from shift_swap_requests
                 where id = p_request_id and requested_by = v_driver and status = 'open') then
    raise exception 'not_your_request';
  end if;

  update shift_swap_requests set status = 'escalated', escalated_at = now()
  where id = p_request_id;
end; $$;

-- Open swap requests, with shift + requester details (for the driver marketplace view)
create or replace function open_swaps()
returns json language sql security definer stable as $$
  select coalesce(json_agg(row_to_json(x)), '[]'::json) from (
    select r.id as request_id, r.reason, r.created_at,
           s.id as shift_id, s.shift_date, s.start_time, s.end_time,
           d.name as requested_by_name
    from shift_swap_requests r
    join shifts s on s.id = r.shift_id
    join drivers d on d.id = r.requested_by
    where r.status = 'open'
    order by s.shift_date, s.start_time
  ) x;
$$;

grant execute on function request_swap(int, text) to authenticated;
grant execute on function accept_swap(int) to authenticated;
grant execute on function escalate_swap(int) to authenticated;
grant execute on function open_swaps() to authenticated;
