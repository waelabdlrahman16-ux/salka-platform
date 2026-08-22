alter table public.driver_settlements  add column if not exists actor uuid;
alter table public.wallet_transactions add column if not exists actor uuid;
alter table public.orders
  add column if not exists refunded_by uuid,
  add column if not exists refunded_at timestamptz;

comment on column public.driver_settlements.actor is
  'auth.users.id of the admin who performed the settlement. Null for rows written before 2026-08-18. No FK on purpose: deleting the staff account must not erase the trail.';
comment on column public.wallet_transactions.actor is
  'auth.users.id of the admin who issued the credit. Null for rows written before 2026-08-18.';
comment on column public.orders.refunded_by is
  'auth.users.id of the admin who marked the refund paid. Null for the 2 orders refunded before 2026-08-18.';
