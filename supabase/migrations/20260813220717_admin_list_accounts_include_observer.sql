-- private.admin_list_accounts()'s "catalog" bucket only selected role in
-- ('catalog', 'supervisor'), so observer accounts (added earlier today) never
-- appeared in the admin portal's accounts list even though they could be
-- created and could sign in. Add 'observer' to the same bucket.
CREATE OR REPLACE FUNCTION private.admin_list_accounts()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select json_build_object(
    'vendors', (select coalesce(json_agg(row_to_json(v)), '[]'::json) from (
      select p.id as profile_id, p.restaurant_id, u.email
      from profiles p join auth.users u on u.id = p.id
      where p.role = 'vendor'
    ) v),
    'drivers', (select coalesce(json_agg(row_to_json(d)), '[]'::json) from (
      select p.id as profile_id, p.driver_id, u.email
      from profiles p join auth.users u on u.id = p.id
      where p.role = 'driver'
    ) d),
    'catalog', (select coalesce(json_agg(row_to_json(c)), '[]'::json) from (
      select p.id as profile_id, p.name, p.role, u.email, u.created_at
      from profiles p join auth.users u on u.id = p.id
      where p.role in ('catalog', 'supervisor', 'observer')
      order by p.role, u.created_at
    ) c)
  )
  where is_admin();
$function$;
