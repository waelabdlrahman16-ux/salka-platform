
UPDATE settings SET value = '390' WHERE key = 'fee_tier6_egp';
UPDATE settings SET value = '390' WHERE key = 'fee_tier6_max_egp';

CREATE OR REPLACE FUNCTION delivery_fee_for_distance(p_km numeric)
RETURNS numeric
LANGUAGE sql
AS $$
  select case
    when p_km is null then null
    when p_km <= coalesce((select value::numeric from settings where key = 'fee_tier1_max_km'), 5)
      then coalesce((select value::numeric from settings where key = 'fee_tier1_egp'), 65)
    when p_km <= coalesce((select value::numeric from settings where key = 'fee_tier2_max_km'), 10)
      then coalesce((select value::numeric from settings where key = 'fee_tier2_egp'), 120)
    when p_km <= coalesce((select value::numeric from settings where key = 'fee_tier3_max_km'), 15)
      then coalesce((select value::numeric from settings where key = 'fee_tier3_egp'), 180)
    when p_km <= coalesce((select value::numeric from settings where key = 'fee_tier4_max_km'), 20)
      then coalesce((select value::numeric from settings where key = 'fee_tier4_egp'), 230)
    when p_km <= coalesce((select value::numeric from settings where key = 'fee_tier5_max_km'), 30)
      then coalesce((select value::numeric from settings where key = 'fee_tier5_egp'), 350)
    when p_km <= coalesce((select value::numeric from settings where key = 'fee_tier6_max_km'), 35)
      then coalesce((select value::numeric from settings where key = 'fee_tier6_egp'), 390)
    else coalesce((select value::numeric from settings where key = 'fee_tier7_egp'), 570)
  end;
$$;

UPDATE compounds SET delivery_fee = delivery_fee_for_distance(distance_km);
