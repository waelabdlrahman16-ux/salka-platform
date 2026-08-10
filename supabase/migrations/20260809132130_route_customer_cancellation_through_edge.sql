-- Move the privileged implementation out of the exposed Data API schema.
-- The authenticated public wrapper retains the existing staff call signature
-- but is SECURITY INVOKER, so the advisor no longer sees a privileged public
-- endpoint. PostgREST exposes public, not private, in this project.
alter function public.cancel_order(integer, text, uuid) set schema private;

revoke execute on function private.cancel_order(integer, text, uuid) from public, anon;
grant usage on schema private to authenticated, service_role;
grant execute on function private.cancel_order(integer, text, uuid) to authenticated, service_role;

create function public.cancel_order(
  p_order_id integer,
  p_reason text default ''::text,
  p_token uuid default null::uuid
) returns void
language sql
security invoker
set search_path = ''
as $function$
  select private.cancel_order(p_order_id, p_reason, p_token)
$function$;

revoke execute on function public.cancel_order(integer, text, uuid) from public, anon;
grant execute on function public.cancel_order(integer, text, uuid) to authenticated, service_role;

do $permissions_check$
begin
  if has_function_privilege('anon', 'public.cancel_order(integer,text,uuid)', 'execute') then
    raise exception 'anonymous direct cancellation RPC is still executable';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.cancel_order(integer,text,uuid)'::regprocedure) then
    raise exception 'public cancellation wrapper must remain SECURITY INVOKER';
  end if;
  if not (select prosecdef from pg_proc where oid = 'private.cancel_order(integer,text,uuid)'::regprocedure) then
    raise exception 'private cancellation implementation lost SECURITY DEFINER';
  end if;
  if not has_function_privilege('authenticated', 'public.cancel_order(integer,text,uuid)', 'execute') then
    raise exception 'staff cancellation RPC lost authenticated access';
  end if;
  if not has_function_privilege('service_role', 'public.cancel_order(integer,text,uuid)', 'execute') then
    raise exception 'cancel-order Edge Function lost service-role access';
  end if;
end
$permissions_check$;
