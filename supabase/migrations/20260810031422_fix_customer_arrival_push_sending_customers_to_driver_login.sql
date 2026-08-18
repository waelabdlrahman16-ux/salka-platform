-- RECONSTRUCTED, not the original migration text.
--
-- This version (20260810031422) was applied directly to production through
-- the Supabase MCP connection and never committed as a migration file. The
-- literal SQL that ran that night is not recoverable: it is not in git
-- history (checked in full) and Postgres/Supabase log retention does not
-- reach back that far from this reconstruction date (2026-08-10, ~8 hours
-- after the original apply).
--
-- What follows is the CURRENT, live definition of the one function whose
-- body and inline comments match this migration's name exactly --
-- `notify_customer_driver_arrived`'s push payload builds a `link` to
-- `/track/<public_token>` with the comment "Without it the service worker
-- falls through to the driver board," which is precisely the bug
-- "sending customers to driver login" describes. No migration since
-- 20260810031422 has touched this function (checked: only
-- 20260807153557, 20260808204852 and 20260808211252 mention it, all
-- earlier or unrelated to its push-link logic), so the live definition is
-- confirmed to still be exactly what this fix left behind.
--
-- Recorded here as a `create or replace` for recovery-inventory purposes:
-- applying this file to a fresh database reproduces today's live behavior,
-- even though it cannot reproduce the historical diff.

create or replace function public.notify_customer_driver_arrived()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_secret text; v_token text; v_platform text; v_public_token text;
begin
  if new.arrived_at_customer_at is null then return new; end if;
  if old.arrived_at_customer_at is not null then return new; end if;

  select push_token, coalesce(push_platform, 'web'), public_token
    into v_token, v_platform, v_public_token
    from orders where id = new.order_id;
  if v_token is null then return new; end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'push_webhook_secret';

  perform net.http_post(
    url := 'https://pqpnwxyevrsipklzmwex.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', coalesce(v_secret,'')),
    body := jsonb_build_object(
      'tokens', jsonb_build_array(jsonb_build_object('token', v_token, 'platform', v_platform)),
      'title', 'سالكة',
      'body',  'المندوب وصل عندك 🛵 -- انزل أو كلّمه',
      -- The tap target. Without it the service worker falls through to the
      -- driver board.
      'data',  jsonb_build_object(
                 'order_id', new.order_id,
                 'link', '/track/' || v_public_token))
  );
  return new;
exception when others then
  return new;
end $function$;
