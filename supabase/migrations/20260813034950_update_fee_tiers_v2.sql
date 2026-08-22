
UPDATE settings SET value = '180' WHERE key = 'fee_tier3_egp';
UPDATE settings SET value = '230' WHERE key = 'fee_tier4_egp';
UPDATE settings SET value = '570' WHERE key = 'fee_tier6_egp';

-- Recompute every compound's fee against the updated tier values
UPDATE compounds SET delivery_fee = delivery_fee_for_distance(distance_km);
