-- Banners went title-optional in 20260814144254; feed_ads (the ad rail
-- between restaurant cards) is the same admin workflow on the same shape
-- and was never updated to match, so an image-only ad with no headline
-- was rejected by the NOT NULL constraint with the save button just
-- staying disabled and no explanation on screen.
alter table public.feed_ads alter column title drop not null;
