-- The promo-code wrapper (public.place_order, 18-arg, from migration
-- 20260813190000_observer_and_promo_codes.sql, later recreated verbatim by
-- 20260813162516_fix_ambiguous_place_order_promo_overload.sql) tried
-- `v_result || json_build_object(...)` where v_result is declared `json`.
-- Postgres has no || operator for json (only jsonb), so every order placed
-- with a promo code hit "operator does not exist: json || json" -- a raw
-- 500 the checkout page could not map to any known promo_* error code,
-- surfacing to the customer as the generic "حصل خطأ، جرب تاني". This has
-- been failing on 100% of promo-code checkouts since that migration
-- landed, predating even today's scope feature.
--
-- Fix: cast both sides to jsonb for the merge, cast back to json.

CREATE OR REPLACE FUNCTION public.place_order(
  p_restaurant_id integer, p_customer_name text, p_customer_phone text, p_zone text, p_unit_number text,
  p_address_notes text, p_delivery_fee numeric, p_items json, p_promo_code text,
  p_slot_id integer DEFAULT NULL::integer, p_scheduled_date date DEFAULT NULL::date,
  p_compound_id integer DEFAULT NULL::integer, p_payment_method text DEFAULT 'cod'::text,
  p_use_wallet boolean DEFAULT false, p_session_token uuid DEFAULT NULL::uuid,
  p_customer_note text DEFAULT NULL::text, p_rate_key text DEFAULT NULL::text, p_auth_user_id uuid DEFAULT NULL::uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_result json; v_order_id integer; v_customer_id integer; v_discount numeric;
begin
  v_result := public.place_order(
    p_restaurant_id=>p_restaurant_id, p_customer_name=>p_customer_name, p_customer_phone=>p_customer_phone,
    p_zone=>p_zone, p_unit_number=>p_unit_number, p_address_notes=>p_address_notes,
    p_delivery_fee=>p_delivery_fee, p_items=>p_items, p_slot_id=>p_slot_id, p_scheduled_date=>p_scheduled_date,
    p_compound_id=>p_compound_id, p_payment_method=>p_payment_method, p_use_wallet=>p_use_wallet,
    p_session_token=>p_session_token, p_customer_note=>p_customer_note, p_rate_key=>p_rate_key,
    p_auth_user_id=>p_auth_user_id
  );
  if nullif(trim(coalesce(p_promo_code,'')),'') is not null then
    select customer_id into v_customer_id from orders where id=(v_result->>'id')::integer;
    v_discount := private.apply_order_promo((v_result->>'id')::integer,p_promo_code,v_customer_id,p_customer_phone);
    v_result := (v_result::jsonb || jsonb_build_object('promo_discount',v_discount))::json;
  end if;
  return v_result;
end $function$;
