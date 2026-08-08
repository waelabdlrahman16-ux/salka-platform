-- Funnel analytics is intentionally anonymous, but the device id is supplied
-- by the caller and can be rotated. Bound both one device and the whole public
-- ingestion surface so analytics abuse cannot grow app_events without limit.
create or replace function public.log_app_event(
  p_event text,
  p_device_id text default null,
  p_session_id uuid default null,
  p_compound_id integer default null,
  p_restaurant_id integer default null,
  p_order_id integer default null,
  p_props jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device_id text;
  v_device_recent integer;
  v_global_recent integer;
begin
  if p_event not in (
    'arrival',
    'place_chosen',
    'vendor_opened',
    'item_added',
    'checkout_started',
    'order_placed'
  ) then
    return;
  end if;

  v_device_id := nullif(btrim(coalesce(p_device_id, '')), '');
  if v_device_id is null or length(v_device_id) > 64 then
    return;
  end if;

  -- A real customer journey emits at most a handful of events. Thirty in one
  -- minute leaves ample room for reloads and retries while stopping one device
  -- from using the old 120-event allowance as a write-amplification endpoint.
  select count(*)
    into v_device_recent
    from public.app_events ae
   where ae.device_id = v_device_id
     and ae.created_at > now() - interval '1 minute';
  if v_device_recent >= 30 then
    return;
  end if;

  -- Device ids are caller-controlled. This second ceiling still bounds the
  -- database if an attacker continuously invents new ids. The observed live
  -- peak before this change was 63/minute, so 300/minute preserves headroom.
  select count(*)
    into v_global_recent
    from public.app_events ae
   where ae.created_at > now() - interval '1 minute';
  if v_global_recent >= 300 then
    return;
  end if;

  insert into public.app_events (
    event,
    device_id,
    session_id,
    customer_id,
    compound_id,
    restaurant_id,
    order_id,
    props
  ) values (
    p_event,
    v_device_id,
    p_session_id,
    public.my_customer_id(),
    p_compound_id,
    p_restaurant_id,
    p_order_id,
    case
      when length(coalesce(p_props, '{}'::jsonb)::text) > 2000
        then '{"truncated":true}'::jsonb
      else coalesce(p_props, '{}'::jsonb)
    end
  );
end;
$function$;

revoke all on function public.log_app_event(
  text,
  text,
  uuid,
  integer,
  integer,
  integer,
  jsonb
) from public, anon, authenticated;

grant execute on function public.log_app_event(
  text,
  text,
  uuid,
  integer,
  integer,
  integer,
  jsonb
) to anon, authenticated, service_role;

do $verification$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.log_app_event(text,text,uuid,integer,integer,integer,jsonb)'::regprocedure
  ) into v_definition;

  if position('v_device_recent >= 30' in v_definition) = 0 then
    raise exception 'per-device analytics ceiling is missing';
  end if;

  if position('v_global_recent >= 300' in v_definition) = 0 then
    raise exception 'global analytics ceiling is missing';
  end if;

  if not has_function_privilege(
    'anon',
    'public.log_app_event(text,text,uuid,integer,integer,integer,jsonb)',
    'execute'
  ) then
    raise exception 'anonymous analytics ingestion is unavailable';
  end if;

  if exists (
    select 1
      from pg_proc p
      cross join lateral aclexplode(
        coalesce(p.proacl, acldefault('f', p.proowner))
      ) acl
     where p.oid =
       'public.log_app_event(text,text,uuid,integer,integer,integer,jsonb)'::regprocedure
       and acl.grantee = 0
       and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'implicit public analytics grant remains';
  end if;
end
$verification$;
