-- The order UUID is a bearer link for customer tracking. Return only the
-- driver data needed at each assignment stage instead of exposing every field
-- as soon as an offer is created.
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
               c.latitude as dest_lat, c.longitude as dest_lng
          from orders o
          left join restaurants r on r.id = o.restaurant_id
          left join compounds c on c.id = o.compound_id
         where o.public_token = p_token
      ) o
    ),
    'items', (
      select coalesce(json_agg(row_to_json(i)), '[]'::json) from (
        select oi.name, oi.qty, oi.total, oi.size_name, oi.combo_name,
               oi.addon_names, mi.image_url,
               coalesce(oi.is_adjustment, false) as is_adjustment
          from order_items oi
          left join menu_items mi on mi.id = oi.menu_item_id
         where oi.order_id = (
           select id from orders where public_token = p_token
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
          from delivery_assignments da
          left join drivers d on d.id = da.driver_id
         where da.order_id = (
           select id from orders where public_token = p_token
         )
           and da.status not in ('Rejected','Failed','Cancelled')
         order by da.attempt_number desc
         limit 1
      ) a
    )
  );
$function$;

revoke all on function public.track_order(uuid) from public;
grant execute on function public.track_order(uuid)
  to anon, authenticated, service_role;

do $verification$
begin
  if not has_function_privilege(
       'anon', 'public.track_order(uuid)', 'execute'
     ) then
    raise exception 'customer tracking endpoint is unavailable';
  end if;
  if exists (
    select 1
      from pg_proc p
      cross join lateral aclexplode(
        coalesce(p.proacl, acldefault('f', p.proowner))
      ) acl
     where p.oid = 'public.track_order(uuid)'::regprocedure
       and acl.grantee = 0
       and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'implicit public tracking grant remains';
  end if;
end
$verification$;
