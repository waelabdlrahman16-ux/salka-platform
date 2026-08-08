-- Index the referencing side of every app_events foreign key. PostgreSQL does
-- not create these automatically; without them, parent deletes and joins scan
-- the event table as it grows.
create index if not exists app_events_customer_id_idx
  on public.app_events (customer_id);

create index if not exists app_events_compound_id_idx
  on public.app_events (compound_id);

create index if not exists app_events_restaurant_id_idx
  on public.app_events (restaurant_id);

create index if not exists app_events_order_id_idx
  on public.app_events (order_id);

-- This is a retained 76-row menu backup, not an operational table. Its copied
-- menu IDs are complete and unique in production, so preserve their identity as
-- the key rather than inventing a second column merely to silence the advisor.
do $backup_key_preflight$
begin
  if exists (select 1 from public._mcd_menu_backup_20260806 where id is null) then
    raise exception 'backup contains null IDs; primary key not applied';
  end if;
  if exists (
    select id from public._mcd_menu_backup_20260806
     group by id having count(*) > 1
  ) then
    raise exception 'backup contains duplicate IDs; primary key not applied';
  end if;
end
$backup_key_preflight$;

alter table public._mcd_menu_backup_20260806
  alter column id set not null;

alter table public._mcd_menu_backup_20260806
  add constraint _mcd_menu_backup_20260806_pkey primary key (id);

do $verification$
declare
  v_index text;
begin
  foreach v_index in array array[
    'app_events_customer_id_idx',
    'app_events_compound_id_idx',
    'app_events_restaurant_id_idx',
    'app_events_order_id_idx'
  ] loop
    if to_regclass('public.' || v_index) is null then
      raise exception 'required index missing: %', v_index;
    end if;
  end loop;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public._mcd_menu_backup_20260806'::regclass
       and contype = 'p'
       and conname = '_mcd_menu_backup_20260806_pkey'
  ) then
    raise exception 'backup primary key missing';
  end if;
end
$verification$;
