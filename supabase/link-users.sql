-- Run AFTER creating each user in Supabase > Authentication > Users > Add user
-- (use "Auto Confirm User" so no email verification is needed)

-- ADMIN (you)
insert into profiles (id, role, name)
select id, 'admin', 'المدير' from auth.users where email = 'admin@talah.app'
on conflict (id) do update set role = 'admin';

-- DRIVERS - email must match the user you created; driver_id must match drivers table
insert into profiles (id, role, driver_id, name)
select id, 'driver', 1, 'أحمد السيد' from auth.users where email = 'driver1@talah.app'
on conflict (id) do update set role = 'driver', driver_id = 1;

insert into profiles (id, role, driver_id, name)
select id, 'driver', 2, 'محمد جمال' from auth.users where email = 'driver2@talah.app'
on conflict (id) do update set role = 'driver', driver_id = 2;

insert into profiles (id, role, driver_id, name)
select id, 'driver', 3, 'محمود عبدالله' from auth.users where email = 'driver3@talah.app'
on conflict (id) do update set role = 'driver', driver_id = 3;

-- Verify
select p.role, p.driver_id, p.name, u.email
from profiles p join auth.users u on u.id = p.id order by p.role, p.driver_id;
