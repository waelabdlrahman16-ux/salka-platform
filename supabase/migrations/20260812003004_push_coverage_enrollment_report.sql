-- Expand the existing admin-only push report into an enrollment dashboard.
-- Token values never leave the database; admins receive only platform, age,
-- and aggregate delivery outcomes. The existing service-role wrapper remains
-- the only callable path from the Edge Function.
create or replace function private.admin_push_health()
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_result json;
begin
  if not is_supervisor() then raise exception 'admin_only'; end if;

  with people as (
    select
      p.id as profile_id,
      p.role,
      coalesce(nullif(p.name, ''), r.name, d.name, p.role) as name,
      p.restaurant_id,
      r.name as restaurant_name,
      p.driver_id,
      d.name as driver_name,
      count(pt.id)::integer as token_count,
      coalesce(array_agg(distinct pt.platform order by pt.platform)
        filter (where pt.platform is not null), array[]::text[]) as platforms,
      max(pt.updated_at) as last_registered_at
    from profiles p
    left join restaurants r on r.id = p.restaurant_id
    left join drivers d on d.id = p.driver_id
    left join push_tokens pt on pt.profile_id = p.id
    where p.role in ('admin', 'supervisor', 'catalog', 'vendor', 'driver')
    group by p.id, p.role, p.name, p.restaurant_id, r.name, p.driver_id, d.name
  ), coverage as (
    select
      role,
      count(*)::integer as total,
      count(*) filter (where token_count > 0)::integer as registered,
      count(*) filter (where token_count = 0)::integer as missing,
      count(*) filter (
        where token_count > 0
          and last_registered_at < now() - interval '30 days'
      )::integer as stale
    from people
    group by role
  ), send_stats as (
    select
      count(*) filter (where created_at >= now() - interval '24 hours')::integer as attempts_24h,
      count(*) filter (where created_at >= now() - interval '24 hours' and ok)::integer as accepted_24h,
      count(*) filter (where created_at >= now() - interval '24 hours' and not ok)::integer as failed_24h,
      count(*) filter (where created_at >= now() - interval '30 days')::integer as attempts_30d,
      count(*) filter (where created_at >= now() - interval '30 days' and ok)::integer as accepted_30d,
      count(*) filter (where created_at >= now() - interval '30 days' and not ok)::integer as failed_30d,
      max(created_at) as latest_attempt_at
    from push_send_log
  )
  select json_build_object(
    'generated_at', now(),
    'coverage', coalesce((
      select json_agg(row_to_json(c) order by c.role) from coverage c
    ), '[]'::json),
    'people', coalesce((
      select json_agg(json_build_object(
        'profile_id', x.profile_id,
        'role', x.role,
        'name', x.name,
        'restaurant_id', x.restaurant_id,
        'restaurant_name', x.restaurant_name,
        'driver_id', x.driver_id,
        'driver_name', x.driver_name,
        'token_count', x.token_count,
        'platforms', x.platforms,
        'last_registered_at', x.last_registered_at,
        'status', case
          when x.token_count = 0 then 'missing'
          when x.last_registered_at < now() - interval '30 days' then 'stale'
          else 'registered'
        end
      ) order by
        case when x.token_count = 0 then 0
             when x.last_registered_at < now() - interval '30 days' then 1
             else 2 end,
        x.role, x.name)
      from people x
    ), '[]'::json),
    'send_stats', (select row_to_json(s) from send_stats s),
    'recent_failures', coalesce((
      select json_agg(json_build_object(
        'platform', f.platform,
        'status', f.status,
        'error', f.err_code,
        'title', f.title,
        'at', f.created_at
      ) order by f.created_at desc)
      from (
        select platform, status, err_code, title, created_at
        from push_send_log
        where not ok
        order by created_at desc
        limit 20
      ) f
    ), '[]'::json),
    'dead_tokens_30d', (
      select count(*)::integer from dead_push_tokens
      where died_at >= now() - interval '30 days'
    )
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function private.admin_push_health() from public, anon, authenticated;
grant execute on function private.admin_push_health() to service_role;
