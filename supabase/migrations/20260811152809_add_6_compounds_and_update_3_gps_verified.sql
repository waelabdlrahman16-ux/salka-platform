-- Reconciled from production migration history. Already applied in project pqpnwxyevrsipklzmwex.
-- Do not apply this file to production again.

insert into compounds (region_id, name, distance_km, direction, est_travel_minutes, active, latitude, longitude, delivery_fee) values
(1, 'دولفين بيتش ريزورت', 8, 'north', 17, true, 29.589241, 32.334900, 120),
(1, 'لولي بيتش', 8, 'north', 17, true, 29.585667, 32.343254, 120),
(1, 'العين ريزورت 2', 9, 'north', 18, true, 29.583443, 32.347408, 120),
(1, 'مورانو', 13, 'north', 24, true, 29.547115, 32.365192, 175),
(1, 'هيدن هيلز', 14, 'north', 26, true, 29.535000, 32.371000, 175),
(1, 'بلومار الدوم / مارينا وادي الدوم', 23, 'north', 40, true, 29.471500, 32.449100, 350);

update compounds set latitude=29.540373, longitude=32.368141, distance_km=14, est_travel_minutes=26, delivery_fee=175
where id=52;

update compounds set latitude=29.529016, longitude=32.376766, distance_km=15, est_travel_minutes=28, delivery_fee=175
where id=22;

update compounds set latitude=29.524416, longitude=32.380119, distance_km=16, est_travel_minutes=29, delivery_fee=225
where id=57;
