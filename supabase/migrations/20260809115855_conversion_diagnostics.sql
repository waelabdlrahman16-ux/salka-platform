-- Conversion diagnostics: record only non-personal operational facts and make
-- the admin funnel a real same-device, in-order progression.

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
  v_recent int;
begin
  if p_event not in (
    'arrival', 'place_chosen', 'vendor_opened', 'item_added',
    'customization_opened', 'customization_abandoned',
    'checkout_started', 'checkout_blocked', 'order_placed'
  ) then
    return;
  end if;

  if p_device_id is not null then
    select count(*) into v_recent
    from app_events
    where device_id = p_device_id
      and created_at > now() - interval '1 minute';
    if v_recent >= 120 then return; end if;
  end if;

  insert into app_events (
    event, device_id, session_id, customer_id,
    compound_id, restaurant_id, order_id, props
  )
  values (
    p_event, left(coalesce(p_device_id, ''), 64), p_session_id, my_customer_id(),
    p_compound_id, p_restaurant_id, p_order_id,
    case
      when length(p_props::text) > 2000 then '{"truncated":true}'::jsonb
      else coalesce(p_props, '{}'::jsonb)
    end
  );
end
$function$;

create or replace function public.admin_funnel(p_days integer default 7)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_res json;
  v_requested_since timestamptz;
  v_since timestamptz;
