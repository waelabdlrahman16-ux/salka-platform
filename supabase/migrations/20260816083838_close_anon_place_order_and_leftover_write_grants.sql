-- Applied to production 2026-08-16 08:38 UTC via Supabase MCP (audit step 1).
-- This file is the record of that change; do not re-run it expecting a no-op
-- to be meaningful -- REVOKE is idempotent, but the point of the file is that
-- the repo and production agree.
--
-- ---------------------------------------------------------------------------
-- Audit finding 02 (Critical): unauthenticated order creation.
--
-- 20260809193327_route_order_creation_through_edge.sql:143 revoked execute on
-- the order-creation functions so that every order has to pass through the
-- customer-order-creation edge function, which does the input validation and
-- the per-phone rate limiting. That revoke named ONE EXACT SIGNATURE:
--
--   revoke all on function public.place_order(
--     integer,text,text,text,text,text,numeric,json,integer,date,integer,
--     text,boolean,uuid,text,text,uuid)          -- 17 arguments
--   from public,anon,authenticated;
--
-- On 2026-08-13, 20260813131425_observer_and_promo_codes.sql created a SECOND
-- place_order carrying p_promo_code (18 arguments). A different signature is a
-- different function as far as GRANT is concerned, so it was born with the
-- Postgres default of EXECUTE TO PUBLIC and nobody revoked it. From that day
-- until this migration, anyone holding the publishable anon key -- which ships
-- in the browser bundle by design -- could POST /rest/v1/rpc/place_order
-- directly and skip the edge function entirely.
--
-- The in-function limit did not compensate: place_order rate-limits on
-- 'order-hmac:' || p_rate_key, and p_rate_key is supplied by the caller. The
-- edge function passes an HMAC of the customer's phone so real customers share
-- one bucket; a direct caller passes a fresh random 64-hex string per request
-- and lands in an empty bucket every time.
--
-- Impact was availability, not confidentiality or money: place_order
-- re-validates its own inputs (item counts, quantities, text lengths) and
-- recomputes the delivery fee server-side. The exposure was unlimited fake
-- order creation -- real rows on real vendor screens, ringing the vendor alarm
-- and entering driver dispatch.
--
-- Safe to apply against live traffic: nothing in the frontend calls
-- place_order directly (checkout goes through
-- edgeAction('customer-order-creation') in src/lib/customerOrderCreation.ts),
-- and the edge function invokes it via ctx.supabaseAdmin -- the service role,
-- which is not subject to these grants. Verified after applying:
-- has_function_privilege('service_role', ..., 'EXECUTE') is still true for
-- both overloads.
REVOKE EXECUTE ON FUNCTION public.place_order(
  integer,text,text,text,text,text,numeric,json,text,integer,date,
  integer,text,boolean,uuid,text,text,uuid
) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Audit finding 08 (Medium): write privileges left behind on the policy-free
-- tables.
--
-- 20260809233338_revoke_unused_grants_on_policyless_tables.sql revoked SELECT
-- from anon and authenticated on the tables that have RLS enabled but no
-- policies. It did not revoke INSERT, UPDATE or DELETE, which remained granted
-- on all seven.
--
-- Nothing was exposed: RLS with zero policies is default-deny for every verb,
-- not just SELECT, so these writes were already refused. This migration
-- removes the standing privilege that would become live the instant anyone
-- adds a single permissive policy while building a feature. On
-- customer_otp_codes that would let anyone insert their own login code; on
-- customer_sessions, forge a session row.
--
-- These tables are written only by SECURITY DEFINER functions, which execute
-- as the owner and are unaffected by grants to anon/authenticated.
--
-- REFERENCES and TRIGGER remain granted and are deliberately left alone --
-- neither confers data access, and removing them risks breaking foreign-key
-- creation in future migrations for no security gain.
REVOKE INSERT, UPDATE, DELETE ON
  public.customers,
  public.customer_sessions,
  public.customer_otp_codes,
  public.customer_addresses,
  public.order_status_events,
  public.driver_shift_bonuses,
  public.request_item_suppressions
FROM anon, authenticated;
