-- INCIDENT FIX 2026-08-13: migration 20260813131425 (observer_and_promo_codes) added
-- public.place_order(..., p_promo_code text DEFAULT NULL) as a NEW overload alongside the
-- existing 17-arg public.place_order. Because that new function's own body then called
-- public.place_order(...) POSITIONALLY with exactly 17 args, the call matched BOTH itself
-- (18th arg defaulted) and the original 17-arg function -> "function ... is not unique".
-- This has been failing on 100% of place_order calls since ~2026-08-13 14:49 UTC.
--
-- Fix: move p_promo_code out of the trailing-defaults block and make it required (no
-- default), positioned right after p_items. This makes the two overloads mutually
-- exclusive by parameter name for PostgREST's named-argument calls: a call naming
-- p_promo_code (the deployed client always does, even as null) resolves only to this
-- function; a call that omits it resolves only to the original 17-arg function
-- (unaffected, untouched, fully backward compatible with any older cached client).

drop function public.place_order(integer, text, text, text, text, text, numeric, json, integer, date, integer, text, boolean, uuid, text, text, uuid, text);

create function public.place_order(
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
    v_result := v_result || json_build_object('promo_discount',v_discount);
  end if;
  return v_result;
end $function$;

grant execute on function public.place_order(integer, text, text, text, text, text, numeric, json, text, integer, date, integer, text, boolean, uuid, text, text, uuid) to anon, authenticated, service_role;
