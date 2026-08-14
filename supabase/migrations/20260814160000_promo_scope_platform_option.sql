-- Adds a fifth promo scope: 'platform'. Same waterfall as 'all' -- service fee
-- first, then delivery -- but capped there. Unlike 'all', it can never reach
-- the vendor's basket no matter how large the discount, for an admin who wants
-- to fund a code out of Salka's own fees without any chance of it spilling
-- into what the restaurant is owed.

alter table public.promo_codes drop constraint if exists promo_codes_applies_to_check;
alter table public.promo_codes
  add constraint promo_codes_applies_to_check check (applies_to in ('delivery','service','vendor','platform','all'));

create or replace function private.promo_discount_for(
  p_promo public.promo_codes, p_subtotal numeric, p_delivery_fee numeric, p_service_fee numeric
) returns numeric
language sql immutable set search_path = public as $$
  with base as (
    select case p_promo.applies_to
      when 'delivery' then coalesce(p_delivery_fee, 0)
      when 'service'  then coalesce(p_service_fee, 0)
      when 'vendor'   then coalesce(p_subtotal, 0)
      when 'platform' then coalesce(p_delivery_fee, 0) + coalesce(p_service_fee, 0)
      else coalesce(p_subtotal, 0) + coalesce(p_delivery_fee, 0) + coalesce(p_service_fee, 0)
    end as amount
  )
  select greatest(0, least(
    base.amount,
    coalesce(p_promo.max_discount_egp, 'infinity'::numeric),
    case when p_promo.discount_type = 'percent'
      then round(base.amount * p_promo.discount_value / 100.0, 2)
      else p_promo.discount_value end
  )) from base
$$;

revoke all on function private.promo_discount_for(public.promo_codes, numeric, numeric, numeric) from public;

create or replace function private.apply_order_promo(
  p_order_id integer, p_code text, p_customer_id integer default null, p_customer_phone text default null
) returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_order orders%rowtype; v_promo promo_codes%rowtype; v_code text;
  v_key text; v_used integer; v_discount numeric; v_gross numeric; v_final_gross numeric;
  v_new_wallet numeric; v_wallet_refund numeric := 0; v_threshold numeric; v_deposit numeric;
  v_service numeric; v_delivery numeric; v_cut_service numeric := 0;
  v_cut_delivery numeric := 0; v_cut_vendor numeric := 0;
begin
  v_code := upper(trim(coalesce(p_code,'')));
  if v_code = '' then return 0; end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' then raise exception 'invalid_promo_code'; end if;
  select * into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  select * into v_promo from promo_codes where code = v_code for update;
  if not found or not v_promo.active then raise exception 'promo_invalid'; end if;
  if (v_promo.starts_at is not null and now() < v_promo.starts_at)
     or (v_promo.ends_at is not null and now() >= v_promo.ends_at) then raise exception 'promo_expired'; end if;
  if v_promo.restaurant_id is not null and v_promo.restaurant_id <> v_order.restaurant_id then raise exception 'promo_not_available'; end if;
  if v_promo.compound_id is not null and v_promo.compound_id <> v_order.compound_id then raise exception 'promo_not_available'; end if;
  if v_order.subtotal < v_promo.minimum_subtotal_egp then raise exception 'promo_minimum_not_met'; end if;
  if v_promo.max_redemptions is not null and (select count(*) from promo_redemptions where promo_code_id = v_promo.id) >= v_promo.max_redemptions then
    raise exception 'promo_limit_reached';
  end if;
  v_key := case when p_customer_id is not null then 'customer:' || p_customer_id::text else 'phone:' || normalize_phone(p_customer_phone) end;
  if v_key is null or right(v_key,1) = ':' then raise exception 'promo_customer_missing'; end if;
  select count(*) into v_used from promo_redemptions where promo_code_id = v_promo.id and customer_key = v_key;
  if v_used >= v_promo.max_redemptions_per_customer then raise exception 'promo_already_used'; end if;

  v_service  := coalesce(v_order.service_fee, 0);
  v_delivery := coalesce(v_order.delivery_fee, 0);
  v_discount := private.promo_discount_for(v_promo, v_order.subtotal, v_delivery, v_service);
  if v_discount <= 0 then raise exception 'promo_nothing_to_discount (promo_invalid)'; end if;

  -- Scoped codes stay inside their own bucket. 'platform' and 'all' both
  -- waterfall service then delivery; only 'all' continues past that into
  -- the vendor's basket.
  if v_promo.applies_to = 'delivery' then
    v_cut_delivery := v_discount;
  elsif v_promo.applies_to = 'service' then
    v_cut_service := v_discount;
  elsif v_promo.applies_to = 'vendor' then
    v_cut_vendor := v_discount;
  elsif v_promo.applies_to = 'platform' then
    v_cut_service  := least(v_discount, v_service);
    v_cut_delivery := v_discount - v_cut_service;
  else
    v_cut_service  := least(v_discount, v_service);
    v_cut_delivery := least(v_discount - v_cut_service, v_delivery);
    v_cut_vendor   := v_discount - v_cut_service - v_cut_delivery;
  end if;

  v_gross := v_order.subtotal + v_delivery + v_service;
  v_final_gross := greatest(0, v_gross - v_discount);
  v_new_wallet := least(coalesce(v_order.wallet_used,0), v_final_gross);
  v_wallet_refund := coalesce(v_order.wallet_used,0) - v_new_wallet;
  if v_wallet_refund > 0 then
    update customer_wallets set balance = balance + v_wallet_refund
      where phone = normalize_phone(v_order.customer_phone);
    insert into wallet_transactions(wallet_id, amount, reason, order_id)
      select id, v_wallet_refund, 'استرجاع رصيد بعد كود خصم', p_order_id
      from customer_wallets where phone = normalize_phone(v_order.customer_phone);
  end if;
  select coalesce((select value::numeric from settings where key = 'cod_deposit_threshold_egp'),3000) into v_threshold;
  v_deposit := case when v_order.payment_method = 'cod' and v_final_gross - v_new_wallet > v_threshold
    then ceil((v_final_gross - v_new_wallet) * .5) else null end;
  update orders set promo_code_id=v_promo.id, promo_discount=v_discount,
    promo_discount_service=v_cut_service, promo_discount_delivery=v_cut_delivery, promo_discount_vendor=v_cut_vendor,
    wallet_used=v_new_wallet,
    total=v_final_gross-v_new_wallet, cod_deposit_amount=v_deposit,
    online_payment_status=case when (payment_method in ('online','instapay') and v_final_gross-v_new_wallet > 0) or v_deposit is not null then 'pending' else null end,
    status=case when status='awaiting_payment' and v_final_gross-v_new_wallet=0 then 'pending' else status end
  where id=p_order_id;
  insert into promo_redemptions(promo_code_id,order_id,customer_key,discount_amount)
    values(v_promo.id,p_order_id,v_key,v_discount);
  return v_discount;
end $$;

revoke all on function private.apply_order_promo(integer,text,integer,text) from public;
