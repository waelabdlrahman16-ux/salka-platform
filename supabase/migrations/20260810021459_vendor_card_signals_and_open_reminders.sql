-- Signals for the redesigned vendor card, plus the one feature behind it that
-- needed real server support.
--
-- Everything here is ADDITIVE. There is no database branching on this project
-- (that is what the failed preview branch was telling us), so this SQL is live
-- the moment it is applied. Nothing below changes an existing return value or
-- an existing behaviour: the deployed client cannot see any of it, and the new
-- client on the branch is the only thing that will read it.

-- 1. «🔥 الأكثر طلباً» needs a per-vendor order count. Thirty days, real orders
--    only. Ranking against the OTHER vendors is left to the client, because the
--    claim is "the most ordered of the ones you can see", and what you can see
--    depends on your compound.
do $$
declare
  v_def text; v_hits int;
  c_old constant text := 'coalesce(rc.n, 0)::int as review_count,';
  c_new constant text := 'coalesce(rc.n, 0)::int as review_count,
           (select count(*) from orders o30
             where o30.restaurant_id = r.id and not o30.is_test
               and o30.status <> ''Cancelled''
               and o30.created_at > now() - interval ''30 days'')::int as order_count_30d,
           (select count(*) from orders ob
             where ob.restaurant_id = r.id and not ob.is_test
               and ob.status in (''pending'',''Scheduled'',''Preparing'',''Driver_Searching''))::int >= 3
             as is_busy,';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='restaurants_for_compound';
  if v_def is null then raise exception 'restaurants_for_compound not found'; end if;
  if v_def ilike '%order_count_30d%' then raise notice 'already present'; return; end if;

  v_hits := (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old);
  if v_hits <> 1 then raise exception 'expected 1 anchor, found %', v_hits; end if;
  execute replace(v_def, c_old, c_new);
end $$;

-- 2. «🔔 فكّرني لما يفتح» — the only tag that could not be derived from data
--    already present. A closed vendor is currently a dead end; on a morning
--    when most of the compound is shut that is the whole visit wasted. This
--    turns it into a subscription.
create table if not exists public.vendor_open_reminders (
  id            bigserial primary key,
  restaurant_id integer not null references public.restaurants(id) on delete cascade,
  phone         text,
  push_token    text,
  created_at    timestamptz not null default now(),
  notified_at   timestamptz,
  -- One pending reminder per person per vendor. Asking twice must not mean
  -- being notified twice.
  unique (restaurant_id, phone, push_token)
);

create index if not exists vendor_open_reminders_pending
  on public.vendor_open_reminders (restaurant_id) where notified_at is null;

alter table public.vendor_open_reminders enable row level security;
-- No policy: reachable only through the SECURITY DEFINER function below, like
-- every other write path in this project.
revoke all on public.vendor_open_reminders from anon, authenticated;
revoke all on sequence public.vendor_open_reminders_id_seq from anon, authenticated;

comment on table public.vendor_open_reminders is
  'Customers waiting to be told a closed vendor has opened. Cleared by the notifier once sent.';

create or replace function public.remind_me_when_open(
  p_restaurant_id integer,
  p_phone         text default null,
  p_push_token    text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_open boolean; v_next timestamptz;
begin
  if p_restaurant_id is null then raise exception 'restaurant_required'; end if;
  if coalesce(trim(p_phone),'') = '' and coalesce(trim(p_push_token),'') = ''
    then raise exception 'contact_required'; end if;

  select vendor_is_open_now(id) into v_open from restaurants
   where id = p_restaurant_id and not archived;
  if v_open is null then raise exception 'vendor_not_found'; end if;
  -- Asking to be reminded about a vendor that is already open is a no-op, not
  -- an error: the customer just tapped a stale screen.
  if v_open then return json_build_object('already_open', true); end if;

  v_next := vendor_next_open_at(p_restaurant_id);

  insert into vendor_open_reminders (restaurant_id, phone, push_token)
  values (p_restaurant_id, nullif(trim(p_phone),''), nullif(trim(p_push_token),''))
  on conflict (restaurant_id, phone, push_token) do nothing;

  return json_build_object('already_open', false, 'opens_at', v_next);
end $$;

revoke all on function public.remind_me_when_open(integer, text, text) from public;
grant execute on function public.remind_me_when_open(integer, text, text) to anon, authenticated;
