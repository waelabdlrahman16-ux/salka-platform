-- Talah Platform - Telal El Sokhna pilot schema
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run

create table zones ( id serial primary key, name text not null );

create table restaurants (
  id serial primary key,
  name text not null,
  description text default '',
  category text default 'مطعم',
  rating numeric(2,1) default 0,
  delivery_time text default '',
  is_open boolean default true
);

create table menu_items (
  id serial primary key,
  restaurant_id int references restaurants(id) on delete cascade,
  name text not null,
  description text default '',
  category text default '',
  price numeric(10,2) not null,
  available boolean default true
);

create table orders (
  id serial primary key,
  restaurant_id int references restaurants(id),
  customer_name text not null,
  customer_phone text not null,
  zone text not null,
  unit_number text not null,
  address_notes text default '',
  status text default 'pending',
  subtotal numeric(10,2) not null,
  delivery_fee numeric(10,2) not null default 50,
  total numeric(10,2) not null,
  payment_method text default 'cash_on_delivery',
  created_at timestamptz default now()
);

create table order_items (
  id serial primary key,
  order_id int references orders(id) on delete cascade,
  menu_item_id int references menu_items(id),
  name text not null,
  qty int not null,
  unit_price numeric(10,2) not null,
  total numeric(10,2) not null
);

create table chalets (
  id serial primary key,
  name text not null,
  description text default '',
  property_type text default 'شاليه',
  price_per_night numeric(10,2) not null,
  bedrooms int default 1,
  guests int default 2,
  available boolean default true
);

create table bookings (
  id serial primary key,
  chalet_id int references chalets(id),
  customer_name text not null,
  customer_phone text not null,
  check_in date not null,
  check_out date not null,
  guests int default 2,
  total numeric(10,2) not null,
  status text default 'pending',
  created_at timestamptz default now()
);

create table drivers (
  id serial primary key,
  name text not null,
  phone text not null,
  status text default 'Available',
  available boolean default true,
  active boolean default true,
  vehicle_type text default 'دراجة نارية',
  vehicle_plate text default '',
  rating numeric(2,1) default 5.0,
  total_deliveries int default 0,
  commission_value numeric(10,2) default 40
);

-- Architecture rule: driver NEVER goes on orders.
-- Order -> delivery_assignment -> driver. Every rejection = new row, attempt_number + 1.
create table delivery_assignments (
  id serial primary key,
  order_id int references orders(id) on delete cascade,
  driver_id int references drivers(id),
  attempt_number int not null default 1,
  status text default 'Offered',
  offered_at timestamptz default now(),
  responded_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  rejection_reason text default ''
);

create table driver_earnings (
  id serial primary key,
  driver_id int references drivers(id),
  order_id int references orders(id),
  assignment_id int references delivery_assignments(id),
  delivery_fee numeric(10,2) not null default 50,
  driver_earning numeric(10,2) not null default 40,
  admin_amount numeric(10,2) not null default 10,
  created_at timestamptz default now()
);

alter table zones enable row level security;
alter table restaurants enable row level security;
alter table menu_items enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table chalets enable row level security;
alter table bookings enable row level security;
alter table drivers enable row level security;
alter table delivery_assignments enable row level security;
alter table driver_earnings enable row level security;

create policy "pilot open" on zones for all using (true) with check (true);
create policy "pilot open" on restaurants for all using (true) with check (true);
create policy "pilot open" on menu_items for all using (true) with check (true);
create policy "pilot open" on orders for all using (true) with check (true);
create policy "pilot open" on order_items for all using (true) with check (true);
create policy "pilot open" on chalets for all using (true) with check (true);
create policy "pilot open" on bookings for all using (true) with check (true);
create policy "pilot open" on drivers for all using (true) with check (true);
create policy "pilot open" on delivery_assignments for all using (true) with check (true);
create policy "pilot open" on driver_earnings for all using (true) with check (true);

insert into zones (name) values
  ('المجاورة الأولى'), ('المجاورة الثانية'), ('المجاورة الثالثة'),
  ('منطقة حمام السباحة'), ('الصف الأول - البحر'), ('منطقة البوابة الرئيسية');

insert into restaurants (name, description, category, rating, delivery_time, is_open) values
  ('مطعم أبو ربيع للأسماك', 'أشهر مطعم أسماك في السخنة، طازج يومياً من البحر', 'أسماك', 4.7, '30-45 دقيقة', true),
  ('بورتوفينو إيطاليانو', 'بيتزا ومعكرونة إيطالية أصلية مع إطلالة بحرية', 'إيطالي', 4.3, '25-40 دقيقة', true),
  ('مشاوي وكباب الحسيني', 'مشاوي شرقية وكباب وطواجن', 'مشاوي', 4.5, '35-50 دقيقة', true),
  ('ستاربكس السخنة', 'قهوة ومشروبات وحلويات', 'مقهى', 4.1, '15-25 دقيقة', true),
  ('فطاطري السلطان', 'فطار شرقي وفول وطعمية وبيض', 'فطار', 4.4, '20-30 دقيقة', true);

insert into menu_items (restaurant_id, name, description, category, price) values
  (1, 'شوربة سي فود', 'شوربة كريمية بالمأكولات البحرية', 'شوربات', 65),
  (1, 'طاجن سي فود', 'طاجن أسماك واستاكوزا وجمبري', 'طواجن', 350),
  (1, 'سمك دنيس مشوي', 'سمك دنيس طازج مشوي على الفحم', 'مشويات', 280),
  (1, 'جمبري مقلي', 'جمبري كبير مقلي مع صلصة الثوم', 'مقليات', 220),
  (2, 'بيتزا مارجريتا', 'موتزاريلا وصلصة طماطم إيطالية', 'بيتزا', 180),
  (2, 'باستا فروتي دي ماري', 'معكرونة بثمار البحر', 'باستا', 240),
  (3, 'وجبة كباب وكفتة', 'كيلو مشكل مع أرز وسلطات', 'مشويات', 450),
  (3, 'طاجن لحمة بالبصل', 'لحم بتلو بلدي', 'طواجن', 210),
  (4, 'آيس لاتيه', 'قهوة مثلجة', 'مشروبات باردة', 95),
  (5, 'فول وطعمية', 'فطار شرقي كامل', 'فطار', 60);

insert into chalets (name, description, property_type, price_per_night, bedrooms, guests) values
  ('شاليه تلال Sea View', 'غرفتين + فيو بحر مباشر', 'شاليه', 3500, 2, 6),
  ('فيلا تلال الصف الأول', '3 غرف + حديقة خاصة', 'فيلا', 7000, 3, 8);

insert into drivers (name, phone, vehicle_plate, rating, total_deliveries) values
  ('أحمد السيد', '+201001234567', 'أ س ر 1234', 4.8, 327),
  ('محمد جمال', '+201009876543', 'ب ص د 5678', 4.6, 215),
  ('محمود عبدالله', '+201115551234', 'د ف ج 3456', 4.5, 89);
