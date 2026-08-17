-- Applied to production 2026-08-17 21:07 UTC via Supabase MCP (audit step 9).
-- This file is the record of that change.
--
-- Audit finding 13: rate_limit_log kept about an hour, so no incident older
-- than that could be investigated. When the unauthenticated order-creation hole
-- was found on 2026-08-16 it had been open three days, and the question "was it
-- used?" was unanswerable -- the evidence had already been deleted, repeatedly,
-- by the rate limiter itself.
--
-- The pruning lived inside check_rate_limit and ran on EVERY call:
--
--   delete from rate_limit_log where called_at < now() - greatest(p_window, interval '1 hour');
--
-- Two problems in one line. It capped retention at an hour, and it could not
-- use an index: the only usable index was (bucket, called_at), which leads on
-- bucket, so a `where called_at < X` delete fell back to a sequential scan. At
-- roughly 1,216 rate-limited requests an hour that is ~29,000 sequential scans
-- a day on the hot path of every edge function, and the bloat showed -- 2,056 kB
-- of table holding 1,216 live rows.
--
-- So: take the delete off the request path entirely and give the job to cron.
--
-- ROLLBACK, verbatim from production as it was before this migration:
--
--   CREATE OR REPLACE FUNCTION public.check_rate_limit(p_bucket text, p_max integer, p_window interval)
--   RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
--   begin
--     delete from rate_limit_log where called_at < now() - greatest(p_window, interval '1 hour');
--     if (select count(*) from rate_limit_log where bucket = p_bucket and called_at > now() - p_window) >= p_max then
--       raise exception 'rate_limited';
--     end if;
--     insert into rate_limit_log (bucket) values (p_bucket);
--   end;
--   $f$;
--   select cron.unschedule('prune-rate-limit-log');
--
-- IS THE CRON JOB ACTUALLY RUNNING? Nothing shouts if it stops, so check:
--
--   select jobname, status, start_time, return_message
--     from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'prune-rate-limit-log')
--    order by start_time desc limit 5;
--
-- If it has been failing, the table grows by ~29,000 rows a day -- slow enough
-- to notice long before it matters, but worth a glance if disk use drifts.

-- 1. An index the cleanup can actually use. Cheap to add: the table is small
--    right now precisely because it has been over-pruned.
CREATE INDEX IF NOT EXISTS rate_limit_log_called_at_idx
  ON public.rate_limit_log (called_at);

-- 2. The same function, minus the delete. Everything else is byte-identical to
--    what was running: same signature, same SECURITY DEFINER, same search_path,
--    same counting logic, same 'rate_limited' exception the edge functions match
--    on via isRateLimitError(). Written out in full rather than patched, because
--    the 2026-08-13 outage came from a migration doing a string replace on a
--    function body.
--
--    The counting query is unaffected by the larger table: it filters on
--    (bucket, called_at), which the existing rate_limit_log_bucket_idx serves
--    directly.
CREATE OR REPLACE FUNCTION public.check_rate_limit(p_bucket text, p_max integer, p_window interval)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if (select count(*) from rate_limit_log where bucket = p_bucket and called_at > now() - p_window) >= p_max then
    raise exception 'rate_limited';
  end if;
  insert into rate_limit_log (bucket) values (p_bucket);
end;
$function$;

-- 3. Prune once a day instead, keeping 30 days. At ~29,000 rows a day that
--    settles around 875,000 rows -- large enough to answer "was this exploited
--    last week", small enough to be unremarkable for Postgres, and it uses the
--    index added above.
--
--    03:17 UTC is 05:17 in Cairo: past the late-night orders, well before the
--    morning. The odd minute avoids sharing a tick with the two existing jobs.
SELECT cron.schedule(
  'prune-rate-limit-log',
  '17 3 * * *',
  $$delete from public.rate_limit_log where called_at < now() - interval '30 days'$$
);

-- Verified immediately after applying, against production:
--   * three calls to a throwaway bucket with p_max = 2: allow, allow, then
--     raise -- and the message is exactly 'rate_limited', which is what
--     isRateLimitError() in _shared/secure.ts matches on
--   * cron job present and active, schedule '17 3 * * *'
--   * the delete is gone from the function body
--   * service_role still holds EXECUTE
--   * live traffic unaffected: 112 rate-limit checks in the following 2 minutes
