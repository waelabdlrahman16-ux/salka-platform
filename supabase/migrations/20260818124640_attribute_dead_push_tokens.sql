-- Applied to production 2026-08-18 via Supabase MCP. This file is the record.
--
-- Unblocks the parked push-token investigation. 127 tokens have died, all inside
-- 14 days, against 18 alive -- roughly nine a day, every one UNREGISTERED. The
-- delivery path itself is healthy (~98% of 5,304 sends succeeded) and the
-- obvious causes were ruled out: the service worker config matches the app
-- config field for field, scripts/check-firebase-sw-version.mjs fails the build
-- on SDK drift, the worker file has not changed since 10 August, and the VAPID
-- key works.
--
-- WHAT COULD NOT BE ANSWERED, AND WHY. dead_push_tokens recorded only
-- (token, err_code, died_at). That cannot distinguish one device re-minting
-- constantly from many devices expiring normally -- and the tempting shortcut
-- makes it worse: FCM tokens share their first ~12 characters across devices in
-- the same project, so counting devices by token prefix produces confident
-- nonsense. That mistake was made twice during the investigation and retracted
-- both times.
--
-- THE DATA WAS ALREADY IN HAND. record_push_result already read profile_id and
-- platform from push_tokens to write push_send_log; the dead-token row simply
-- never received them. Same shape as the money audit finding: nothing needed
-- plumbing, only storing.
--
-- Added: profile_id (whose device), platform (web/android/ios), and
-- token_updated_at. That last one is the important one -- died_at minus it is
-- the token's lifetime, and a token dying three hours after it was minted means
-- something entirely different from one that lasted three weeks.
--
-- WHAT TO RUN IN ~48 HOURS, once rows have accumulated:
--
--   select p.name, d.platform,
--          count(*) as deaths,
--          round(avg(extract(epoch from d.died_at - d.token_updated_at))/3600, 1) as avg_hours_alive
--     from dead_push_tokens d
--     left join profiles p on p.id = d.profile_id
--    where d.died_at > now() - interval '48 hours'
--    group by 1, 2 order by deaths desc;
--
-- One profile dominating with a short average lifetime means a client
-- re-minting. Deaths spread across profiles with long lifetimes is ordinary
-- expiry and needs no fix at all.
--
-- The 127 existing rows stay null. That was never captured.
--
-- ROLLBACK:
--   alter table public.dead_push_tokens
--     drop column profile_id, drop column platform, drop column token_updated_at;
--   -- then restore record_push_result to the version without the three extra
--   -- values and without the coalesce in the on-conflict clause.

alter table public.dead_push_tokens
  add column if not exists profile_id uuid,
  add column if not exists platform text,
  add column if not exists token_updated_at timestamptz;

comment on column public.dead_push_tokens.profile_id is
  'Whose device this token belonged to. Null for the 127 rows that died before 2026-08-18.';
comment on column public.dead_push_tokens.platform is
  'web / android / ios, copied from push_tokens at the moment of death.';
comment on column public.dead_push_tokens.token_updated_at is
  'push_tokens.updated_at when the token died. died_at minus this is how long it lived, which is the number that separates "client re-minting constantly" from "normal expiry".';

CREATE OR REPLACE FUNCTION public.record_push_result(p_token text, p_ok boolean, p_status integer, p_err_code text, p_title text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_profile uuid; v_platform text; v_updated timestamptz;
begin
  -- profile_id and platform were ALREADY read here for push_send_log; the dead
  -- token row simply never received them. updated_at is new: died_at minus it
  -- gives the token's lifetime.
  select profile_id, platform, updated_at into v_profile, v_platform, v_updated
    from push_tokens where token = p_token limit 1;

  insert into push_send_log (token_prefix, profile_id, platform, ok, status, err_code, title)
  values (left(p_token, 12) || '...', v_profile, v_platform, p_ok, p_status, p_err_code, p_title);

  if not p_ok and (p_err_code in ('UNREGISTERED','INVALID_ARGUMENT') or p_status = 404) then
    insert into dead_push_tokens (token, err_code, profile_id, platform, token_updated_at)
    values (p_token, p_err_code, v_profile, v_platform, v_updated)
      on conflict (token) do update set
        died_at = now(),
        err_code = excluded.err_code,
        -- coalesce: a token can die, be re-minted and die again. Keep whatever
        -- attribution exists rather than overwriting a known profile with null.
        profile_id = coalesce(excluded.profile_id, dead_push_tokens.profile_id),
        platform = coalesce(excluded.platform, dead_push_tokens.platform),
        token_updated_at = coalesce(excluded.token_updated_at, dead_push_tokens.token_updated_at);

    delete from push_tokens where token = p_token;
    update orders set push_token = null where push_token = p_token;
  end if;
end;
$function$;

-- VERIFIED ON PRODUCTION inside a deliberately-aborted block: a throwaway token
-- was given a push_tokens row aged three hours, then rejected as UNREGISTERED.
-- The dead row came back with profile recorded, platform=web, lifetime exactly
-- 03:00:00, and the push_tokens row correctly deleted. Nothing persisted --
-- still 18 alive, still 127 dead.
