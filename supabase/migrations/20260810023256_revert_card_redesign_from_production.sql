-- Reverting the card-redesign work out of production. It belongs on the branch
-- with the client that uses it, and nothing on main reads any of it.
--
-- The item that actually mattered: the `vendor-open-reminders` cron was firing
-- EVERY MINUTE against production for a feature no deployed client can reach --
-- running deletes and a vendor_is_open_now() scan sixty times an hour for
-- nothing. That is the real cost of leaving unmerged work applied.

-- 1. Stop the cron first, so nothing is mid-run while its function disappears.
select cron.unschedule('vendor-open-reminders')
 where exists (select 1 from cron.job where jobname = 'vendor-open-reminders');

-- 2. Restore restaurants_for_compound to its pre-branch shape. This is the only
--    object here that CHANGED an existing contract rather than adding a new
--    one, so it is the only one whose revert could be felt. Checked
--    substitution in reverse, so a drifted definition fails loudly instead of
--    being silently overwritten with a stale copy.
do $$
declare
  v_def text; v_hits int;
  c_added constant text := '
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

  if v_def not ilike '%order_count_30d%' then
    raise notice 'already reverted';
  else
    v_hits := (length(v_def) - length(replace(v_def, c_added, ''))) / greatest(length(c_added),1);
    if v_hits <> 1 then raise exception 'expected 1 added block, found % -- refusing to guess', v_hits; end if;
    execute replace(v_def, c_added, '');
  end if;
end $$;

-- 3. The rest were additive and unreachable from main, but "unreachable" is not
--    "absent", and a table sitting in production for an unshipped feature is
--    how schemas rot.
drop function if exists public.notify_vendor_open_reminders();
drop function if exists public.remind_me_when_open(integer, text, text, text);
drop function if exists public.remind_me_when_open(integer, text, text);
drop table if exists public.vendor_open_reminders;
