create schema if not exists private;
revoke all on schema private from public;

alter function public.log_app_event(text,text,uuid,integer,integer,integer,jsonb) set schema private;
revoke all on function private.log_app_event(text,text,uuid,integer,integer,integer,jsonb) from public,anon,authenticated;

create function public.log_app_event(
  p_event text, p_device_id text default null, p_session_id uuid default null,
  p_compound_id integer default null, p_restaurant_id integer default null,
  p_order_id integer default null, p_props jsonb default '{}'::jsonb,
  p_auth_user_id uuid default null
) returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if p_auth_user_id is not null then
    perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true);
  end if;
  perform private.log_app_event(p_event,p_device_id,p_session_id,p_compound_id,p_restaurant_id,p_order_id,p_props);
end $function$;

revoke all on function public.log_app_event(text,text,uuid,integer,integer,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.log_app_event(text,text,uuid,integer,integer,integer,jsonb,uuid) to service_role;

do $verification$
begin
  if has_function_privilege('anon','public.log_app_event(text,text,uuid,integer,integer,integer,jsonb,uuid)','execute')
     or has_function_privilege('authenticated','public.log_app_event(text,text,uuid,integer,integer,integer,jsonb,uuid)','execute')
     or not has_function_privilege('service_role','public.log_app_event(text,text,uuid,integer,integer,integer,jsonb,uuid)','execute') then
    raise exception 'invalid analytics ingestion privileges';
  end if;
end $verification$;
