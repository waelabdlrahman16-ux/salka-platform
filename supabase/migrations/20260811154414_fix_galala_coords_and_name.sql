-- Reconciled from production migration history. Already applied in project pqpnwxyevrsipklzmwex.
-- Do not apply this file to production again.

update compounds set name='مدينة ومنتجع الجلالة', latitude=29.418000, longitude=32.492000, distance_km=30, est_travel_minutes=50, delivery_fee=350
where id=104;
