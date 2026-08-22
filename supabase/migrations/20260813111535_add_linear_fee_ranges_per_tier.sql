
-- Explicit min/max km and min/max EGP per tier, so the fee slides smoothly
-- across each tier instead of jumping at the boundary. tier7 is flat beyond
-- its max_km (45) since there's no further tier to ramp toward.
INSERT INTO settings (key, value) VALUES
  ('fee_tier1_min_km','0'),  ('fee_tier1_max_km','5'),  ('fee_tier1_min_egp','65'),  ('fee_tier1_max_egp','70'),
  ('fee_tier2_min_km','5'),  ('fee_tier2_max_km','10'), ('fee_tier2_min_egp','70'),  ('fee_tier2_max_egp','120'),
  ('fee_tier3_min_km','10'), ('fee_tier3_max_km','15'), ('fee_tier3_min_egp','120'), ('fee_tier3_max_egp','180'),
  ('fee_tier4_min_km','15'), ('fee_tier4_max_km','20'), ('fee_tier4_min_egp','180'), ('fee_tier4_max_egp','230'),
  ('fee_tier5_min_km','20'), ('fee_tier5_max_km','30'), ('fee_tier5_min_egp','230'), ('fee_tier5_max_egp','350'),
  ('fee_tier6_min_km','30'), ('fee_tier6_max_km','35'), ('fee_tier6_min_egp','350'), ('fee_tier6_max_egp','420'),
  ('fee_tier7_min_km','35'), ('fee_tier7_max_km','45'), ('fee_tier7_min_egp','420'), ('fee_tier7_max_egp','570')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE OR REPLACE FUNCTION delivery_fee_for_distance(p_km numeric)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  i int; v_min_km numeric; v_max_km numeric; v_min_egp numeric; v_max_egp numeric; fee numeric;
BEGIN
  IF p_km IS NULL THEN RETURN NULL; END IF;
  FOR i IN 1..7 LOOP
    SELECT value::numeric INTO v_min_km FROM settings WHERE key = 'fee_tier'||i||'_min_km';
    SELECT value::numeric INTO v_max_km FROM settings WHERE key = 'fee_tier'||i||'_max_km';
    SELECT value::numeric INTO v_min_egp FROM settings WHERE key = 'fee_tier'||i||'_min_egp';
    SELECT value::numeric INTO v_max_egp FROM settings WHERE key = 'fee_tier'||i||'_max_egp';
    IF p_km <= v_max_km OR i = 7 THEN
      IF i = 7 AND p_km > v_max_km THEN
        RETURN v_max_egp;
      END IF;
      fee := v_min_egp + (p_km - v_min_km) / NULLIF(v_max_km - v_min_km, 0) * (v_max_egp - v_min_egp);
      RETURN round(fee);
    END IF;
  END LOOP;
  RETURN v_max_egp;
END;
$$;

-- Recompute every compound's fee against the new sliding-scale tiers
UPDATE compounds SET delivery_fee = delivery_fee_for_distance(distance_km);
