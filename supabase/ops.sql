-- ============================================================
-- Talah Platform - Operations increment
-- Vendor role + driver pool (first accept wins) + admin menu manager
-- Run ONCE in Supabase SQL Editor, after auth.sql
-- ============================================================

-- 1. Kitchen status is separate from delivery status
alter table orders add column if not exists kitchen_status text default 'new';
-- new -> preparing -> ready

-- 2. Vendor role
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin','driver','vendor'));
alter table profiles add column if not exists restaurant_id int references restaurants(id);

create or replace function my_restaurant_id() returns int
  language sql security definer stable as $$
  select restaurant_id from profiles where id = auth.uid();
$$;

-- 3. Vendor sees and updates only its own restaurant's orders
drop policy if exists "vendor reads orders" on orders;
create policy "vendor reads orders" on orders for select
  using (restaurant_id = my_restaurant_id());

drop policy if exists "vendor updates orders" on orders;
create policy "vendor updates orders" on orders for update
  using (restaurant_id = my_restaurant_id());

drop policy if exists "vendor reads order items" on order_items;
create policy "vendor reads order items" on order_items for select
  using (exists (select 1 from orders o
    where o.id = order_items.order_id and o.restaurant_id = my_restaurant_id()));

-- 4. Admin manages the menu from inside the app
drop policy if exists "admin writes menu" on menu_items;
create policy "admin writes menu" on menu_items for all
  using (is_admin()) with check (is_admin());

drop policy if exists "admin writes restaurants" on restaurants;
create policy "admin writes restaurants" on restaurants for all
  using (is_admin()) with check (is_admin());

-- 5. DRIVER POOL - unclaimed orders, visible to any available driver
create or replace function available_orders()
returns json language sql security definer stable as $$
  select case when my_driver_id() is null then '[]'::json
    else coalesce((select json_agg(row_to_json(x)) from (
      select o.id, o.total, o.zone, o.kitchen_status, o.created_at,
             r.name as restaurant_name
      from orders o join restaurants r on r.id = o.restaurant_id
      where o.status = 'pending'
        and not exists (select 1 from delivery_assignments da
          where da.order_id = o.id
            and da.status in ('Offered','Accepted','Picked_Up','Out_for_Delivery','Delivered'))
      order by o.created_at
    ) x), '[]'::json) end;
$$;

-- 6. CLAIM - first driver to tap wins; the loser gets a clear error
create or replace function claim_order(p_order_id int)
returns json language plpgsql security definer as $$
declare v_driver int; v_attempt int; v_id int;
begin
  v_driver := my_driver_id();
  if v_driver is null then raise exception 'not_a_driver'; end if;

  perform 1 from orders where id = p_order_id for update;

  if exists (select 1 from delivery_assignments
             where order_id = p_order_id
               and status in ('Offered','Accepted','Picked_Up','Out_for_Delivery','Delivered')) then
    raise exception 'already_taken';
  end if;

  select coalesce(max(attempt_number),0) + 1 into v_attempt
    from delivery_assignments where order_id = p_order_id;

  insert into delivery_assignments (order_id, driver_id, attempt_number, status,
                                    offered_at, responded_at)
  values (p_order_id, v_driver, v_attempt, 'Accepted', now(), now())
  returning id into v_id;

  update orders set status = 'Accepted' where id = p_order_id;
  update drivers set status = 'On_Delivery', available = false where id = v_driver;

  return json_build_object('assignment_id', v_id);
end; $$;

grant execute on function available_orders() to authenticated;
grant execute on function claim_order(int) to authenticated;

-- 7. Example vendor login (optional - edit email and restaurant id, then run)
-- insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
--   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
--   confirmation_token, recovery_token, email_change_token_new, email_change)
-- select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
--   'authenticated', 'vendor1@talah.app',
--   extensions.crypt('Talah#Vendor1', extensions.gen_salt('bf')),
--   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
--   '', '', '', ''
-- where not exists (select 1 from auth.users where email = 'vendor1@talah.app');
--
-- insert into auth.identities (id, user_id, identity_data, provider, provider_id,
--   last_sign_in_at, created_at, updated_at)
-- select gen_random_uuid(), u.id, jsonb_build_object('sub', u.id::text, 'email', u.email),
--   'email', u.id::text, now(), now(), now()
-- from auth.users u where u.email = 'vendor1@talah.app'
--   and not exists (select 1 from auth.identities i where i.user_id = u.id);
--
-- insert into profiles (id, role, restaurant_id, name)
-- select u.id, 'vendor', 1, 'مطعم أبو ربيع' from auth.users u
-- where u.email = 'vendor1@talah.app'
-- on conflict (id) do update set role = 'vendor', restaurant_id = 1;
