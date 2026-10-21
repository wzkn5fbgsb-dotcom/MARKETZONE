-- =====================================================================
-- MARKETZONE · 0100 · Esquema principal
-- Tablas, índices, restricciones y disparadores básicos.
-- Toda escritura crítica (inventario, pedidos, ofertas, pagos) se hace
-- mediante funciones SECURITY DEFINER definidas en migraciones posteriores.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configuración de la plataforma (fila única)
-- ---------------------------------------------------------------------
create table public.platform_settings (
  id                      smallint primary key default 1 check (id = 1),
  commission_bps          integer not null default 1000 check (commission_bps between 0 and 5000),   -- 1000 = 10 %
  shipping_flat_cents     integer not null default 799  check (shipping_flat_cents between 0 and 100000),
  checkout_hold_minutes   integer not null default 15   check (checkout_hold_minutes between 1 and 1440),
  offer_response_minutes  integer not null default 2880 check (offer_response_minutes between 5 and 20160),
  offer_payment_minutes   integer not null default 1440 check (offer_payment_minutes between 1 and 10080),
  min_offer_percent       integer not null default 50   check (min_offer_percent between 1 and 99),
  min_campaign_cents      integer not null default 500  check (min_campaign_cents between 100 and 10000000),
  test_mode               boolean not null default true,  -- pagos de prueba (sin dinero real)
  last_expiry_run         timestamptz,
  updated_at              timestamptz not null default now(),
  updated_by              uuid
);
insert into public.platform_settings (id) values (1);

-- ---------------------------------------------------------------------
-- Usuarios y perfiles
-- ---------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null check (username ~ '^[a-z0-9_.]{3,30}$'),
  display_name  text not null check (char_length(display_name) between 1 and 60),
  avatar_url    text check (avatar_url is null or char_length(avatar_url) <= 1000),
  bio           text check (bio is null or char_length(bio) <= 500),
  role          text not null default 'user' check (role in ('user', 'admin')),
  status        text not null default 'active' check (status in ('active', 'suspended')),
  preferences   jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index profiles_username_key on public.profiles (lower(username));

create table public.addresses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  full_name    text not null check (char_length(full_name) between 2 and 80),
  line1        text not null check (char_length(line1) between 3 and 120),
  line2        text check (line2 is null or char_length(line2) <= 120),
  city         text not null check (char_length(city) between 2 and 80),
  region       text not null check (char_length(region) between 2 and 80),
  postal_code  text not null check (char_length(postal_code) between 3 and 12),
  country      text not null default 'US' check (country ~ '^[A-Z]{2}$'),
  phone        text check (phone is null or char_length(phone) <= 30),
  is_default   boolean not null default false,
  created_at   timestamptz not null default now()
);
create index addresses_user_idx on public.addresses (user_id);

