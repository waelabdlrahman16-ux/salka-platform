create schema if not exists private;
revoke all on schema private from public;

alter function public.track_order(uuid) set schema private;
alter function public.save_customer_push_token(uuid,text,text) set schema private;
alter function public.submit_rating(uuid,integer,integer,text) set schema private;
alter function public.submit_complaint(uuid,text,text) set schema private;

revoke all on function private.track_order(uuid) from public,anon,authenticated;
revoke all on function private.save_customer_push_token(uuid,text,text) from public,anon,authenticated;
revoke all on function private.submit_rating(uuid,integer,integer,text) from public,anon,authenticated;
revoke all on function private.submit_complaint(uuid,text,text) from public,anon,authenticated;

create function public.track_order(p_token uuid)
returns json language sql security definer set search_path to 'public'
as $function$ select private.track_order(p_token); $function$;

create function public.save_customer_push_token(
  p_token uuid, p_push_token text, p_platform text default 'web',
  p_auth_user_id uuid default null
) returns json language plpgsql security definer set search_path to 'public'
as $function$
begin
  if p_auth_user_id is not null then
    perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true);
  end if;
  return private.save_customer_push_token(p_token,p_push_token,p_platform);
end $function$;

create function public.submit_rating(
  p_token uuid, p_driver_rating integer default null,
  p_restaurant_rating integer default null, p_comment text default '',
  p_auth_user_id uuid default null
) returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if p_auth_user_id is not null then
    perform set_config('request.jwt.claim.sub',p_auth_user_id::text,true);
  end if;
  perform private.submit_rating(p_token,p_driver_rating,p_restaurant_rating,p_comment);
end $function$;

create function public.submit_complaint(
  p_token uuid, p_description text, p_category text default 'other'
) returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform private.submit_complaint(p_token,p_description,p_category);
end $function$;

revoke all on function public.track_order(uuid) from public,anon,authenticated;
revoke all on function public.save_customer_push_token(uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.submit_rating(uuid,integer,integer,text,uuid) from public,anon,authenticated;
revoke all on function public.submit_complaint(uuid,text,text) from public,anon,authenticated;
grant execute on function public.track_order(uuid) to service_role;
grant execute on function public.save_customer_push_token(uuid,text,text,uuid) to service_role;
grant execute on function public.submit_rating(uuid,integer,integer,text,uuid) to service_role;
grant execute on function public.submit_complaint(uuid,text,text) to service_role;

do $verification$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.track_order(uuid)',
    'public.save_customer_push_token(uuid,text,text,uuid)',
    'public.submit_rating(uuid,integer,integer,text,uuid)',
    'public.submit_complaint(uuid,text,text)'
  ] loop
    if has_function_privilege('anon',v_signature,'execute')
       or has_function_privilege('authenticated',v_signature,'execute')
       or not has_function_privilege('service_role',v_signature,'execute') then
      raise exception 'invalid customer order access privilege for %',v_signature;
    end if;
  end loop;
end $verification$;
