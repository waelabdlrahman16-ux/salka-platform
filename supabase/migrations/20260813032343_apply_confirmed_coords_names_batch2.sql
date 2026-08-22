
-- Deletions (user marked "امسح") - id 61 excluded, has a live order, deactivated instead below
DELETE FROM compounds WHERE id IN (119, 79, 58, 67, 60, 121);
UPDATE compounds SET active = false WHERE id = 61;

-- Coordinate + name updates from confirmed pins
UPDATE compounds SET latitude=29.519275379085332, longitude=32.39082001268025, distance_km=12.32, direction='north', delivery_fee=175, name = 'واحة الحجاز' WHERE id = 50;
UPDATE compounds SET latitude=29.519275379085332, longitude=32.39082001268025, distance_km=12.32, direction='north', delivery_fee=175 WHERE id = 51;
UPDATE compounds SET latitude=29.519275379085332, longitude=32.39082001268025, distance_km=12.32, direction='north', delivery_fee=175 WHERE id = 54;
UPDATE compounds SET latitude=29.519275379085332, longitude=32.39082001268025, distance_km=12.32, direction='north', delivery_fee=175 WHERE id = 55;
UPDATE compounds SET latitude=29.269057275660366, longitude=32.609526429881456, distance_km=22.9, direction='south', delivery_fee=350 WHERE id = 145;
UPDATE compounds SET latitude=29.249545273305067, longitude=32.62320206374899, distance_km=25.45, direction='south', delivery_fee=350 WHERE id = 164;
UPDATE compounds SET latitude=29.226725519983564, longitude=32.62221672520017, distance_km=27.58, direction='south', delivery_fee=350, name = 'كورونادو بيتش ريزورت' WHERE id = 81;
UPDATE compounds SET latitude=29.341511589027302, longitude=32.5928064468554, distance_km=15.5, direction='south', delivery_fee=225, name = 'لاجونا باي' WHERE id = 53;
UPDATE compounds SET latitude=29.73693181307475, longitude=32.396900254204965, distance_km=33.71, direction='north', delivery_fee=350, name = 'لاسيرينا بالم بيتش' WHERE id = 7;
UPDATE compounds SET latitude=29.276555162865066, longitude=32.60872643524243, distance_km=22.16, direction='south', delivery_fee=350, name = 'امكسيكو باراديس' WHERE id = 165;
UPDATE compounds SET latitude=29.329073977183448, longitude=32.59445062316302, distance_km=16.64, direction='south', delivery_fee=225, name = 'هيفين بيتش' WHERE id = 74;
UPDATE compounds SET latitude=29.720540715234556, longitude=32.37197164426228, distance_km=32.66, direction='north', delivery_fee=350, name = 'أزها' WHERE id = 59;
UPDATE compounds SET latitude=29.281324781155956, longitude=32.602501487808524, distance_km=21.39, direction='south', delivery_fee=350 WHERE id = 149;
UPDATE compounds SET latitude=29.44312693001323, longitude=32.47948298514569, distance_km=0.38, direction='south', delivery_fee=65 WHERE id = 102;
UPDATE compounds SET latitude=29.44312693001323, longitude=32.47948298514569, distance_km=0.38, direction='south', delivery_fee=65 WHERE id = 99;
UPDATE compounds SET latitude=29.44312693001323, longitude=32.47948298514569, distance_km=0.38, direction='south', delivery_fee=65 WHERE id = 96;
UPDATE compounds SET latitude=29.50608816354516, longitude=32.40661485613148, distance_km=10.2, direction='north', delivery_fee=175, name = 'جولدن كوست' WHERE id = 69;
UPDATE compounds SET latitude=29.27170248270435, longitude=32.61010309489796, distance_km=22.69, direction='south', delivery_fee=350, name = 'لا لونا بيتش' WHERE id = 146;
UPDATE compounds SET latitude=29.67191857452072, longitude=32.35688665186238, distance_km=28.22, direction='north', delivery_fee=350, name = 'هوليداي بيتش' WHERE id = 56;
UPDATE compounds SET latitude=29.47468241919516, longitude=32.450487851833635, distance_km=4.73, direction='north', delivery_fee=65, name = 'بيلا فينتو الجلالة' WHERE id = 44;
UPDATE compounds SET latitude=29.285799201038596, longitude=32.60125591134149, distance_km=20.9, direction='south', delivery_fee=350, name = 'كانكون' WHERE id = 167;

-- Group A: Arabic name-only corrections (coordinates already confirmed, unchanged)
UPDATE compounds SET name = 'باي ماونت' WHERE id = 46;
UPDATE compounds SET name = 'فنار دي لونا' WHERE id = 75;
UPDATE compounds SET name = 'قرية فينيسيا' WHERE id = 62;
UPDATE compounds SET name = 'قرية فينيسيا' WHERE id = 78;
UPDATE compounds SET name = 'قرية فينيسيا' WHERE id = 147;
UPDATE compounds SET name = 'لاسيستا' WHERE id = 63;
UPDATE compounds SET name = 'جروف ساوث سبرينغز' WHERE id = 68;
UPDATE compounds SET name = 'بلومار وادي الدوم' WHERE id = 122;
-- Stella Heights: name correction only. Coordinates NOT applied - flagged separately, way out of region.
UPDATE compounds SET name = 'ستيلا هايتس' WHERE id = 57;
