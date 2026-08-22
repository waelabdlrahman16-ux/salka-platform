-- The reminder needs the platform: an android token filed as 'web' gets a
-- data-only message the killed app never displays, which is indistinguishable
-- from the push having failed.
--
-- DROPPED and recreated, not `create or replace` with a new defaulted argument.
-- That is exactly how this project ended up with two delivery_quote functions
-- and a live 42725 "is not unique" on every screen showing a delivery fee.
drop function if exists public.remind_me_when_open(integer, text, text);

create function public.remind_me_when_open(
  p_restaurant_id integer,
  p_phone         text default null,
  p_push_token    text default null,
  p_platform      text default 'web'
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_open boolean; v_next timestamptz; v_token text;
begin
  if p_restaurant_id is null then raise exception 'restaurant_required'; end if;
  if p_platform not in ('web','android','ios') then raise exception 'bad_platform'; end if;

  v_token := nullif(btrim(coalesce(p_push_token,'')), '');
  if v_token is not null and length(v_token) > 4096 then raise exception 'token_too_long'; end if;
  if coalesce(trim(p_phone),'') = '' and v_token is null then raise exception 'contact_required'; end if;

  -- A token FCM has already retired should not be queued at all.
  if v_token is not null
     and exists (select 1 from dead_push_tokens d where d.token = v_token) then
    raise exception 'stale_token';
  end if;

  select vendor_is_open_now(id) into v_open from restaurants
   where id = p_restaurant_id and not archived;
  if v_open is null then raise exception 'vendor_not_found'; end if;

  -- Already open is not an error, it is a stale screen. The client turns this
  -- into "it's open now, go order" rather than a failure.
  if v_open then return json_build_object('already_open', true); end if;

  v_next := vendor_next_open_at(p_restaurant_id);

  insert into vendor_open_reminders (restaurant_id, phone, push_token, platform)
  values (p_restaurant_id, nullif(trim(p_phone),''), v_token, p_platform)
  on conflict (restaurant_id, phone, push_token) do nothing;

  return json_build_object('already_open', false, 'opens_at', v_next);
end $$;

revoke all on function public.remind_me_when_open(integer, text, text, text) from public;
grant execute on function public.remind_me_when_open(integer, text, text, text) to anon, authenticated;

-- The lesson from delivery_quote, enforced rather than remembered.
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname='remind_me_when_open';
  if n <> 1 then raise exception 'left % overloads of remind_me_when_open', n; end if;
end $$;
