
-- 1. New compounds
INSERT INTO compounds (region_id, name, distance_km, direction, est_travel_minutes, latitude, longitude, delivery_fee, active) VALUES
(1, 'كورونادو مارينا', 50.7, 'north', 82, 29.248694187857556, 32.62277280391906, 350, true),
(1, 'مكسيكو باراديس', 47.2, 'north', 76, 29.275965779068443, 32.60829665992622, 350, true),
(1, 'بلو بلو العين السخنة', 52.5, 'north', 84, 29.23558724643499, 32.624041045890344, 350, true),
(1, 'فندق وفيلات كانكون', 46.1, 'north', 75, 29.285032588357744, 32.60150259080497, 350, true);

-- 2. Corrections to existing compounds
UPDATE compounds SET distance_km=35.9, est_travel_minutes=59, delivery_fee=350,
  latitude=29.363372960392073, longitude=32.574455478469794 WHERE id=32;
UPDATE compounds SET distance_km=52.2, est_travel_minutes=84, delivery_fee=350,
  latitude=29.23750047860512, longitude=32.6260015608672 WHERE id=80;
UPDATE compounds SET distance_km=35.5, est_travel_minutes=59, delivery_fee=350,
  latitude=29.366548557743542, longitude=32.569478320317444 WHERE id=8;
UPDATE compounds SET distance_km=36.8, est_travel_minutes=61, delivery_fee=350,
  latitude=29.356119076708342, longitude=32.579225842297966 WHERE id=72;
UPDATE compounds SET distance_km=43.9, est_travel_minutes=71, delivery_fee=350,
  latitude=29.301382518393197, longitude=32.59904357548548 WHERE id=75;

-- 3. Split merged La Vista Topaz/6
UPDATE compounds SET name='لافيستا طوباز', distance_km=33.1, est_travel_minutes=55, delivery_fee=350,
  latitude=29.384957360704387, longitude=32.56208733748308 WHERE id=124;
INSERT INTO compounds (region_id, name, distance_km, direction, est_travel_minutes, latitude, longitude, delivery_fee, active) VALUES
(1, 'لافيستا 6 (جديد)', 33.4, 'north', 55, 29.38369363489326, 32.54816598720083, 350, true);
