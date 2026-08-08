-- Preserve the existing custom-order engines, but remove them from the
-- exposed Data API schema. The public wrappers validate and rate-limit input
-- before delegating to the reviewed business logic.
alter function public.submit_custom_order(
  integer,text,text,text,text,text,numeric,json,text,integer,uuid,integer,date,text
) set schema private;

alter function public.append_request_items(uuid,json) set schema private;

revoke all on function private.submit_custom_order(
  integer,text,text,text,text,text,numeric,json,text,integer,uuid,integer,date,text
) from public, anon, authenticated;
revoke all on function private.append_request_items(uuid,json)
  from public, anon, authenticated;

create function public.submit_custom_order(
  p_restaurant_id integer,
  p_customer_name text,
  p_customer_phone text,
  p_zone text,
  p_unit_number text,
  p_address_notes text,
  p_delivery_fee numeric,
  p_request_items json,
  p_request_notes text,
  p_compound_id integer default null,
  p_session_token uuid default null,
  p_slot_id integer default null,
  p_scheduled_date date default null,
  p_prescription_path text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone text;
  v_items json := coalesce(p_request_items, '[]'::json);
  v_bucket text;
  v_recent integer;
  v_result json;
begin
  v_phone := normalize_phone(p_customer_phone);

  if length(btrim(coalesce(p_customer_name, ''))) not between 2 and 100 then
    raise exception 'invalid_customer_name';
  end if;
  if v_phone is null or v_phone !~ '^1[0-25][0-9]{8}$' then
    raise exception 'invalid_phone';
  end if;
  if length(btrim(coalesce(p_zone, ''))) not between 1 and 120 then
    raise exception 'invalid_zone';
  end if;
  if length(btrim(coalesce(p_unit_number, ''))) not between 1 and 100 then
    raise exception 'invalid_unit_number';
  end if;
  if length(coalesce(p_address_notes, '')) > 1000
     or length(coalesce(p_request_notes, '')) > 2000 then
    raise exception 'notes_too_long';
  end if;
  if json_typeof(v_items) <> 'array' then
    raise exception 'invalid_items';
  end if;
  if json_array_length(v_items) > 50 then
    raise exception 'invalid_item_count';
  end if;
  if exists (
    select 1
      from json_array_elements(v_items) item
     where json_typeof(item) <> 'object'
        or length(btrim(coalesce(item->>'name', ''))) not between 1 and 200
        or not case
          when length(coalesce(item->>'qty', '')) <= 3
               and coalesce(item->>'qty', '') ~ '^[0-9]+$'
          then (item->>'qty')::numeric between 1 and 100
          else false
        end
  ) then
    raise exception 'invalid_item';
  end if;

  v_bucket := 'order:' || v_phone;
  perform pg_advisory_xact_lock(hashtextextended(v_bucket, 0));

  select count(*) into v_recent from rate_limit_log
   where bucket = v_bucket and called_at > now() - interval '15 minutes';
  if v_recent >= 5 then raise exception 'order_rate_limit'; end if;

  select count(*) into v_recent from rate_limit_log
   where bucket = v_bucket and called_at > now() - interval '24 hours';
  if v_recent >= 20 then raise exception 'daily_order_limit'; end if;

  v_result := private.submit_custom_order(
    p_restaurant_id, p_customer_name, v_phone, p_zone, p_unit_number,
    p_address_notes, p_delivery_fee, v_items, p_request_notes,
    p_compound_id, p_session_token, p_slot_id, p_scheduled_date,
    p_prescription_path
  );

  insert into rate_limit_log (bucket) values (v_bucket);
  return v_result;
end;
$function$;

create function public.append_request_items(p_token uuid, p_items json)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_bucket text;
  v_recent integer;
  v_result json;
  v_merged jsonb;
begin
  if p_token is null then raise exception 'invalid_token'; end if;
  if p_items is null or json_typeof(p_items) <> 'array' then
    raise exception 'invalid_items';
  end if;
  if json_array_length(p_items) not between 1 and 20 then
    raise exception 'invalid_item_count';
  end if;
  if exists (
    select 1
      from json_array_elements(p_items) item
     where json_typeof(item) <> 'object'
        or length(btrim(coalesce(item->>'name', ''))) not between 1 and 200
        or not case
          when length(coalesce(item->>'qty', '')) <= 3
               and coalesce(item->>'qty', '') ~ '^[0-9]+$'
          then (item->>'qty')::numeric between 1 and 100
          else false
        end
  ) then
    raise exception 'invalid_item';
  end if;

  v_bucket := 'order-edit:' || p_token::text;
  perform pg_advisory_xact_lock(hashtextextended(v_bucket, 0));

  select count(*) into v_recent from rate_limit_log
   where bucket = v_bucket and called_at > now() - interval '15 minutes';
  if v_recent >= 5 then raise exception 'order_edit_rate_limit'; end if;

  select count(*) into v_recent from rate_limit_log
   where bucket = v_bucket and called_at > now() - interval '24 hours';
  if v_recent >= 20 then raise exception 'daily_order_edit_limit'; end if;

  v_result := private.append_request_items(p_token, p_items);
  v_merged := coalesce(v_result::jsonb->'items', '[]'::jsonb);

  -- The private engine has already locked and updated the row. Raising here
  -- rolls that update back atomically if the merged order exceeds the cap.
  if jsonb_typeof(v_merged) <> 'array' or jsonb_array_length(v_merged) > 50 then
    raise exception 'too_many_order_items';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(v_merged) item
     where length(btrim(coalesce(item->>'name', ''))) not between 1 and 200
        or not case
          when length(coalesce(item->>'qty', '')) <= 3
               and coalesce(item->>'qty', '') ~ '^[0-9]+$'
          then (item->>'qty')::numeric between 1 and 100
          else false
        end
  ) then
    raise exception 'invalid_merged_item';
  end if;

  insert into rate_limit_log (bucket) values (v_bucket);
  return v_result;
end;
$function$;

revoke all on function public.submit_custom_order(
  integer,text,text,text,text,text,numeric,json,text,integer,uuid,integer,date,text
) from public;
revoke all on function public.append_request_items(uuid,json) from public;

grant execute on function public.submit_custom_order(
  integer,text,text,text,text,text,numeric,json,text,integer,uuid,integer,date,text
) to anon, authenticated, service_role;
grant execute on function public.append_request_items(uuid,json)
  to anon, authenticated, service_role;

do $verification$
begin
  if to_regprocedure('private.submit_custom_order(integer,text,text,text,text,text,numeric,json,text,integer,uuid,integer,date,text)') is null
     or to_regprocedure('private.append_request_items(uuid,json)') is null then
    raise exception 'private custom-order engine missing';
  end if;
  if has_function_privilege(
       'anon',
       'private.submit_custom_order(integer,text,text,text,text,text,numeric,json,text,integer,uuid,integer,date,text)',
       'execute'
     ) or has_function_privilege(
       'anon', 'private.append_request_items(uuid,json)', 'execute'
     ) then
    raise exception 'anonymous access to private custom-order engine remains';
  end if;
  if not has_function_privilege(
       'anon',
       'public.submit_custom_order(integer,text,text,text,text,text,numeric,json,text,integer,uuid,integer,date,text)',
       'execute'
     ) or not has_function_privilege(
       'anon', 'public.append_request_items(uuid,json)', 'execute'
     ) then
    raise exception 'public custom-order wrapper is unavailable';
  end if;
end
$verification$;
