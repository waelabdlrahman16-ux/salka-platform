create or replace function public.log_app_event(
  p_event text,
  p_device_id text default null,
  p_session_id uuid default null,
  p_compound_id integer default null,
  p_restaurant_id integer default null,
  p_order_id integer default null,
  p_props jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device_id text;
  v_recent integer;
begin
  if p_event not in ('arrival','place_chosen','vendor_opened','item_added',
                     'checkout_started','order_placed') then
    return;
  end if;

  -- A missing device label used to bypass the only flood guard entirely.
  v_device_id := nullif(btrim(coalesce(p_device_id, '')), '');
  if v_device_id is null or length(v_device_id) > 64 then return; end if;

  select count(*) into v_recent
    from app_events
   where device_id = v_device_id
     and created_at > now() - interval '1 minute';
  if v_recent >= 120 then return; end if;

  insert into app_events (
    event, device_id, session_id, customer_id,
    compound_id, restaurant_id, order_id, props
  ) values (
    p_event, v_device_id, p_session_id, my_customer_id(),
    p_compound_id, p_restaurant_id, p_order_id,
    case when length(coalesce(p_props, '{}'::jsonb)::text) > 2000
         then '{"truncated":true}'::jsonb
         else coalesce(p_props, '{}'::jsonb)
    end
  );
end;
$function$;

create or replace function public.submit_complaint(
  p_token uuid,
  p_description text,
  p_category text default 'other'
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id integer;
  v_driver_id integer;
  v_category text;
  v_description text;
  v_recent integer;
begin
  select id into v_order_id from orders where public_token = p_token;
  if v_order_id is null then raise exception 'order_not_found'; end if;

  v_description := nullif(btrim(coalesce(p_description, '')), '');
  if v_description is null or length(v_description) < 5 then
    raise exception 'complaint_too_short';
  end if;
  if length(v_description) > 2000 then raise exception 'complaint_too_long'; end if;

  -- Enough for separate item, quality and delivery problems without allowing a
  -- leaked order token to fill the operations queue indefinitely.
  select count(*) into v_recent
    from complaints
   where order_id = v_order_id
     and created_at > now() - interval '24 hours';
  if v_recent >= 5 then raise exception 'complaint_limit_reached'; end if;

  v_category := case
    when p_category in ('missing_item','wrong_item','driver_conduct','quality','other')
      then p_category
    else 'other'
  end;

  select driver_id into v_driver_id
    from driver_earnings where order_id = v_order_id limit 1;
  if v_driver_id is null then
    select driver_id into v_driver_id
      from delivery_assignments
     where order_id = v_order_id
     order by attempt_number desc
     limit 1;
  end if;

  insert into complaints (order_id, description, category, driver_id)
  values (v_order_id, v_description, v_category, v_driver_id);
end;
$function$;

create or replace function public.submit_rating(
  p_token uuid,
  p_driver_rating integer default null,
  p_restaurant_rating integer default null,
  p_comment text default ''
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id integer;
  v_driver_id integer;
  v_restaurant_id integer;
  v_status text;
  v_comment text;
begin
  if p_driver_rating is null and p_restaurant_rating is null then
    raise exception 'rating_required';
  end if;
  if p_driver_rating is not null and p_driver_rating not between 1 and 5 then
    raise exception 'invalid_driver_rating';
  end if;
  if p_restaurant_rating is not null and p_restaurant_rating not between 1 and 5 then
    raise exception 'invalid_restaurant_rating';
  end if;

  v_comment := btrim(coalesce(p_comment, ''));
  if length(v_comment) > 1000 then raise exception 'comment_too_long'; end if;

  select o.id, o.restaurant_id, o.status
    into v_order_id, v_restaurant_id, v_status
    from orders o
   where o.public_token = p_token;
  if v_order_id is null then raise exception 'order_not_found'; end if;
  if v_status <> 'Delivered' then raise exception 'order_not_delivered'; end if;

  select da.driver_id into v_driver_id
    from delivery_assignments da
   where da.order_id = v_order_id and da.status = 'Delivered'
   order by da.attempt_number desc
   limit 1;

  insert into order_ratings (order_id, driver_rating, restaurant_rating, comment)
  values (v_order_id, p_driver_rating, p_restaurant_rating, v_comment)
  on conflict (order_id) do update set
    driver_rating = coalesce(excluded.driver_rating, order_ratings.driver_rating),
    restaurant_rating = coalesce(excluded.restaurant_rating, order_ratings.restaurant_rating),
    comment = excluded.comment;

  if p_driver_rating is not null and v_driver_id is not null then
    update drivers set rating = (
      select round(avg(r.driver_rating)::numeric, 1)
        from order_ratings r
        join delivery_assignments da2 on da2.order_id = r.order_id
       where da2.driver_id = v_driver_id and r.driver_rating is not null
    ) where id = v_driver_id;
  end if;

  if p_restaurant_rating is not null then
    update restaurants set rating = (
      select round(avg(r.restaurant_rating)::numeric, 1)
        from order_ratings r
        join orders o2 on o2.id = r.order_id
       where o2.restaurant_id = v_restaurant_id and r.restaurant_rating is not null
    ) where id = v_restaurant_id;
  end if;
end;
$function$;

create or replace function public.save_customer_push_token(
  p_token uuid,
  p_push_token text,
  p_platform text default 'web'
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_push_token text;
  v_rows integer;
begin
  if p_platform not in ('web','android','ios') then raise exception 'bad_platform'; end if;

  v_push_token := nullif(btrim(coalesce(p_push_token, '')), '');
  if v_push_token is null then raise exception 'empty_token'; end if;
  if length(v_push_token) > 4096 then raise exception 'token_too_long'; end if;

  if exists (select 1 from dead_push_tokens d where d.token = v_push_token) then
    return json_build_object('stored', false, 'stale', true);
  end if;

  update orders
     set push_token = v_push_token, push_platform = p_platform
   where public_token = p_token;
  get diagnostics v_rows = row_count;

  return json_build_object('stored', v_rows > 0, 'stale', false);
end;
$function$;

-- These four are intentionally customer-facing. Remove implicit PUBLIC access,
-- then grant only the application roles explicitly.
revoke all on function public.log_app_event(text,text,uuid,integer,integer,integer,jsonb) from public;
revoke all on function public.submit_complaint(uuid,text,text) from public;
revoke all on function public.submit_rating(uuid,integer,integer,text) from public;
revoke all on function public.save_customer_push_token(uuid,text,text) from public;

grant execute on function public.log_app_event(text,text,uuid,integer,integer,integer,jsonb) to anon, authenticated, service_role;
grant execute on function public.submit_complaint(uuid,text,text) to anon, authenticated, service_role;
grant execute on function public.submit_rating(uuid,integer,integer,text) to anon, authenticated, service_role;
grant execute on function public.save_customer_push_token(uuid,text,text) to anon, authenticated, service_role;

do $verification$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.log_app_event(text,text,uuid,integer,integer,integer,jsonb)',
    'public.submit_complaint(uuid,text,text)',
    'public.submit_rating(uuid,integer,integer,text)',
    'public.save_customer_push_token(uuid,text,text)'
  ] loop
    if not has_function_privilege('anon', v_signature, 'execute')
       or not has_function_privilege('authenticated', v_signature, 'execute')
       or not has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'required application execute privilege missing for %', v_signature;
    end if;
  end loop;
end
$verification$;
