-- The orders RLS policy calls this function while evaluating authenticated
-- requests. Revoking EXECUTE makes every order read fail with 403, even for
-- admins, while the row-level authorization inside the function remains active.
grant execute on function public.supervisor_may_touch_order(integer) to authenticated;

do $$
begin
  if not has_function_privilege(
    'authenticated',
    'public.supervisor_may_touch_order(integer)',
    'execute'
  ) then
    raise exception 'authenticated execute privilege was not restored';
  end if;
end
$$;
