-- Caught by the test before this ever ran for a customer.
--
-- The unique constraint was (restaurant_id, phone, push_token), and a push-only
-- subscriber has phone = NULL. In Postgres, NULLs in a unique constraint are
-- DISTINCT from each other by default, so two identical rows both "satisfy"
-- uniqueness, `on conflict do nothing` never fires, and tapping «فكّرني لما
-- يفتح» twice queues two notifications for the same person.
--
-- NULLS NOT DISTINCT makes NULL compare equal for this purpose, which is what
-- the constraint always meant: one pending reminder per person per vendor,
-- whichever contact channel they gave.
alter table public.vendor_open_reminders
  drop constraint if exists vendor_open_reminders_restaurant_id_phone_push_token_key;

alter table public.vendor_open_reminders
  add constraint vendor_open_reminders_one_per_person
  unique nulls not distinct (restaurant_id, phone, push_token);
