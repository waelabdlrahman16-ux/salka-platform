
-- Bella Velo: delete per request
DELETE FROM compounds WHERE id = 64;

-- Long Beach: keep active after all
UPDATE compounds SET active = true WHERE id = 61;

-- Tenacon was actually "Tanwak" (Tanoak Hotel) - rename + real coords
UPDATE compounds SET name='تانواك', name_en='Tanoak Hotel', latitude=29.724126417901083, longitude=32.36703555914704, distance_km=33.2, direction='north', delivery_fee=350 WHERE id = 77;

-- New compounds discovered in the same cluster
INSERT INTO compounds (region_id, name, name_en, latitude, longitude, distance_km, direction, delivery_fee, active) VALUES (1, 'عين باي', 'Ein Bay', 29.73108591705594, 32.37700615284546, 33.62, 'north', 350, true);
INSERT INTO compounds (region_id, name, name_en, latitude, longitude, distance_km, direction, delivery_fee, active) VALUES (1, 'مارينا وادي دجلة', NULL, 29.725792028121454, 32.369433045758406, 33.29, 'north', 350, true);

-- Stella Heights: has a live order, so deactivate instead of hard delete
UPDATE compounds SET active = false WHERE id = 57;
