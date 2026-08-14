-- Wael: "i dont need required inputs here except time start and end" -- an
-- image-only, title-less banner should be allowed, and the schedule window
-- should be the one thing that's mandatory (a banner with no window is how
-- one got left switched on with a two-minute schedule nobody noticed had
-- expired). The admin form already tried to send title: null for an
-- image-only banner; the database was the one still rejecting it.

alter table public.banners alter column title drop not null;
alter table public.banners drop constraint banners_title_len;
alter table public.banners add constraint banners_title_len check (title is null or length(btrim(title)) <= 60);

alter table public.banners alter column starts_at set not null;
alter table public.banners alter column ends_at set not null;
