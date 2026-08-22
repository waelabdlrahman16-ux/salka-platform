
ALTER TABLE compounds ADD COLUMN IF NOT EXISTS est_travel_minutes_min integer;
ALTER TABLE compounds ADD COLUMN IF NOT EXISTS est_travel_minutes_max integer;

-- Recompute every compound: 8 min fixed overhead (checkpoint/parking/handoff,
-- every compound here is gated) + travel at ~28 km/h, then a -5/+10 window
-- rounded to the nearest 5 minutes so it widens naturally with distance.
UPDATE compounds SET
  est_travel_minutes_min = GREATEST(5, 5 * round((8 + distance_km/28.0*60 - 5) / 5.0)),
  est_travel_minutes_max = 5 * round((8 + distance_km/28.0*60 + 10) / 5.0)
WHERE distance_km IS NOT NULL;

-- Guard against a degenerate zero-width range on any edge case
UPDATE compounds SET est_travel_minutes_max = est_travel_minutes_min + 5
WHERE est_travel_minutes_max <= est_travel_minutes_min;

-- Keep the legacy single-value column as the midpoint, in case anything
-- server-side still reads it directly instead of the new min/max pair
UPDATE compounds SET est_travel_minutes = round((est_travel_minutes_min + est_travel_minutes_max) / 2.0)
WHERE distance_km IS NOT NULL;
