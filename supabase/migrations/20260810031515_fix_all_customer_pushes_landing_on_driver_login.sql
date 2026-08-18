-- RECONSTRUCTED, not the original migration text.
--
-- This version (20260810031515) was applied directly to production through
-- the Supabase MCP connection and never committed as a migration file, for
-- the same reason and with the same limitation documented in the sibling
-- reconstruction 20260810031422_fix_customer_arrival_push_sending_customers_to_driver_login.sql:
-- the literal SQL is not recoverable from git history or from log
-- retention as of this reconstruction date.
--
-- This migration's name ("ALL customer pushes") is broader than its sibling
-- ("customer arrival" only), matching `notify_order_status_change` -- the
-- one trigger function that sends every other customer-facing push
-- (Accepted, Cancelled, Out_for_Delivery, Delivered, kitchen preparing/ready).
-- Its `link` field carries the identical inline comment pattern ("The tap
-- target. public_token is on this same row.") describing the same class of
-- fix as the sibling migration. No migration since 20260810031515 has
-- touched this function, so the live definition below is confirmed to
-- still be exactly what this fix left behind.
--
-- Recorded here as a `create or replace` for recovery-inventory purposes:
-- applying this file to a fresh database reproduces today's live behavior,
-- even though it cannot reproduce the historical diff.

create or replace function public.notify_order_status_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_secret text; v_title text; v_body text;
begin
  if new.push_token is null then return new; end if;

  if new.status = 'Accepted' and old.status is distinct from 'Accepted' then
    v_title := 'سالكة'; v_body := 'مندوبك في الطريق لاستلام طلبك';
  elsif new.status = 'Cancelled' and old.status is distinct from 'Cancelled' then
    v_title := 'سالكة';
    v_body := 'للأسف اتلغى طلبك' ||
              case when new.cancel_reason is not null and new.cancel_reason <> ''
                   then ' -- ' || new.cancel_reason else '' end;
  elsif new.status = 'Out_for_Delivery' and old.status is distinct from 'Out_for_Delivery' then
    v_title := 'سالكة'; v_body := 'مندوبك في الطريق إليك 🛵';
  elsif new.status = 'Delivered' and old.status is distinct from 'Delivered' then
    v_title := 'سالكة'; v_body := 'تم توصيل طلبك، بالهنا والشفا 🎉';
  elsif new.kitchen_status = 'preparing' and old.kitchen_status is distinct from 'preparing' then
    v_title := 'سالكة'; v_body := 'المطعم بدأ يجهز طلبك';
  elsif new.kitchen_status = 'ready' and old.kitchen_status is distinct from 'ready' then
    v_title := 'سالكة'; v_body := 'طلبك جاهز وهيتسلم للمندوب دلوقتي';
  else
    return new;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_webhook_secret';

  perform net.http_post(
    url := 'https://pqpnwxyevrsipklzmwex.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', coalesce(v_secret,'')),
    body := jsonb_build_object(
      'tokens', jsonb_build_array(jsonb_build_object('token', new.push_token, 'platform', coalesce(new.push_platform, 'web'))),
      'title', v_title, 'body', v_body,
      'data', jsonb_build_object(
                'order_id', new.id,
                -- The tap target. public_token is on this same row.
                'link', '/track/' || new.public_token))
  );
  return new;
exception when others then
  return new;
end;
$function$;
