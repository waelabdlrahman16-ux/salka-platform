-- Ad blocks placed between restaurant cards on Home, distinct from the top
-- banner rail so an admin can run a different rotation in each slot.
create table public.feed_ads (
  id bigint generated always as identity primary key,
  title text not null,
  subtitle text,
  image_url text,
  bg_color text not null default '#0A5F5E',
  link_url text,
  active boolean not null default true,
  sort integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  constraint feed_ads_title_len check (length(btrim(title)) between 1 and 60),
  constraint feed_ads_sub_len check (subtitle is null or length(subtitle) <= 90),
  constraint feed_ads_color_hex check (bg_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint feed_ads_link_shape check (
    link_url is null
    or link_url ~ '^/(?!/)[A-Za-z0-9/_?=&%.:-]*$'
    or link_url ~ '^https?://[^\s/]'
  ),
  constraint feed_ads_window check (ends_at is null or starts_at is null or ends_at > starts_at)
);

alter table public.feed_ads enable row level security;

-- Split from the start: the public check never references is_admin(), so
-- anon evaluates it cleanly. (See migration 20260814123220 -- banners had
-- exactly this bug for a week because its read policy OR'd is_admin() into
-- the same clause anon has to evaluate, and anon never had execute on it.)
create policy feed_ads_read_public on public.feed_ads
  for select to anon, authenticated
  using (
    active
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   > now())
  );
create policy feed_ads_read_admin on public.feed_ads
  for select to authenticated using (is_admin());
create policy feed_ads_admin_insert on public.feed_ads
  for insert to authenticated with check (is_admin());
create policy feed_ads_admin_update on public.feed_ads
  for update to authenticated using (is_admin()) with check (is_admin());
create policy feed_ads_admin_delete on public.feed_ads
  for delete to authenticated using (is_admin());

-- Individual menu items an admin promotes into their own strip between
-- restaurant cards on Home, independent of any one vendor's own menu order.
create table public.featured_products (
  id bigint generated always as identity primary key,
  menu_item_id integer not null references public.menu_items(id) on delete cascade,
  active boolean not null default true,
  sort integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  constraint featured_products_window check (ends_at is null or starts_at is null or ends_at > starts_at),
  unique (menu_item_id)
);

alter table public.featured_products enable row level security;

create policy featured_products_read_public on public.featured_products
  for select to anon, authenticated
  using (
    active
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   > now())
  );
create policy featured_products_read_admin on public.featured_products
  for select to authenticated using (is_admin());
create policy featured_products_admin_insert on public.featured_products
  for insert to authenticated with check (is_admin());
create policy featured_products_admin_update on public.featured_products
  for update to authenticated using (is_admin()) with check (is_admin());
create policy featured_products_admin_delete on public.featured_products
  for delete to authenticated using (is_admin());

create index featured_products_menu_item_idx on public.featured_products(menu_item_id);
