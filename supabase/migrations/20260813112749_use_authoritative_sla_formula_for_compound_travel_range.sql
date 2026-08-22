
-- Redo using the EXACT same formula checkout already trusts (sla_travel_base_minutes
-- + sla_travel_per_km * distance, then sla_max_minutes()'s percentage widening) instead
-- of the ad-hoc 8min+28kmh guess from the first pass. Keeps the browse-time estimate
-- on Home/RestaurantDetail consistent with what place_order actually promises.
UPDATE compounds SET
  est_travel_minutes = travel_minutes_for_distance(distance_km),
  est_travel_minutes_min = travel_minutes_for_distance(distance_km),
  est_travel_minutes_max = sla_max_minutes(travel_minutes_for_distance(distance_km))
WHERE distance_km IS NOT NULL;
