-- Public browsing remains available through the publishable-key Edge Function,
-- but the browser can no longer scrape the privileged database RPCs directly.
-- The Edge Function validates inputs, applies hashed per-client rate limits,
-- and calls these functions as service_role.

-- A single customer's free-text request is not a "popular" suggestion. Apart
-- from being noisy, showing one-off text can expose a name, phone number or
-- address somebody typed into their shopping list. Historical free-text only
-- qualifies after at least three matching requests; normal menu-item fallback
-- suggestions remain unchanged.
create or replace function public.popular_request_items(p_restaurant_id integer)
returns json
language sql
stable security definer
set search_path = 'public'
as $function$
  select coalesce(json_agg(name order by rank, n desc, name), '[]'::json) from (
    select name, min(rank) as rank, sum(n) as n from (
      select btrim(it->>'name') as name, 1 as rank, count(*)::bigint as n
        from orders o, jsonb_array_elements(coalesce(o.request_items,'[]'::jsonb)) it
       where o.restaurant_id = p_restaurant_id
         and o.created_at > now() - interval '60 days'
         and coalesce(btrim(it->>'name'),'') <> ''
         and not exists (select 1 from menu_items mi
            where mi.restaurant_id = p_restaurant_id and mi.is_shelf_label
              and lower(btrim(mi.name)) = lower(btrim(it->>'name')))
         and not exists (select 1 from menu_items mi2
            where mi2.restaurant_id = p_restaurant_id
              and lower(btrim(mi2.category)) = lower(btrim(it->>'name')))
         and not exists (select 1 from request_item_suppressions s
            where s.restaurant_id = p_restaurant_id
              and case when s.match_mode = 'contains'
                       then lower(btrim(it->>'name')) like '%'||lower(btrim(s.name))||'%'
                       else lower(btrim(it->>'name')) = lower(btrim(s.name)) end)
       group by 1
      having count(distinct o.id) >= 3
      union all
      select mi.name, 2 as rank, 0::bigint as n
        from menu_items mi
       where mi.restaurant_id = p_restaurant_id
         and mi.available and not mi.is_shelf_label
         and not exists (select 1 from request_item_suppressions s
            where s.restaurant_id = p_restaurant_id
              and case when s.match_mode = 'contains'
                       then lower(btrim(mi.name)) like '%'||lower(btrim(s.name))||'%'
                       else lower(btrim(mi.name)) = lower(btrim(s.name)) end)
    ) u
    group by name
    order by min(rank), sum(n) desc, name
    limit 8) x;
$function$;

revoke execute on function public.delivery_quote(integer, integer) from public, anon, authenticated;
revoke execute on function public.open_slots(integer) from public, anon, authenticated;
revoke execute on function public.popular_request_items(integer) from public, anon, authenticated;
revoke execute on function public.restaurant_public(integer) from public, anon, authenticated;
revoke execute on function public.restaurants_for_compound(integer) from public, anon, authenticated;
revoke execute on function public.search_menu_for_compound(integer, text, integer) from public, anon, authenticated;

grant execute on function public.delivery_quote(integer, integer) to service_role;
grant execute on function public.open_slots(integer) to service_role;
grant execute on function public.popular_request_items(integer) to service_role;
grant execute on function public.restaurant_public(integer) to service_role;
grant execute on function public.restaurants_for_compound(integer) to service_role;
grant execute on function public.search_menu_for_compound(integer, text, integer) to service_role;

do $permissions_check$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.delivery_quote(integer,integer)',
    'public.open_slots(integer)',
    'public.popular_request_items(integer)',
    'public.restaurant_public(integer)',
    'public.restaurants_for_compound(integer)',
    'public.search_menu_for_compound(integer,text,integer)'
  ] loop
    if has_function_privilege('anon', v_signature, 'execute')
       or has_function_privilege('authenticated', v_signature, 'execute') then
      raise exception 'client role still has direct catalog access: %', v_signature;
    end if;
    if not has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'public-catalog Edge Function lost access: %', v_signature;
    end if;
  end loop;
end
$permissions_check$;