begin
  if not (is_admin() or is_supervisor()) then
    raise exception 'admin_only';
  end if;

  v_requested_since := now() - make_interval(days => greatest(coalesce(p_days, 7), 1));

  -- is_open was added to vendor_opened with this release. Starting at the
  -- first classified event prevents old closed-menu browsing from being
  -- relabelled as an ordering failure.
  select greatest(
    v_requested_since,
    coalesce(min(created_at), now())
  )
  into v_since
  from app_events
  where event = 'vendor_opened'
    and props ? 'is_open';

  with scoped as (
    select e.*,
           bool_or(coalesce(e.props->>'fbclid', '') <> '')
             over (partition by e.device_id) as paid,
           bool_or(coalesce(e.props->>'in_app', '') = 'true')
             over (partition by e.device_id) as in_app
    from app_events e
    where e.created_at >= v_since
      and nullif(e.device_id, '') is not null
  ),
  devices as (
    select device_id, bool_or(paid) paid, bool_or(in_app) in_app
    from scoped
    group by device_id
  ),
  progression as (
    select d.device_id, d.paid, d.in_app,
           a.at as arrival_at,
           p.at as place_at,
           v.at as vendor_at,
           i.at as item_at,
           c.at as checkout_at,
           o.at as order_at
    from devices d
    left join lateral (
      select min(created_at) at from scoped
      where device_id = d.device_id and event = 'arrival'
    ) a on true
    left join lateral (
      select min(created_at) at from scoped
      where device_id = d.device_id and event = 'place_chosen'
        and created_at >= a.at
    ) p on true
    left join lateral (
      select min(created_at) at from scoped
      where device_id = d.device_id and event = 'vendor_opened'
        and props->>'is_open' = 'true'
        and created_at >= p.at
    ) v on true
    left join lateral (
      select min(created_at) at from scoped
      where device_id = d.device_id and event = 'item_added'
        and created_at >= v.at
    ) i on true
    left join lateral (
      select min(created_at) at from scoped
      where device_id = d.device_id and event = 'checkout_started'
        and created_at >= i.at
    ) c on true
    left join lateral (
      select min(created_at) at from scoped
      where device_id = d.device_id and event = 'order_placed'
        and created_at >= c.at
    ) o on true
  ),
  funnel_rows as (
    select 1 ord, 'arrival'::text event, device_id, arrival_at at, paid, in_app from progression
    union all
    select 2, 'place_chosen', device_id, place_at, paid, in_app from progression
    union all
    select 3, 'vendor_opened', device_id, vendor_at, paid, in_app from progression
    union all
    select 4, 'item_added', device_id, item_at, paid, in_app from progression
    union all
    select 5, 'checkout_started', device_id, checkout_at, paid, in_app from progression
    union all
    select 6, 'order_placed', device_id, order_at, paid, in_app from progression
  ),
  vendor_devices as (
    select distinct restaurant_id, device_id
    from scoped
    where restaurant_id is not null
  ),
  vendor_progression as (
    select vd.restaurant_id, vd.device_id,
           vo.at open_at,
           vc.at closed_at,
           vi.at item_at,
           co.at customization_opened_at,
           ca.at customization_abandoned_at,
           cb.at checkout_blocked_at,
           oo.at order_at
    from vendor_devices vd
    left join lateral (
      select min(created_at) at from scoped
      where restaurant_id = vd.restaurant_id and device_id = vd.device_id
        and event = 'vendor_opened' and props->>'is_open' = 'true'
    ) vo on true
    left join lateral (
      select min(created_at) at from scoped
      where restaurant_id = vd.restaurant_id and device_id = vd.device_id
        and event = 'vendor_opened' and props->>'is_open' = 'false'
    ) vc on true
    left join lateral (
      select min(created_at) at from scoped
      where restaurant_id = vd.restaurant_id and device_id = vd.device_id
        and event = 'item_added' and created_at >= vo.at
    ) vi on true
    left join lateral (
      select min(created_at) at from scoped
      where restaurant_id = vd.restaurant_id and device_id = vd.device_id
        and event = 'customization_opened' and created_at >= vo.at
    ) co on true
    left join lateral (
      select min(created_at) at from scoped
      where restaurant_id = vd.restaurant_id and device_id = vd.device_id
        and event = 'customization_abandoned' and created_at >= co.at
    ) ca on true
    left join lateral (
      select min(created_at) at from scoped
      where restaurant_id = vd.restaurant_id and device_id = vd.device_id
        and event = 'checkout_blocked' and created_at >= vo.at
    ) cb on true
    left join lateral (
      select min(created_at) at from scoped
      where restaurant_id = vd.restaurant_id and device_id = vd.device_id
        and event = 'order_placed' and created_at >= vo.at
    ) oo on true
  ),
  vendor_rows as (
    select
      r.id restaurant_id,
      r.name,
      count(*) filter (where vp.open_at is not null) open_devices,
      count(*) filter (where vp.closed_at is not null) closed_browsers,
      count(*) filter (where vp.item_at is not null) item_devices,
      count(*) filter (where vp.customization_opened_at is not null) customization_opened,
      count(*) filter (where vp.customization_abandoned_at is not null) customization_abandoned,
      count(*) filter (where vp.checkout_blocked_at is not null) checkout_blocked,
      count(*) filter (where vp.order_at is not null) order_devices
    from restaurants r
    join vendor_progression vp on vp.restaurant_id = r.id
    group by r.id, r.name
  )
  select json_build_object(
    'since', v_since,
    'requested_since', v_requested_since,
    'days', greatest(coalesce(p_days, 7), 1),
    'funnel', (
      select coalesce(json_agg(row_to_json(x) order by x.ord), '[]'::json)
      from (
        select ord, event,
               count(distinct device_id) filter (where at is not null) devices,
               count(distinct device_id) filter (where at is not null and paid) paid_devices,
               count(distinct device_id) filter (where at is not null and in_app) in_app_devices
        from funnel_rows
        group by ord, event
      ) x
    ),
    'totals', (
      select json_build_object(
        'devices', count(distinct device_id),
        'paid_devices', count(distinct device_id) filter (where paid),
        'in_app_devices', count(distinct device_id) filter (where in_app),
        'events', count(*)
      )
      from scoped
    ),
    'closed_browsers', (
      select count(distinct device_id)
      from scoped
      where event = 'vendor_opened' and props->>'is_open' = 'false'
    ),
    'vendors', (
      select coalesce(json_agg(row_to_json(v) order by v.open_devices desc, v.name), '[]'::json)
      from vendor_rows v
    ),
    'checkout_blocks', (
      select coalesce(json_agg(row_to_json(b) order by b.events desc, b.reason), '[]'::json)
      from (
        select coalesce(props->>'reason', 'unknown') reason,
               count(*) events,
               count(distinct device_id) devices
        from scoped
        where event = 'checkout_blocked'
        group by coalesce(props->>'reason', 'unknown')
      ) b
    )
  )
  into v_res;

  return v_res;
end
$function$;

-- CREATE OR REPLACE must retain the existing private ACLs and safety settings.
do $verify$
begin
  if has_function_privilege('anon', 'public.admin_funnel(integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_funnel(integer)', 'execute')
     or not has_function_privilege('anon', 'public.log_app_event(text,text,uuid,integer,integer,integer,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.log_app_event(text,text,uuid,integer,integer,integer,jsonb)', 'execute') then
    raise exception 'conversion_diagnostics_acl_mismatch';
  end if;

  if not (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=public']
          from pg_proc where oid = 'public.admin_funnel(integer)'::regprocedure)
     or not (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=public']
             from pg_proc where oid = 'public.log_app_event(text,text,uuid,integer,integer,integer,jsonb)'::regprocedure) then
    raise exception 'conversion_diagnostics_security_mismatch';
  end if;
end
$verify$;
