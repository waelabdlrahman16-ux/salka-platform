-- A supervisor pricing a custom order ("اطلب أي حاجة") calls
-- private.confirm_custom_order_price(), which sets pricing_status = 'confirmed'
-- and moves status to awaiting_payment / Scheduled / pending -- none of which
-- are in this trigger's existing elsif chain (Accepted / Cancelled /
-- Out_for_Delivery / Delivered / kitchen_status preparing / ready). The
-- customer's device never learned their order had been priced: MyOrders.tsx
-- loaded once and never refreshed, and even Track.tsx's 10s poll only shows
-- the new total, not a proactive nudge to go pay.
--
-- Adds a pricing_status transition to the same guard/branch pattern used
-- everywhere else in this function. Payload shape and vault/http_post call
-- are unchanged -- see supabase/functions/send-push/index.ts.
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
                   then ' — ' || new.cancel_reason else '' end;
  elsif new.status = 'Out_for_Delivery' and old.status is distinct from 'Out_for_Delivery' then
    v_title := 'سالكة'; v_body := 'مندوبك في الطريق إليك 🛵';
  elsif new.status = 'Delivered' and old.status is distinct from 'Delivered' then
    v_title := 'سالكة'; v_body := 'تم توصيل طلبك، بالهنا والشفا 🎉';
  elsif new.pricing_status = 'confirmed' and old.pricing_status is distinct from 'confirmed' then
    v_title := 'سالكة'; v_body := 'سعر طلبك جاهز — ادفع علشان نبدأ فيه';
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
