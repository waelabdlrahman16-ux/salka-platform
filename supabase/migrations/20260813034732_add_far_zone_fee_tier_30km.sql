
-- New tier: 20-30km stays 350 (tier5), >30km becomes its own tier6 at 500 EGP
INSERT INTO settings (key, value) VALUES ('fee_tier5_max_km', '30')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO settings (key, value) VALUES ('fee_tier6_egp', '500')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

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
      then coalesce((select value::numeric from settings where key = 'fee_tier3_egp'), 175)
    when p_km <= coalesce((select value::numeric from settings where key = 'fee_tier4_max_km'), 20)
      then coalesce((select value::numeric from settings where key = 'fee_tier4_egp'), 225)
    when p_km <= coalesce((select value::numeric from settings where key = 'fee_tier5_max_km'), 30)
      then coalesce((select value::numeric from settings where key = 'fee_tier5_egp'), 350)
    else coalesce((select value::numeric from settings where key = 'fee_tier6_egp'), 500)
  end;
$$;

-- Recompute fees for every compound using the new tier logic
UPDATE compounds SET delivery_fee = delivery_fee_for_distance(distance_km);
