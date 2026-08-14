-- banners_read (created in migration 20260804174659) has always OR'd
-- is_admin() into the same USING clause as the public visibility check, for
-- BOTH anon and authenticated. Anon has never had execute on is_admin() --
-- and per the security-hardening batch (20260808204852 onward) that grant
-- was deliberately tightened to service_role/authenticated/postgres only.
-- Since then, every anonymous (not-logged-in) customer's read of `banners`
-- has failed outright with "permission denied for function is_admin".
-- Postgres checks function-call permissions for everything referenced in a
-- policy's USING clause, not lazily per row, so there is no OR short-circuit
-- that saves an anon caller from a function it cannot execute. Anonymous
-- browsing is most of home-page traffic, so banners have been effectively
-- invisible to most customers since that hardening batch landed -- not
-- something anyone would notice testing logged in as staff.
--
-- Fix: split into two policies. The public check never references
-- is_admin(), so anon and authenticated both evaluate it cleanly. The admin
-- check is its own policy, evaluated only for `authenticated`, which does
-- have execute on is_admin().

drop policy if exists banners_read on public.banners;

create policy banners_read_public on public.banners
  for select to anon, authenticated
  using (
    active
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   > now())
  );

create policy banners_read_admin on public.banners
  for select to authenticated
  using (is_admin());
