-- Vendor, Driver, Supervisor and Admin all show back the delivery note a
-- customer typed at checkout (orders.customer_note) -- but track_order()
-- never selected it, so the one person who wrote it could never see it
-- again on their own tracking page to confirm it went through.

create or replace function private.track_order(p_token uuid)
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
               o.order_type, o.request_items, o.request_notes, o.customer_note,
               o.pricing_status, o.payment_mode, o.collect_amount,
               o.payment_method, o.online_payment_status,
               o.cod_deposit_amount,
               o.instapay_claimed_at is not null as instapay_claimed,
               o.cancel_reason, o.cancelled_at, o.refund_status,
               o.kitchen_status, r.name as restaurant_name, r.vendor_type,
               c.latitude as dest_lat, c.longitude as dest_lng,
               o.promo_discount, pc.code as promo_code,
               exists (
                 select 1 from public.order_ratings rating
                  where rating.order_id = o.id
               ) as rating_submitted
          from public.orders o
          left join public.restaurants r on r.id = o.restaurant_id
          left join public.compounds c on c.id = o.compound_id
          left join public.promo_codes pc on pc.id = o.promo_code_id
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
