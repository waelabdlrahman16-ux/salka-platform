-- A tracking UUID is a bearer credential for guest customers. It may create a
-- delivered order's first rating, but a later holder must not be able to keep
-- rewriting restaurant and driver reputation. Only the authenticated owner may
-- revise an existing rating, and all rating activity closes after 30 days.
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
  v_customer_auth_user_id uuid;
  v_delivered_at timestamptz;
  v_rating_exists boolean;
  v_is_owner boolean;
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

  -- Serialise the first submission and any owner revision on the order row.
  select o.id,
         o.restaurant_id,
         o.status,
         c.auth_user_id,
         delivered.delivered_at,
         exists (
           select 1 from public.order_ratings r where r.order_id = o.id
         )
    into v_order_id,
         v_restaurant_id,
         v_status,
         v_customer_auth_user_id,
         v_delivered_at,
         v_rating_exists
    from public.orders o
    left join public.customers c on c.id = o.customer_id
    left join lateral (
      select da.delivered_at
        from public.delivery_assignments da
       where da.order_id = o.id
         and da.status = 'Delivered'
       order by da.attempt_number desc
       limit 1
    ) delivered on true
   where o.public_token = p_token
   for update of o;

  if v_order_id is null then raise exception 'order_not_found'; end if;
  if v_status <> 'Delivered' then raise exception 'order_not_delivered'; end if;
  if v_delivered_at is null
     or v_delivered_at < now() - interval '30 days' then
    raise exception 'rating_window_closed';
  end if;

  v_is_owner := auth.uid() is not null
                and auth.uid() = v_customer_auth_user_id;

  if v_rating_exists and not v_is_owner then
    raise exception 'rating_already_submitted';
  end if;

  select da.driver_id into v_driver_id
    from public.delivery_assignments da
   where da.order_id = v_order_id and da.status = 'Delivered'
   order by da.attempt_number desc
   limit 1;

  insert into public.order_ratings (
    order_id,
    driver_rating,
    restaurant_rating,
    comment
  )
  values (
    v_order_id,
    p_driver_rating,
    p_restaurant_rating,
    v_comment
  )
  on conflict (order_id) do update set
    driver_rating = coalesce(excluded.driver_rating, order_ratings.driver_rating),
    restaurant_rating = coalesce(excluded.restaurant_rating, order_ratings.restaurant_rating),
    comment = excluded.comment;

  if p_driver_rating is not null and v_driver_id is not null then
    update public.drivers set rating = (
      select round(avg(r.driver_rating)::numeric, 1)
        from public.order_ratings r
        join public.delivery_assignments da2 on da2.order_id = r.order_id
       where da2.driver_id = v_driver_id and r.driver_rating is not null
    ) where id = v_driver_id;
  end if;

  if p_restaurant_rating is not null then
    update public.restaurants set rating = (
      select round(avg(r.restaurant_rating)::numeric, 1)
        from public.order_ratings r
        join public.orders o2 on o2.id = r.order_id
       where o2.restaurant_id = v_restaurant_id and r.restaurant_rating is not null
    ) where id = v_restaurant_id;
  end if;
end;
$function$;

-- Return only whether a rating exists. The rating values and comment remain
-- private, while the tracking page can avoid offering an action that is no
-- longer available to a guest bearer.
create or replace function public.track_order(p_token uuid)
returns json
language sql
security definer
set search_path to 'public'
as $function$
  select json_build_object(
    'order', (
      select row_to_json(o) from (
        select o.id, o.status, o.subtotal, o.delivery_fee, o.service_fee,
               o.wallet_used, o.total, o.zone, o.unit_number, o.address_notes,
               o.ready_at, o.scheduled_date, o.created_at, o.sla_minutes,
               o.order_type, o.request_items, o.request_notes,
               o.pricing_status, o.payment_mode, o.collect_amount,
               o.payment_method, o.online_payment_status,
               o.cod_deposit_amount,
               o.instapay_claimed_at is not null as instapay_claimed,
               o.cancel_reason, o.cancelled_at, o.refund_status,
               o.kitchen_status, r.name as restaurant_name, r.vendor_type,
               c.latitude as dest_lat, c.longitude as dest_lng,
               exists (
                 select 1 from public.order_ratings rating
                  where rating.order_id = o.id
               ) as rating_submitted
          from public.orders o
          left join public.restaurants r on r.id = o.restaurant_id
          left join public.compounds c on c.id = o.compound_id
         where o.public_token = p_token
      ) o
    ),
    'items', (
      select coalesce(json_agg(row_to_json(i)), '[]'::json) from (
        select oi.name, oi.qty, oi.total, oi.size_name, oi.combo_name,
               oi.addon_names, mi.image_url,
               coalesce(oi.is_adjustment, false) as is_adjustment
          from public.order_items oi
          left join public.menu_items mi on mi.id = oi.menu_item_id
         where oi.order_id = (
           select id from public.orders where public_token = p_token
         )
      ) i
    ),
    'assignment', (
      select row_to_json(a) from (
        select da.status,
               case
                 when da.status in (
                   'Accepted','Picked_Up','Out_for_Delivery','Delivered'
                 ) then d.name
               end as driver_name,
               case
                 when da.status in (
                   'Accepted','Picked_Up','Out_for_Delivery'
                 ) then d.phone
               end as driver_phone,
               case
                 when da.status = 'Delivered'
                 then coalesce(d.instapay_number, d.phone)
               end as driver_instapay,
               case
                 when da.status in ('Picked_Up','Out_for_Delivery')
                 then d.current_lat
               end as driver_lat,
               case
                 when da.status in ('Picked_Up','Out_for_Delivery')
                 then d.current_lng
               end as driver_lng,
               case
                 when da.status in ('Picked_Up','Out_for_Delivery')
                 then d.location_updated_at
               end as driver_location_updated_at,
               case
                 when da.status in ('Out_for_Delivery','Delivered')
                 then da.arrived_at_customer_at
               end as arrived_at_customer_at
          from public.delivery_assignments da
          left join public.drivers d on d.id = da.driver_id
         where da.order_id = (
           select id from public.orders where public_token = p_token
         )
           and da.status not in ('Rejected','Failed','Cancelled')
         order by da.attempt_number desc
         limit 1
      ) a
    )
  );
$function$;

revoke all on function public.submit_rating(uuid,integer,integer,text) from public;
revoke all on function public.track_order(uuid) from public;
grant execute on function public.submit_rating(uuid,integer,integer,text)
  to anon, authenticated, service_role;
grant execute on function public.track_order(uuid)
  to anon, authenticated, service_role;

do $verification$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.submit_rating(uuid,integer,integer,text)',
    'public.track_order(uuid)'
  ] loop
    if not has_function_privilege('anon', v_signature, 'execute')
       or not has_function_privilege('authenticated', v_signature, 'execute')
       or not has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'required application execute privilege missing for %', v_signature;
    end if;

    if exists (
      select 1
        from pg_proc p
        cross join lateral aclexplode(
          coalesce(p.proacl, acldefault('f', p.proowner))
        ) acl
       where p.oid = v_signature::regprocedure
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
    ) then
      raise exception 'implicit public execute privilege remains for %', v_signature;
    end if;
  end loop;
end
$verification$;