-- ---------------------------------------------------------------------
-- Tiendas y negocios
-- ---------------------------------------------------------------------
create table public.stores (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.profiles(id) on delete cascade,
  slug           text not null check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  name           text not null check (char_length(name) between 2 and 60),
  logo_url       text,
  cover_url      text,
  bio            text check (bio is null or char_length(bio) <= 1000),
  accent         text not null default 'crimson' check (accent in ('crimson', 'ember', 'steel', 'ivory')),
  categories     text[] not null default '{}',
  social_links   jsonb not null default '{}'::jsonb,
  business_info  jsonb not null default '{}'::jsonb,
  status         text not null default 'active' check (status in ('active', 'suspended')),
  is_demo        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index stores_slug_key on public.stores (lower(slug));
create index stores_owner_idx on public.stores (owner_id);

create table public.follows (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  store_id    uuid not null references public.stores(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, store_id)
);
create index follows_store_idx on public.follows (store_id);

create table public.businesses (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.profiles(id) on delete cascade,
  store_id       uuid references public.stores(id) on delete set null,
  slug           text not null check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  name           text not null check (char_length(name) between 2 and 80),
  logo_url       text,
  cover_url      text,
  description    text not null default '' check (char_length(description) <= 2000),
  category       text not null check (category in ('moda', 'sneakers', 'belleza', 'accesorios', 'reventa', 'servicios', 'otro')),
  location       text check (location is null or char_length(location) <= 120),
  contact        jsonb not null default '{}'::jsonb,
  hours          jsonb not null default '{}'::jsonb,
  social_links   jsonb not null default '{}'::jsonb,
  customer_info  text check (customer_info is null or char_length(customer_info) <= 2000),
  status         text not null default 'active' check (status in ('active', 'suspended')),
  is_demo        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index businesses_slug_key on public.businesses (lower(slug));
create index businesses_owner_idx on public.businesses (owner_id);

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
create table public.categories (
  id               text primary key check (id ~ '^[a-z0-9-]+$'),
  parent_id        text references public.categories(id),
  name             text not null,
  sort             integer not null default 0,
  size_system      text not null default 'none' check (size_system in ('apparel', 'shoes', 'numeric', 'one_size', 'none')),
  required_fields  text[] not null default '{}',
  is_active        boolean not null default true
);

create table public.products (
  id                uuid primary key default gen_random_uuid(),
  seller_id         uuid not null references public.profiles(id) on delete cascade,
  store_id          uuid not null references public.stores(id) on delete cascade,
  category_id       text not null references public.categories(id),
  title             text not null check (char_length(title) between 3 and 120),
  description       text not null default '' check (char_length(description) <= 5000),
  brand             text check (brand is null or char_length(brand) <= 60),
  condition         text not null check (condition in ('new_with_tags', 'new_without_tags', 'used_excellent', 'used_good', 'used_flawed')),
  flaws             text check (flaws is null or char_length(flaws) <= 1000),
  color             text check (color is null or char_length(color) <= 40),
  material          text check (material is null or char_length(material) <= 80),
  fit               text check (fit is null or char_length(fit) <= 40),
  price_cents       integer not null check (price_cents between 100 and 10000000),
  compare_at_cents  integer check (compare_at_cents is null or compare_at_cents > price_cents),  -- gestionado por el sistema
  tags              text[] not null default '{}' check (coalesce(array_length(tags, 1), 0) <= 15),
  attributes        jsonb not null default '{}'::jsonb,
  weight_grams      integer check (weight_grams is null or weight_grams between 1 and 100000),
  length_cm         numeric(6,1) check (length_cm is null or length_cm > 0),
  width_cm          numeric(6,1) check (width_cm is null or width_cm > 0),
  height_cm         numeric(6,1) check (height_cm is null or height_cm > 0),
  offers_enabled    boolean not null default true,
  status            text not null default 'draft' check (status in ('draft', 'active', 'paused', 'removed')),
  moderation_status text not null default 'ok' check (moderation_status in ('ok', 'blocked')),
  moderation_note   text,
  ai_assisted       boolean not null default false,
  is_demo           boolean not null default false,
  search_text       text not null default '',
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint flawed_requires_description check (condition <> 'used_flawed' or char_length(coalesce(flaws, '')) >= 5)
);
create index products_seller_idx on public.products (seller_id, status);
create index products_store_idx on public.products (store_id, status);
create index products_feed_idx on public.products (status, published_at desc);
create index products_category_idx on public.products (category_id, status);

create table public.product_price_history (
  id           bigint generated always as identity primary key,
  product_id   uuid not null references public.products(id) on delete cascade,
  old_cents    integer not null,
  new_cents    integer not null,
  changed_by   uuid,
  created_at   timestamptz not null default now()
);

create table public.product_images (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  url           text not null check (char_length(url) <= 2000),
  storage_path  text,
  position      smallint not null default 0,
  created_at    timestamptz not null default now()
);
create index product_images_product_idx on public.product_images (product_id, position);

create table public.product_variants (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.products(id) on delete cascade,
  size            text check (size is null or char_length(size) between 1 and 20),
  color           text check (color is null or char_length(color) between 1 and 40),
  sku             text check (sku is null or char_length(sku) <= 60),
  price_cents     integer check (price_cents is null or price_cents between 100 and 10000000),
  stock_on_hand   integer not null default 0 check (stock_on_hand between 0 and 100000),
  stock_reserved  integer not null default 0 check (stock_reserved >= 0),
  is_active       boolean not null default true,
  position        smallint not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint reserved_within_stock check (stock_reserved <= stock_on_hand)
);
create unique index product_variants_combo_key
  on public.product_variants (product_id, lower(coalesce(size, '')), lower(coalesce(color, '')));

create table public.favorites (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index favorites_product_idx on public.favorites (product_id);

-- ---------------------------------------------------------------------
-- Carrito, pedidos, reservas e inventario
-- ---------------------------------------------------------------------
create table public.cart_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  variant_id  uuid not null references public.product_variants(id) on delete cascade,
  quantity    integer not null check (quantity between 1 and 99),
  created_at  timestamptz not null default now(),
  unique (user_id, variant_id)
);

create table public.offers (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references public.products(id) on delete cascade,
  variant_id        uuid not null references public.product_variants(id) on delete cascade,
  buyer_id          uuid not null references public.profiles(id) on delete cascade,
  seller_id         uuid not null references public.profiles(id) on delete cascade,
  quantity          integer not null default 1 check (quantity between 1 and 10),
  list_price_cents  integer not null,
  offer_cents       integer not null check (offer_cents > 0),     -- primera oferta del comprador
  amount_cents      integer not null check (amount_cents > 0),    -- importe vigente (oferta o contraoferta)
  status            text not null check (status in ('pending', 'countered', 'accepted', 'declined', 'expired', 'cancelled', 'completed')),
  awaiting          text not null check (awaiting in ('seller', 'buyer', 'none')),
  expires_at        timestamptz not null,
  order_id          uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint offer_parties_differ check (buyer_id <> seller_id)
);
create unique index offers_one_open_per_variant
  on public.offers (buyer_id, variant_id) where status in ('pending', 'countered');
create index offers_seller_idx on public.offers (seller_id, status);
create index offers_buyer_idx on public.offers (buyer_id, status);
create index offers_expiry_idx on public.offers (expires_at) where status in ('pending', 'countered');

create table public.offer_events (
  id            bigint generated always as identity primary key,
  offer_id      uuid not null references public.offers(id) on delete cascade,
  actor_id      uuid,
  actor_role    text not null check (actor_role in ('buyer', 'seller', 'system')),
  kind          text not null check (kind in ('offer', 'counter', 'accept', 'decline', 'cancel', 'expire', 'complete', 'conflict')),
  amount_cents  integer,
  note          text,
  created_at    timestamptz not null default now()
);
create index offer_events_offer_idx on public.offer_events (offer_id, id);

create table public.orders (
  id                uuid primary key default gen_random_uuid(),
  number            bigint generated always as identity (start with 100001) unique,
  buyer_id          uuid not null references public.profiles(id),
  source            text not null default 'cart' check (source in ('cart', 'offer')),
  offer_id          uuid references public.offers(id),
  status            text not null default 'pending_payment'
                    check (status in ('pending_payment', 'paid', 'cancelled', 'expired', 'refunded', 'partially_refunded')),
  is_test           boolean not null,
  currency          text not null default 'USD',
  subtotal_cents    integer not null check (subtotal_cents >= 0),
  shipping_cents    integer not null default 0 check (shipping_cents >= 0),
  tax_cents         integer not null default 0 check (tax_cents >= 0),
  total_cents       integer not null check (total_cents >= 0),
  shipping_address  jsonb not null,
  payment_due_at    timestamptz not null,
  paid_at           timestamptz,
  cancelled_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint order_total_matches check (total_cents = subtotal_cents + shipping_cents + tax_cents)
);
create index orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index orders_pending_idx on public.orders (payment_due_at) where status = 'pending_payment';
alter table public.offers add constraint offers_order_fk foreign key (order_id) references public.orders(id);

create table public.seller_orders (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders(id) on delete cascade,
  seller_id         uuid not null references public.profiles(id),
  store_id          uuid references public.stores(id) on delete set null,
  status            text not null default 'pending_payment'
                    check (status in ('pending_payment', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled', 'refunded')),
  subtotal_cents    integer not null check (subtotal_cents >= 0),
  shipping_cents    integer not null default 0 check (shipping_cents >= 0),
  commission_bps    integer not null,
  commission_cents  integer not null check (commission_cents >= 0),
  seller_net_cents  integer not null,
  payout_status     text not null default 'not_applicable'
                    check (payout_status in ('not_applicable', 'pending', 'paid_out', 'reversed')),
  carrier           text check (carrier is null or char_length(carrier) <= 40),
  tracking_number   text check (tracking_number is null or char_length(tracking_number) <= 60),
  shipped_at        timestamptz,
  delivered_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (order_id, seller_id)
);
create index seller_orders_seller_idx on public.seller_orders (seller_id, status, created_at desc);

create table public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders(id) on delete cascade,
  seller_order_id   uuid not null references public.seller_orders(id) on delete cascade,
  product_id        uuid references public.products(id) on delete set null,
  variant_id        uuid references public.product_variants(id) on delete set null,
  title             text not null,
  size              text,
  color             text,
  image_url         text,
  unit_price_cents  integer not null check (unit_price_cents >= 0),
  quantity          integer not null check (quantity > 0),
  line_total_cents  integer not null check (line_total_cents >= 0)
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_seller_order_idx on public.order_items (seller_order_id);

create table public.reservations (
  id           uuid primary key default gen_random_uuid(),
  variant_id   uuid not null references public.product_variants(id) on delete cascade,
  order_id     uuid not null references public.orders(id) on delete cascade,
  buyer_id     uuid not null references public.profiles(id),
  quantity     integer not null check (quantity > 0),
  status       text not null default 'active' check (status in ('active', 'converted', 'released', 'expired')),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index reservations_order_idx on public.reservations (order_id);
create index reservations_active_idx on public.reservations (variant_id) where status = 'active';

create table public.inventory_movements (
  id               bigint generated always as identity primary key,
  variant_id       uuid not null references public.product_variants(id) on delete cascade,
  product_id       uuid not null references public.products(id) on delete cascade,
  kind             text not null check (kind in ('initial', 'adjustment', 'reserve', 'release', 'expire', 'sale', 'restock')),
  on_hand_delta    integer not null default 0,
  reserved_delta   integer not null default 0,
  on_hand_after    integer not null,
  reserved_after   integer not null,
  order_id         uuid,
  reservation_id   uuid,
  actor_id         uuid,
  note             text,
  created_at       timestamptz not null default now()
);
create index inventory_movements_variant_idx on public.inventory_movements (variant_id, id desc);

-- ---------------------------------------------------------------------
-- Pagos, reembolsos y liquidaciones
-- ---------------------------------------------------------------------
create table public.campaigns (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.profiles(id) on delete cascade,
  business_id    uuid references public.businesses(id) on delete cascade,
  store_id       uuid references public.stores(id) on delete cascade,
  product_id     uuid references public.products(id) on delete cascade,
  kind           text not null check (kind in ('home_store', 'promoted_product', 'category_spotlight', 'temporary_promo', 'featured_offer')),
  category_id    text references public.categories(id),
  headline       text not null check (char_length(headline) between 3 and 80),
  body           text check (body is null or char_length(body) <= 300),
  budget_cents   integer not null check (budget_cents between 0 and 100000000),
  duration_days  integer not null check (duration_days between 1 and 90),
  starts_at      timestamptz,
  ends_at        timestamptz,
  status         text not null default 'draft'
                 check (status in ('draft', 'pending_review', 'pending_payment', 'active', 'paused', 'finished', 'rejected')),
  is_test        boolean not null default false,
  is_demo        boolean not null default false,
  review_note    text,
  reviewed_by    uuid,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint campaign_has_target check (business_id is not null or store_id is not null or product_id is not null),
  constraint campaign_active_has_window check (status not in ('active', 'paused', 'finished') or (starts_at is not null and ends_at is not null))
);
create index campaigns_owner_idx on public.campaigns (owner_id, status);
create index campaigns_active_idx on public.campaigns (kind, status) where status = 'active';

create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid references public.orders(id) on delete cascade,
  campaign_id   uuid references public.campaigns(id) on delete cascade,
  payer_id      uuid references public.profiles(id),
  provider      text not null check (provider in ('test', 'stripe')),
  provider_ref  text,
  amount_cents  integer not null check (amount_cents >= 0),
  currency      text not null default 'USD',
  status        text not null check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  is_test       boolean not null,
  created_at    timestamptz not null default now(),
  constraint payment_single_target check ((order_id is null) <> (campaign_id is null))
);
create unique index payments_provider_ref_key on public.payments (provider, provider_ref) where provider_ref is not null;
create index payments_order_idx on public.payments (order_id);

create table public.refunds (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders(id) on delete cascade,
  seller_order_id  uuid references public.seller_orders(id) on delete cascade,
  amount_cents     integer not null check (amount_cents > 0),
  reason           text not null check (char_length(reason) between 3 and 300),
  status           text not null check (status in ('pending', 'succeeded', 'failed')),
  is_test          boolean not null,
  restocked        boolean not null default false,
  created_by       uuid,
  created_at       timestamptz not null default now()
);
create index refunds_order_idx on public.refunds (order_id);

-- ---------------------------------------------------------------------
-- Confianza: reseñas, reportes, notificaciones, auditoría, analítica
-- ---------------------------------------------------------------------
create table public.reviews (
  id               uuid primary key default gen_random_uuid(),
  seller_order_id  uuid not null unique references public.seller_orders(id) on delete cascade,
  reviewer_id      uuid not null references public.profiles(id) on delete cascade,
  seller_id        uuid not null references public.profiles(id) on delete cascade,
  store_id         uuid references public.stores(id) on delete set null,
  rating           smallint not null check (rating between 1 and 5),
  body             text check (body is null or char_length(body) <= 1000),
  status           text not null default 'visible' check (status in ('visible', 'hidden')),
  created_at       timestamptz not null default now()
);
create index reviews_store_idx on public.reviews (store_id, created_at desc);

create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references public.profiles(id) on delete cascade,
  target_type      text not null check (target_type in ('product', 'store', 'business', 'user', 'review', 'campaign')),
  target_id        uuid not null,
  reason           text not null check (reason in ('prohibited', 'counterfeit', 'scam', 'offensive', 'spam', 'other')),
  details          text check (details is null or char_length(details) <= 1000),
  status           text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  resolution_note  text,
  resolved_by      uuid,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);
create unique index reports_one_open_per_target
  on public.reports (reporter_id, target_type, target_id) where status in ('open', 'reviewing');

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.admin_audit_log (
  id           bigint generated always as identity primary key,
  actor_id     uuid,
  action       text not null,
  target_type  text,
  target_id    text,
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create table public.analytics_events (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('impression', 'click', 'product_view', 'store_view', 'business_view', 'follow', 'add_to_cart', 'purchase')),
  product_id   uuid,
  store_id     uuid,
  business_id  uuid,
  campaign_id  uuid,
  user_id      uuid,
  session_id   text check (session_id is null or char_length(session_id) <= 64),
  created_at   timestamptz not null default now()
);
create index analytics_campaign_idx on public.analytics_events (campaign_id, kind) where campaign_id is not null;
create index analytics_product_idx on public.analytics_events (product_id, kind) where product_id is not null;

create table public.rate_limits (
  key           text primary key,
  window_start  timestamptz not null,
  hits          integer not null
);

create table public.ai_usage (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  day         date not null default current_date,
  feature     text not null,
  requests    integer not null default 0,
  primary key (user_id, day, feature)
);

-- ---------------------------------------------------------------------
-- Disparadores genéricos
-- ---------------------------------------------------------------------
create or replace function public.tg_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'stores', 'businesses', 'products', 'product_variants', 'offers',
                           'orders', 'seller_orders', 'campaigns']
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.tg_set_updated_at()', t);
  end loop;
end $$;

-- Texto de búsqueda normalizado (minúsculas) mantenido por el sistema.
create or replace function public.tg_products_search_text() returns trigger
language plpgsql as $$
begin
  new.search_text := lower(
    coalesce(new.title, '') || ' ' || coalesce(new.brand, '') || ' ' || coalesce(new.color, '') || ' ' ||
    coalesce(new.material, '') || ' ' || array_to_string(coalesce(new.tags, '{}'), ' ') || ' ' ||
    coalesce(new.category_id, '') || ' ' || left(coalesce(new.description, ''), 500)
  );
  return new;
end $$;
create trigger products_search_text before insert or update on public.products
  for each row execute function public.tg_products_search_text();

-- Perfil automático al registrarse (auth.users -> public.profiles).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base text;
  v_username text;
  v_display text;
  v_try int := 0;
begin
  v_base := lower(coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(coalesce(new.email, 'user'), '@', 1)));
  v_base := regexp_replace(v_base, '[^a-z0-9_.]', '', 'g');
  if char_length(v_base) < 3 then v_base := v_base || 'user'; end if;
  v_base := left(v_base, 24);
  v_username := v_base;
  while exists (select 1 from public.profiles where lower(username) = v_username) loop
    v_try := v_try + 1;
    v_username := v_base || (floor(random() * 9000) + 1000)::int::text;
    exit when v_try > 20;
  end loop;
  v_display := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), v_username), 60);
  insert into public.profiles (id, username, display_name) values (new.id, v_username, v_display);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Categorías iniciales (ampliables)
