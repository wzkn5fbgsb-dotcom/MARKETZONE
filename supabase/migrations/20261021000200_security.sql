-- =====================================================================
-- MARKETXONE · 0200 · Seguridad a nivel de tabla
-- Row Level Security en todas las tablas + privilegios mínimos.
-- Regla general: las tablas sensibles NO aceptan escrituras directas
-- desde el navegador; todo cambio crítico pasa por funciones del servidor
-- que validan permisos, precios e inventario.
-- =====================================================================

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

-- RLS activado en todas las tablas del esquema public.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Punto de partida: sin privilegios directos para anon/authenticated.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ---------------------------------------------------------------------
-- Catálogo público (solo lectura, filtrado por RLS)
-- ---------------------------------------------------------------------
grant select on public.categories to anon, authenticated;
create policy categories_read on public.categories for select using (is_active or (select public.is_admin()));

grant select (id, username, display_name, avatar_url, bio, role, status, created_at) on public.profiles to anon, authenticated;
create policy profiles_read on public.profiles for select using (true);

grant select on public.stores to anon, authenticated;
create policy stores_read on public.stores for select
  using (status = 'active' or owner_id = auth.uid() or (select public.is_admin()));

grant select on public.businesses to anon, authenticated;
create policy businesses_read on public.businesses for select
  using (status = 'active' or owner_id = auth.uid() or (select public.is_admin()));

grant select on public.products to anon, authenticated;
create policy products_read on public.products for select
  using (
    (status = 'active' and moderation_status = 'ok')
    or seller_id = auth.uid()
    or (select public.is_admin())
  );

grant select on public.product_images to anon, authenticated;
create policy product_images_read on public.product_images for select
  using (exists (select 1 from public.products p where p.id = product_id));

grant select (id, product_id, size, color, price_cents, stock_on_hand, stock_reserved, is_active, position)
  on public.product_variants to anon, authenticated;
create policy product_variants_read on public.product_variants for select
  using (exists (select 1 from public.products p where p.id = product_id));

grant select on public.reviews to anon, authenticated;
create policy reviews_read on public.reviews for select
  using (status = 'visible' or reviewer_id = auth.uid() or seller_id = auth.uid() or (select public.is_admin()));

-- ---------------------------------------------------------------------
-- Datos propios del usuario
-- ---------------------------------------------------------------------
grant select, insert, delete on public.favorites to authenticated;
create policy favorites_own_read on public.favorites for select using (user_id = auth.uid());
create policy favorites_own_insert on public.favorites for insert with check (user_id = auth.uid());
create policy favorites_own_delete on public.favorites for delete using (user_id = auth.uid());

grant select, insert, delete on public.follows to authenticated;
create policy follows_own_read on public.follows for select using (user_id = auth.uid());
create policy follows_own_insert on public.follows for insert with check (user_id = auth.uid());
create policy follows_own_delete on public.follows for delete using (user_id = auth.uid());

grant select, delete on public.cart_items to authenticated;
create policy cart_own_read on public.cart_items for select using (user_id = auth.uid());
create policy cart_own_delete on public.cart_items for delete using (user_id = auth.uid());

grant select, delete on public.addresses to authenticated;
create policy addresses_own_read on public.addresses for select using (user_id = auth.uid());
create policy addresses_own_delete on public.addresses for delete using (user_id = auth.uid());

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_own_read on public.notifications for select using (user_id = auth.uid());
create policy notifications_own_update on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Comercio: lectura limitada a las partes implicadas
-- (funciones auxiliares SECURITY DEFINER para evitar recursión entre políticas)
-- ---------------------------------------------------------------------
create or replace function public.is_order_buyer(p_order_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.orders where id = p_order_id and buyer_id = auth.uid());
$$;
create or replace function public.is_order_seller(p_order_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.seller_orders where order_id = p_order_id and seller_id = auth.uid());
$$;

grant select on public.orders to authenticated;
create policy orders_parties_read on public.orders for select
  using (
    buyer_id = auth.uid()
    or public.is_order_seller(id)
    or (select public.is_admin())
  );

grant select on public.seller_orders to authenticated;
create policy seller_orders_parties_read on public.seller_orders for select
  using (
    seller_id = auth.uid()
    or public.is_order_buyer(order_id)
    or (select public.is_admin())
  );

grant select on public.order_items to authenticated;
create policy order_items_parties_read on public.order_items for select
  using (
    public.is_order_buyer(order_id)
    or exists (select 1 from public.seller_orders so where so.id = seller_order_id and so.seller_id = auth.uid())
    or (select public.is_admin())
  );

grant select on public.offers to authenticated;
create policy offers_parties_read on public.offers for select
  using (buyer_id = auth.uid() or seller_id = auth.uid() or (select public.is_admin()));

grant select on public.offer_events to authenticated;
create policy offer_events_parties_read on public.offer_events for select
  using (exists (select 1 from public.offers o where o.id = offer_id));

grant select on public.payments to authenticated;
create policy payments_parties_read on public.payments for select
  using (payer_id = auth.uid() or (select public.is_admin()));

grant select on public.refunds to authenticated;
create policy refunds_parties_read on public.refunds for select
  using (public.is_order_buyer(order_id) or public.is_order_seller(order_id) or (select public.is_admin()));

grant select on public.campaigns to anon, authenticated;
create policy campaigns_read on public.campaigns for select
  using (status = 'active' or owner_id = auth.uid() or (select public.is_admin()));

grant select on public.reports to authenticated;
create policy reports_read on public.reports for select
  using (reporter_id = auth.uid() or (select public.is_admin()));

-- ---------------------------------------------------------------------
-- Solo administradores (lectura); escritura solo por funciones
-- ---------------------------------------------------------------------
grant select on public.platform_settings to anon, authenticated;
create policy settings_read on public.platform_settings for select using (true);

grant select on public.inventory_movements to authenticated;
create policy movements_read on public.inventory_movements for select
  using (exists (select 1 from public.products p where p.id = product_id and p.seller_id = auth.uid()) or (select public.is_admin()));

grant select on public.reservations to authenticated;
create policy reservations_read on public.reservations for select
  using (buyer_id = auth.uid() or (select public.is_admin()));

grant select on public.admin_audit_log to authenticated;
create policy audit_admin_read on public.admin_audit_log for select using ((select public.is_admin()));

grant select on public.product_price_history to authenticated;
create policy price_history_read on public.product_price_history for select
  using (exists (select 1 from public.products p where p.id = product_id and p.seller_id = auth.uid()) or (select public.is_admin()));

-- analytics_events, rate_limits, ai_usage: sin acceso directo (RLS activo y sin políticas).
