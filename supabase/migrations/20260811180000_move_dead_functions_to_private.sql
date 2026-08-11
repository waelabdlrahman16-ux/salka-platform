-- Batch 8 (corrected scope): move 4 confirmed-orphaned functions out of the
-- exposed public/PostgREST surface into private. Verified zero callers across
-- RLS policies, other function bodies, triggers, pg_cron, Edge Functions, and
-- the frontend (including indirect dispatch via adminReport()/edgeAction()).
-- Kept (not dropped) since check_and_award_shift_bonus is an intentionally
-- shelved feature per developer comments in src/pages/Driver.tsx.

alter function public.check_and_award_shift_bonus(integer) set schema private;
alter function public.sla_minutes_for_distance(numeric) set schema private;
alter function public.time_within_window(time without time zone, time without time zone, time without time zone) set schema private;
alter function public.update_my_customer_phone(text) set schema private;