-- ---------------------------------------------------------------------
insert into public.categories (id, parent_id, name, sort, size_system, required_fields) values
  ('ropa',          null,         'Ropa',            10, 'apparel',  '{size}'),
  ('sneakers',      null,         'Sneakers',        20, 'shoes',    '{size,brand}'),
  ('streetwear',    null,         'Streetwear',      30, 'apparel',  '{size}'),
  ('accesorios',    null,         'Accesorios',      40, 'one_size', '{}'),
  ('bolsos',        null,         'Bolsos',          50, 'one_size', '{}'),
  ('belleza',       null,         'Belleza',         60, 'none',     '{brand}'),
  ('ropa-camisetas',  'ropa',     'Camisetas',        1, 'apparel',  '{size}'),
  ('ropa-sudaderas',  'ropa',     'Sudaderas',        2, 'apparel',  '{size}'),
  ('ropa-chaquetas',  'ropa',     'Chaquetas',        3, 'apparel',  '{size}'),
  ('ropa-pantalones', 'ropa',     'Pantalones',       4, 'apparel',  '{size}'),
  ('ropa-vestidos',   'ropa',     'Vestidos',         5, 'apparel',  '{size}'),
  ('sneakers-lifestyle', 'sneakers', 'Lifestyle',     1, 'shoes',    '{size,brand}'),
  ('sneakers-running',   'sneakers', 'Running',       2, 'shoes',    '{size,brand}'),
  ('sneakers-basket',    'sneakers', 'Basketball',    3, 'shoes',    '{size,brand}'),
  ('streetwear-hoodies', 'streetwear', 'Hoodies',     1, 'apparel',  '{size}'),
  ('streetwear-graficas','streetwear', 'Camisetas gráficas', 2, 'apparel', '{size}'),
  ('streetwear-cargo',   'streetwear', 'Cargo y workwear',   3, 'apparel', '{size}'),
  ('accesorios-gorras',  'accesorios', 'Gorras',      1, 'one_size', '{}'),
  ('accesorios-gafas',   'accesorios', 'Gafas',       2, 'one_size', '{}'),
  ('accesorios-joyeria', 'accesorios', 'Joyería',     3, 'one_size', '{}'),
  ('accesorios-relojes', 'accesorios', 'Relojes',     4, 'one_size', '{brand}'),
  ('bolsos-tote',        'bolsos',     'Tote',        1, 'one_size', '{}'),
  ('bolsos-crossbody',   'bolsos',     'Crossbody',   2, 'one_size', '{}'),
  ('bolsos-mochilas',    'bolsos',     'Mochilas',    3, 'one_size', '{}'),
  ('belleza-skincare',   'belleza',    'Skincare',    1, 'none',     '{brand}'),
  ('belleza-fragancias', 'belleza',    'Fragancias',  2, 'none',     '{brand}'),
  ('belleza-maquillaje', 'belleza',    'Maquillaje',  3, 'none',     '{brand}');
