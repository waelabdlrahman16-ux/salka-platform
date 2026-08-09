-- Customer payment actions now enter through the publishable-key authenticated,
-- rate-limited Edge Function. Keep the privileged implementations outside the
-- exposed Data API and expose only service-role SECURITY INVOKER wrappers.
alter function public.mark_instapay_claimed(uuid) set schema private;
alter function public.switch_to_cash(uuid) set schema private;
alter function public.submit_tip(uuid, numeric) set schema private;

revoke execute on function private.mark_instapay_claimed(uuid) from public, anon, authenticated;
revoke execute on function private.switch_to_cash(uuid) from public, anon, authenticated;
revoke execute on function private.submit_tip(uuid, numeric) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.mark_instapay_claimed(uuid) to service_role;
grant execute on function private.switch_to_cash(uuid) to service_role;
grant execute on function private.submit_tip(uuid, numeric) to service_role;

create function public.mark_instapay_claimed(p_token uuid)
returns void language sql security invoker set search_path = ''
as $function$ select private.mark_instapay_claimed(p_token) $function$;

create function public.switch_to_cash(p_token uuid)
returns json language sql security invoker set search_path = ''
as $function$ select private.switch_to_cash(p_token) $function$;

create function public.submit_tip(p_token uuid, p_amount numeric)
returns void language sql security invoker set search_path = ''
as $function$ select private.submit_tip(p_token, p_amount) $function$;

revoke execute on function public.mark_instapay_claimed(uuid) from public, anon, authenticated;
revoke execute on function public.switch_to_cash(uuid) from public, anon, authenticated;
revoke execute on function public.submit_tip(uuid, numeric) from public, anon, authenticated;
grant execute on function public.mark_instapay_claimed(uuid) to service_role;
grant execute on function public.switch_to_cash(uuid) to service_role;
grant execute on function public.submit_tip(uuid, numeric) to service_role;

do $permissions_check$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.mark_instapay_claimed(uuid)',
    'public.switch_to_cash(uuid)',
    'public.submit_tip(uuid,numeric)'
  ] loop
    if has_function_privilege('anon', v_signature, 'execute')
       or has_function_privilege('authenticated', v_signature, 'execute') then
      raise exception 'client role still has direct payment-action access to %', v_signature;
    end if;
    if not has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'payment Edge Function lost wrapper access to %', v_signature;
    end if;
    if (select prosecdef from pg_proc where oid = v_signature::regprocedure) then
      raise exception 'public payment-action wrapper must remain SECURITY INVOKER: %', v_signature;
    end if;
  end loop;

  foreach v_signature in array array[
    'private.mark_instapay_claimed(uuid)',
    'private.switch_to_cash(uuid)',
    'private.submit_tip(uuid,numeric)'
  ] loop
    if not has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'payment Edge Function lost private access to %', v_signature;
    end if;
    if not (select prosecdef from pg_proc where oid = v_signature::regprocedure) then
      raise exception 'private payment implementation lost SECURITY DEFINER: %', v_signature;
    end if;
  end loop;
end
$permissions_check$;
