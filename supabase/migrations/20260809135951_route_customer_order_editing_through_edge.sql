-- Replace the anonymous wrapper, whose rate-limit bucket contained the raw
-- bearer token, with one service-only wrapper around an atomic private core.
create function private.append_request_items_secure(
  p_token uuid,
  p_items json,
  p_rate_key text
) returns json
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_bucket text;
  v_recent integer;
  v_o orders%rowtype;
  v_merged jsonb;
  v_new jsonb;
  v_item jsonb;
  v_idx integer;
  v_name text;
begin
  if p_token is null then raise exception 'invalid_token'; end if;
  if p_rate_key is null or p_rate_key !~ '^[0-9a-f]{64}$' then raise exception 'invalid_rate_key'; end if;
  if p_items is null or json_typeof(p_items) <> 'array' then raise exception 'invalid_items'; end if;
  if json_array_length(p_items) not between 1 and 20 then raise exception 'invalid_item_count'; end if;
  if exists (
    select 1 from json_array_elements(p_items) item
     where json_typeof(item) <> 'object'
        or length(btrim(coalesce(item->>'name', ''))) not between 1 and 200
        or not case
          when length(coalesce(item->>'qty', '')) <= 3
               and coalesce(item->>'qty', '') ~ '^[0-9]+$'
          then (item->>'qty')::numeric between 1 and 100
          else false
        end
  ) then raise exception 'invalid_item'; end if;

  v_bucket := 'order-edit-sha256:' || p_rate_key;
  perform pg_advisory_xact_lock(hashtextextended(v_bucket, 0));
  select count(*) into v_recent from rate_limit_log
   where bucket = v_bucket and called_at > now() - interval '15 minutes';
  if v_recent >= 5 then raise exception 'order_edit_rate_limit'; end if;
  select count(*) into v_recent from rate_limit_log
   where bucket = v_bucket and called_at > now() - interval '24 hours';
  if v_recent >= 20 then raise exception 'daily_order_edit_limit'; end if;

  select * into v_o from orders where public_token = p_token for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_o.status in ('Cancelled','Failed','Delivered') then raise exception 'order_closed'; end if;
  if coalesce(v_o.pricing_status,'n/a') <> 'pending_quote' then raise exception 'order_not_priced'; end if;
  if coalesce(v_o.kitchen_status,'new') <> 'new' then raise exception 'wrong_stage'; end if;
  if exists (select 1 from delivery_assignments da
              where da.order_id = v_o.id
                and da.status in ('Offered','Accepted','Picked_Up','Out_for_Delivery')) then
    raise exception 'already_assigned';
  end if;

  v_merged := coalesce(v_o.request_items, '[]'::jsonb);
  v_new := p_items::jsonb;
  for v_item in select * from jsonb_array_elements(v_new) loop
    v_name := lower(btrim(v_item->>'name'));
    v_idx := null;
    select i - 1 into v_idx
      from generate_series(1, jsonb_array_length(v_merged)) i
     where lower(btrim(coalesce(v_merged->(i-1)->>'name',''))) = v_name
     limit 1;

    if v_idx is null then
      v_merged := v_merged || jsonb_build_array(
        jsonb_build_object('name', btrim(v_item->>'name'), 'qty', (v_item->>'qty')::integer));
    else
      v_merged := jsonb_set(v_merged, array[v_idx::text, 'qty'],
        to_jsonb(coalesce((v_merged->v_idx->>'qty')::integer, 1) + (v_item->>'qty')::integer));
    end if;
  end loop;

  if jsonb_typeof(v_merged) <> 'array' or jsonb_array_length(v_merged) > 50 then
    raise exception 'too_many_order_items';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_merged) item
     where length(btrim(coalesce(item->>'name', ''))) not between 1 and 200
        or not case
          when length(coalesce(item->>'qty', '')) <= 3
               and coalesce(item->>'qty', '') ~ '^[0-9]+$'
          then (item->>'qty')::numeric between 1 and 100
          else false
        end
  ) then raise exception 'invalid_merged_item'; end if;

  update orders set request_items = v_merged where id = v_o.id;
  insert into rate_limit_log (bucket) values (v_bucket);
  return json_build_object('items', v_merged);
end
$function$;

revoke all on function private.append_request_items_secure(uuid, json, text) from public, anon, authenticated;
grant execute on function private.append_request_items_secure(uuid, json, text) to service_role;

drop function public.append_request_items(uuid, json);
drop function private.append_request_items(uuid, json);

create function public.append_request_items(p_token uuid, p_items json, p_rate_key text)
returns json language sql security invoker set search_path = ''
as $function$ select private.append_request_items_secure(p_token, p_items, p_rate_key) $function$;

revoke execute on function public.append_request_items(uuid, json, text) from public, anon, authenticated;
grant execute on function public.append_request_items(uuid, json, text) to service_role;

-- Old wrapper buckets exposed bearer tokens. They have no value after 24 hours
-- and the new hashed buckets are intentionally not linkable to them.
delete from rate_limit_log where bucket ~ '^order-edit:[0-9a-f-]{36}$';

do $permissions_check$
begin
  if to_regprocedure('public.append_request_items(uuid,json)') is not null
     or to_regprocedure('private.append_request_items(uuid,json)') is not null then
    raise exception 'legacy raw-token order editing function still exists';
  end if;
  if has_function_privilege('anon', 'public.append_request_items(uuid,json,text)', 'execute')
     or has_function_privilege('authenticated', 'public.append_request_items(uuid,json,text)', 'execute') then
    raise exception 'client role still has direct order-editing access';
  end if;
  if not has_function_privilege('service_role', 'public.append_request_items(uuid,json,text)', 'execute')
     or not has_function_privilege('service_role', 'private.append_request_items_secure(uuid,json,text)', 'execute') then
    raise exception 'order-editing Edge Function lost database access';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.append_request_items(uuid,json,text)'::regprocedure) then
    raise exception 'public order-editing wrapper must remain SECURITY INVOKER';
  end if;
  if not (select prosecdef from pg_proc where oid = 'private.append_request_items_secure(uuid,json,text)'::regprocedure) then
    raise exception 'private order-editing core lost SECURITY DEFINER';
  end if;
  if exists (select 1 from rate_limit_log where bucket ~ '^order-edit:[0-9a-f-]{36}$') then
    raise exception 'raw order bearer token remains in rate-limit logs';
  end if;
end
$permissions_check$;
