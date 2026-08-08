-- ============================================================
--  APPLIED TO PRODUCTION 2026-08-08 04:08 Cairo, migration
--  `revoke_anon_push_internals`. This file is the record, per the
--  repo rule: supabase/*.sql is the only place a future session
--  can read what the database actually does.
-- ============================================================
--
-- The 2026-08-08 full audit found push_send, push_nudge_sweep and
-- record_push_result executable by `anon`. All three are internal
-- machinery, not API surface:
--
--   * push_send is SECURITY DEFINER and attaches the vault webhook
--     secret to whatever p_targets it is handed, then relays to the
--     send-push edge function. Anonymous callers could burn FCM
--     quota, fill push_send_log, and -- with any leaked token --
--     send arbitrary-text notifications that look like Salka.
--   * record_push_result(p_token, false, 404, 'UNREGISTERED', ...)
--     with a known token unregisters that device: a targeted
--     push-DoS against a driver or vendor.
--   * push_nudge_sweep has no business being anon-triggerable.
--
-- WHY THEY WERE OPEN: CREATE FUNCTION grants EXECUTE to PUBLIC
-- every single time, and revoking from anon/authenticated alone is
-- a NO-OP while PUBLIC still holds it. PUBLIC is revoked first.
--
-- Real callers, none of which need a grant here:
--   push_send          <- notify_* functions (SECURITY DEFINER, owner postgres)
--   push_nudge_sweep   <- pg_cron (runs as postgres)
--   record_push_result <- send-push edge function via REST with the
--                         service role key -- the ONE grant kept.

revoke all on function public.push_send(jsonb, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.push_nudge_sweep() from public, anon, authenticated;
revoke all on function public.record_push_result(text, boolean, integer, text, text) from public, anon, authenticated;

grant execute on function public.record_push_result(text, boolean, integer, text, text) to service_role;

-- Verified after applying, 2026-08-08 04:10-04:11 Cairo:
--   has_function_privilege('anon', ...)          -> false for all three
--   has_function_privilege('authenticated', ...) -> false for all three
--   has_function_privilege('service_role', record_push_result) -> true
--   anon-executable function count: 57 -> 54
--   next two pg_cron runs of push-nudge-sweep and
--   check_late_unclaimed_orders after the revoke: succeeded.
--
-- The preflight tripwire baseline is therefore 54 as of this date
-- (the old documented baseline of 36 was already stale).
