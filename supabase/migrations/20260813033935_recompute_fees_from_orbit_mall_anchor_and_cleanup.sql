
-- Hard delete: no orders/addresses reference these
DELETE FROM compounds WHERE id IN (54, 55);

-- Cannot hard-delete: id 51 has a customer's saved address, id 57 has an order. Deactivate instead.
UPDATE compounds SET active = false WHERE id IN (51, 57);

-- Recompute distance/direction/fee for every remaining compound from the confirmed anchor:
-- Mall Al-Sokhna (Orbit Developments), 29.4426074, 32.4845508
UPDATE compounds AS c SET distance_km = v.distance_km, direction = v.direction, delivery_fee = v.delivery_fee
FROM (VALUES
(3, 26.91, 'south', 350),(7, 33.81, 'north', 350),(8, 11.82, 'south', 175),(10, 20.16, 'south', 350),
(11, 28.78, 'south', 350),(12, 27.91, 'south', 350),(13, 25.4, 'south', 350),(17, 28.44, 'south', 350),
(22, 20.28, 'south', 350),(23, 29.34, 'south', 350),(24, 7.7, 'south', 120),(32, 12.4, 'south', 175),
(43, 1.16, 'south', 65),(44, 4.86, 'north', 65),(45, 6.42, 'north', 120),(46, 7.69, 'north', 120),
(47, 9.9, 'north', 120),(48, 9.01, 'south', 120),(50, 12.45, 'north', 175),(52, 13.81, 'north', 175),
(53, 15.37, 'south', 225),(56, 28.33, 'north', 350),(59, 32.77, 'north', 350),(61, 1.8, 'north', 65),
(62, 28.21, 'south', 350),(63, 1.35, 'north', 65),(65, 3.37, 'north', 65),(66, 4.3, 'north', 65),
(68, 8.36, 'north', 120),(69, 10.33, 'north', 175),(70, 13.07, 'south', 175),(71, 14.09, 'south', 175),
(72, 13.31, 'south', 175),(73, 14.75, 'south', 175),(74, 16.52, 'south', 225),(75, 19.24, 'south', 225),
(76, 18.6, 'south', 225),(77, 33.3, 'north', 350),(78, 21.84, 'south', 350),(80, 26.63, 'south', 350),
(81, 27.46, 'south', 350),(82, 27.19, 'south', 350),(93, 0.76, 'south', 65),(94, 0.97, 'south', 65),
(95, 0.84, 'south', 65),(96, 0.49, 'north', 65),(97, 1.3, 'south', 65),(98, 0.37, 'south', 65),
(99, 0.49, 'north', 65),(100, 1.03, 'south', 65),(101, 0.74, 'south', 65),(102, 0.49, 'north', 65),
(104, 7.16, 'south', 120),(117, 14.17, 'north', 175),(118, 15.76, 'north', 225),(120, 21.82, 'north', 350),
(122, 1.63, 'south', 65),(124, 9.96, 'south', 120),(142, 25.53, 'south', 350),(143, 27.55, 'south', 350),
(144, 26.91, 'south', 350),(145, 22.78, 'south', 350),(146, 22.57, 'south', 350),(147, 21.84, 'south', 350),
(148, 21.5, 'south', 350),(149, 21.27, 'south', 350),(150, 20.73, 'south', 350),(151, 20.28, 'south', 350),
(152, 20.16, 'south', 350),(153, 28.78, 'south', 350),(154, 27.91, 'south', 350),(155, 27.19, 'south', 350),
(156, 32.0, 'south', 350),(157, 14.75, 'south', 175),(158, 17.01, 'south', 225),(164, 25.33, 'south', 350),
(165, 22.04, 'south', 350),(166, 26.71, 'south', 350),(167, 20.78, 'south', 350),(168, 9.01, 'south', 120),
(171, 33.72, 'north', 350),(172, 33.4, 'north', 350)
) AS v(id, distance_km, direction, delivery_fee)
WHERE c.id = v.id;
