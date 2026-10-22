-- =====================================================================
-- MARKETXONE · 0300 · Funciones base: utilidades, cuentas, tiendas,
-- catálogo público y gestión de publicaciones con inventario por variante.
-- Convención de errores: RAISE con message = código estable (p. ej.
-- 'out_of_stock'), hint = mensaje en español para la persona usuaria y
-- detail = JSON opcional con datos para la interfaz.
-- =====================================================================

alter table public.platform_settings add column real_payments_ready boolean not null default false;
alter table public.reviews add column is_test boolean not null default false;

-- ---------------------------------------------------------------------
-- Utilidades internas
-- ---------------------------------------------------------------------
create or replace function public.mz_fail(p_code text, p_message text, p_detail jsonb default null) returns void
language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_code, hint = p_message, detail = coalesce(p_detail::text, '');
end $$;

create or replace function public.mz_require_user() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    perform public.mz_fail('auth_required', 'Inicia sesión para continuar.');
  end if;
  select status into v_status from public.profiles where id = v_uid;
  if v_status is null then
    perform public.mz_fail('profile_missing', 'No encontramos tu perfil. Cierra sesión y vuelve a entrar.');
  end if;
  if v_status = 'suspended' then
    perform public.mz_fail('account_suspended', 'Tu cuenta está suspendida. Contacta con soporte.');
  end if;
  return v_uid;
end $$;

create or replace function public.mz_require_admin() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user();
begin
  if not public.is_admin() then
    perform public.mz_fail('forbidden', 'Esta acción requiere permisos de administración.');
  end if;
  return v_uid;
end $$;

create or replace function public.mz_rate_limit(p_key text, p_max integer, p_window interval) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hits integer;
begin
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - p_window then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - p_window then now() else r.window_start end
  returning hits into v_hits;
  if v_hits > p_max then
    perform public.mz_fail('rate_limited', 'Has hecho demasiadas solicitudes seguidas. Espera unos minutos e inténtalo de nuevo.');
  end if;
end $$;

create or replace function public.mz_notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (user_id, kind, title, body, link) values (p_user, p_kind, p_title, p_body, p_link);
$$;

create or replace function public.mz_audit(p_action text, p_target_type text, p_target_id text, p_details jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function public.mz_settings() returns public.platform_settings
language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.platform_settings where id = 1;
$$;

create or replace function public.mz_money(p_cents integer) returns text
language sql immutable as $$
  select '$' || to_char(coalesce(p_cents, 0) / 100.0, 'FM999G999G990D00');
$$;

-- Registro de movimiento de inventario (se llama después de modificar la variante).
create or replace function public.mz_log_movement(
  p_variant_id uuid, p_kind text, p_on_hand_delta integer, p_reserved_delta integer,
  p_order_id uuid, p_reservation_id uuid, p_actor uuid, p_note text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.product_variants%rowtype;
begin
  select * into v from public.product_variants where id = p_variant_id;
  insert into public.inventory_movements
    (variant_id, product_id, kind, on_hand_delta, reserved_delta, on_hand_after, reserved_after,
     order_id, reservation_id, actor_id, note)
  values
    (v.id, v.product_id, p_kind, p_on_hand_delta, p_reserved_delta, v.stock_on_hand, v.stock_reserved,
     p_order_id, p_reservation_id, p_actor, p_note);
end $$;

-- ---------------------------------------------------------------------
-- Visibilidad pública y tarjetas JSON
-- ---------------------------------------------------------------------
create or replace function public.mz_public_products() returns setof public.products
language sql stable as $$
  select p.*
  from public.products p
  join public.stores s on s.id = p.store_id and s.status = 'active'
  join public.profiles pr on pr.id = p.seller_id and pr.status = 'active'
  where p.status = 'active' and p.moderation_status = 'ok';
$$;

create or replace function public.mz_card(p public.products) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p.id,
    'title', p.title,
    'brand', p.brand,
    'price_cents', p.price_cents,
    'compare_at_cents', p.compare_at_cents,
    'condition', p.condition,
    'category_id', p.category_id,
    'status', p.status,
    'is_demo', p.is_demo,
    'image_url', (select i.url from public.product_images i where i.product_id = p.id order by i.position, i.created_at limit 1),
    'sizes', coalesce((
        select jsonb_agg(jsonb_build_object('size', v.size, 'color', v.color, 'available', v.stock_on_hand - v.stock_reserved)
                         order by v.position, v.created_at)
        from public.product_variants v where v.product_id = p.id and v.is_active), '[]'::jsonb),
    'available', (select coalesce(sum(v.stock_on_hand - v.stock_reserved), 0)::int
                  from public.product_variants v where v.product_id = p.id and v.is_active),
    'seller', (select jsonb_build_object('id', pr.id, 'username', pr.username, 'display_name', pr.display_name)
               from public.profiles pr where pr.id = p.seller_id),
    'store', (select jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.name) from public.stores s where s.id = p.store_id),
    'is_favorite', exists (select 1 from public.favorites f where f.product_id = p.id and f.user_id = auth.uid()),
    'sponsored', false,
    'published_at', p.published_at,
    'created_at', p.created_at
  );
$$;

create or replace function public.mz_store_stats(p_store_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'followers', (select count(*) from public.follows f where f.store_id = p_store_id),
    'active_listings', (select count(*) from public.mz_public_products() p where p.store_id = p_store_id),
    'verified_sales', (select count(*) from public.seller_orders so join public.orders o on o.id = so.order_id
                       where so.store_id = p_store_id and not o.is_test
                         and so.status in ('paid', 'preparing', 'shipped', 'delivered')),
    'test_sales', (select count(*) from public.seller_orders so join public.orders o on o.id = so.order_id
                   where so.store_id = p_store_id and o.is_test
                     and so.status in ('paid', 'preparing', 'shipped', 'delivered')),
    'rating_avg', (select round(avg(r.rating)::numeric, 2) from public.reviews r where r.store_id = p_store_id and r.status = 'visible'),
    'rating_count', (select count(*) from public.reviews r where r.store_id = p_store_id and r.status = 'visible')
  );
$$;

create or replace function public.mz_store_card(s public.stores) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', s.id, 'slug', s.slug, 'name', s.name, 'logo_url', s.logo_url, 'cover_url', s.cover_url,
    'bio', s.bio, 'accent', s.accent, 'categories', to_jsonb(s.categories), 'is_demo', s.is_demo,
    'owner', (select jsonb_build_object('id', pr.id, 'username', pr.username, 'display_name', pr.display_name)
              from public.profiles pr where pr.id = s.owner_id),
    'stats', public.mz_store_stats(s.id),
    'preview_images', coalesce((
        select jsonb_agg(x.url) from (
          select (select i.url from public.product_images i where i.product_id = p.id order by i.position limit 1) as url
          from public.mz_public_products() p where p.store_id = s.id
          order by p.published_at desc nulls last limit 3) x where x.url is not null), '[]'::jsonb)
  );
$$;

create or replace function public.mz_business_card(b public.businesses) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', b.id, 'slug', b.slug, 'name', b.name, 'logo_url', b.logo_url, 'cover_url', b.cover_url,
    'description', left(b.description, 240), 'category', b.category, 'location', b.location, 'is_demo', b.is_demo,
    'store_slug', (select s.slug from public.stores s where s.id = b.store_id and s.status = 'active')
  );
$$;

-- ---------------------------------------------------------------------
-- Configuración pública y categorías
-- ---------------------------------------------------------------------
create or replace function public.public_settings() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'commission_bps', s.commission_bps,
    'shipping_flat_cents', s.shipping_flat_cents,
    'checkout_hold_minutes', s.checkout_hold_minutes,
    'offer_response_minutes', s.offer_response_minutes,
    'offer_payment_minutes', s.offer_payment_minutes,
    'min_offer_percent', s.min_offer_percent,
    'min_campaign_cents', s.min_campaign_cents,
    'test_mode', s.test_mode,
    'real_payments_ready', s.real_payments_ready
  ) from public.platform_settings s where s.id = 1;
$$;

create or replace function public.list_categories() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'parent_id', c.parent_id, 'name', c.name, 'sort', c.sort,
      'size_system', c.size_system, 'required_fields', to_jsonb(c.required_fields),
      'active_count', (select count(*) from public.mz_public_products() p
                       where p.category_id = c.id or p.category_id in (select id from public.categories ch where ch.parent_id = c.id))
    ) order by c.parent_id nulls first, c.sort), '[]'::jsonb)
  from public.categories c where c.is_active;
$$;

-- ---------------------------------------------------------------------
-- Cuenta, perfil, direcciones, tiendas
-- ---------------------------------------------------------------------
create or replace function public.mz_default_store(p_uid uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_store uuid;
  v_profile public.profiles%rowtype;
  v_slug text;
  v_n int := 1;
begin
  select id into v_store from public.stores where owner_id = p_uid order by created_at limit 1;
  if v_store is not null then return v_store; end if;
  select * into v_profile from public.profiles where id = p_uid;
  v_slug := regexp_replace(lower(v_profile.username), '[^a-z0-9-]', '-', 'g');
  if char_length(v_slug) < 3 then v_slug := v_slug || '-shop'; end if;
  v_slug := left(v_slug, 36);
  while exists (select 1 from public.stores where lower(slug) = v_slug) loop
    v_n := v_n + 1;
    v_slug := left(regexp_replace(lower(v_profile.username), '[^a-z0-9-]', '-', 'g'), 34) || '-' || v_n;
  end loop;
  insert into public.stores (owner_id, slug, name) values (p_uid, v_slug, left(v_profile.display_name, 60))
  returning id into v_store;
  return v_store;
end $$;

create or replace function public.my_account() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user();
begin
  return (
    select jsonb_build_object(
      'profile', jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name,
                                    'avatar_url', p.avatar_url, 'bio', p.bio, 'role', p.role,
                                    'preferences', p.preferences, 'created_at', p.created_at),
      'email', (select u.email from auth.users u where u.id = v_uid),
      'is_admin', p.role = 'admin',
      'addresses', coalesce((select jsonb_agg(to_jsonb(a) order by a.is_default desc, a.created_at) from public.addresses a where a.user_id = v_uid), '[]'::jsonb),
      'stores', coalesce((select jsonb_agg(public.mz_store_card(s) || jsonb_build_object('status', s.status, 'social_links', s.social_links, 'business_info', s.business_info) order by s.created_at) from public.stores s where s.owner_id = v_uid), '[]'::jsonb),
      'businesses', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at) from public.businesses b where b.owner_id = v_uid), '[]'::jsonb),
      'unread_notifications', (select count(*) from public.notifications n where n.user_id = v_uid and n.read_at is null),
      'cart_count', (select coalesce(sum(quantity), 0) from public.cart_items c where c.user_id = v_uid)
    )
    from public.profiles p where p.id = v_uid
  );
end $$;

create or replace function public.update_profile(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_username text := lower(trim(coalesce(p ->> 'username', '')));
begin
  if p ? 'username' then
    if v_username !~ '^[a-z0-9_.]{3,30}$' then
      perform public.mz_fail('validation', 'El nombre de usuario debe tener 3–30 caracteres: letras minúsculas, números, punto o guion bajo.', '{"field":"username"}');
    end if;
    if exists (select 1 from public.profiles where lower(username) = v_username and id <> v_uid) then
      perform public.mz_fail('username_taken', 'Ese nombre de usuario ya está en uso.', '{"field":"username"}');
    end if;
  end if;
  if p ? 'display_name' and char_length(trim(p ->> 'display_name')) not between 1 and 60 then
    perform public.mz_fail('validation', 'El nombre visible debe tener entre 1 y 60 caracteres.', '{"field":"display_name"}');
  end if;
  if p ? 'bio' and char_length(coalesce(p ->> 'bio', '')) > 500 then
    perform public.mz_fail('validation', 'La biografía admite hasta 500 caracteres.', '{"field":"bio"}');
  end if;
  update public.profiles set
    username     = case when p ? 'username' then v_username else username end,
    display_name = case when p ? 'display_name' then trim(p ->> 'display_name') else display_name end,
    bio          = case when p ? 'bio' then nullif(trim(p ->> 'bio'), '') else bio end,
    avatar_url   = case when p ? 'avatar_url' then nullif(p ->> 'avatar_url', '') else avatar_url end,
    preferences  = case when jsonb_typeof(p -> 'preferences') = 'object' then preferences || (p -> 'preferences') else preferences end
  where id = v_uid;
  return public.my_account();
end $$;

create or replace function public.save_address(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_default boolean := coalesce((p ->> 'is_default')::boolean, false);
  v_row public.addresses%rowtype;
begin
  if (select count(*) from public.addresses where user_id = v_uid) >= 10 and v_id is null then
    perform public.mz_fail('limit_reached', 'Puedes guardar hasta 10 direcciones.');
  end if;
  if not exists (select 1 from public.addresses where user_id = v_uid) then v_default := true; end if;
  if v_default then update public.addresses set is_default = false where user_id = v_uid; end if;
  begin
    if v_id is null then
      insert into public.addresses (user_id, full_name, line1, line2, city, region, postal_code, country, phone, is_default)
      values (v_uid, trim(p ->> 'full_name'), trim(p ->> 'line1'), nullif(trim(coalesce(p ->> 'line2', '')), ''),
              trim(p ->> 'city'), trim(p ->> 'region'), trim(p ->> 'postal_code'),
              upper(coalesce(nullif(trim(p ->> 'country'), ''), 'US')), nullif(trim(coalesce(p ->> 'phone', '')), ''), v_default)
      returning * into v_row;
    else
      update public.addresses set
        full_name = trim(p ->> 'full_name'), line1 = trim(p ->> 'line1'), line2 = nullif(trim(coalesce(p ->> 'line2', '')), ''),
        city = trim(p ->> 'city'), region = trim(p ->> 'region'), postal_code = trim(p ->> 'postal_code'),
        country = upper(coalesce(nullif(trim(p ->> 'country'), ''), 'US')), phone = nullif(trim(coalesce(p ->> 'phone', '')), ''),
        is_default = v_default or is_default
      where id = v_id and user_id = v_uid
      returning * into v_row;
      if not found then perform public.mz_fail('not_found', 'La dirección no existe.'); end if;
    end if;
  exception
    when check_violation or not_null_violation then
      perform public.mz_fail('validation', 'Revisa la dirección: nombre, calle, ciudad, estado/región y código postal son obligatorios.');
  end;
  return to_jsonb(v_row);
end $$;

create or replace function public.delete_address(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user();
begin
  delete from public.addresses where id = p_id and user_id = v_uid;
  if not exists (select 1 from public.addresses where user_id = v_uid and is_default) then
    update public.addresses set is_default = true
    where id = (select id from public.addresses where user_id = v_uid order by created_at limit 1);
  end if;
end $$;

create or replace function public.save_store(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_slug text := lower(trim(coalesce(p ->> 'slug', '')));
  v_row public.stores%rowtype;
begin
  perform public.mz_rate_limit('store:' || v_uid, 60, interval '1 hour');
  if v_slug !~ '^[a-z0-9][a-z0-9-]{2,39}$' then
    perform public.mz_fail('validation', 'La dirección de la tienda debe tener 3–40 caracteres: minúsculas, números y guiones.', '{"field":"slug"}');
  end if;
  if exists (select 1 from public.stores where lower(slug) = v_slug and id is distinct from v_id) then
    perform public.mz_fail('slug_taken', 'Esa dirección de tienda ya está en uso.', '{"field":"slug"}');
  end if;
  if v_id is null and (select count(*) from public.stores where owner_id = v_uid) >= 5 then
    perform public.mz_fail('limit_reached', 'Puedes tener hasta 5 tiendas por cuenta.');
  end if;
  begin
    if v_id is null then
      insert into public.stores (owner_id, slug, name, logo_url, cover_url, bio, accent, categories, social_links, business_info)
      values (v_uid, v_slug, trim(p ->> 'name'), nullif(p ->> 'logo_url', ''), nullif(p ->> 'cover_url', ''),
              nullif(trim(coalesce(p ->> 'bio', '')), ''), coalesce(nullif(p ->> 'accent', ''), 'crimson'),
              coalesce(array(select jsonb_array_elements_text(p -> 'categories')), '{}'),
              coalesce(p -> 'social_links', '{}'::jsonb), coalesce(p -> 'business_info', '{}'::jsonb))
      returning * into v_row;
    else
      update public.stores set
        slug = v_slug, name = trim(p ->> 'name'),
        logo_url = nullif(p ->> 'logo_url', ''), cover_url = nullif(p ->> 'cover_url', ''),
        bio = nullif(trim(coalesce(p ->> 'bio', '')), ''), accent = coalesce(nullif(p ->> 'accent', ''), accent),
        categories = coalesce(array(select jsonb_array_elements_text(p -> 'categories')), categories),
        social_links = coalesce(p -> 'social_links', social_links),
        business_info = coalesce(p -> 'business_info', business_info)
      where id = v_id and owner_id = v_uid
      returning * into v_row;
      if not found then perform public.mz_fail('forbidden', 'No puedes modificar tiendas de otros usuarios.'); end if;
    end if;
  exception
    when check_violation or not_null_violation then
      perform public.mz_fail('validation', 'Revisa los datos de la tienda: el nombre debe tener entre 2 y 60 caracteres.');
  end;
  return public.mz_store_card(v_row) || jsonb_build_object('status', v_row.status, 'social_links', v_row.social_links, 'business_info', v_row.business_info);
end $$;

create or replace function public.toggle_follow(p_store_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_owner uuid;
begin
  select owner_id into v_owner from public.stores where id = p_store_id and status = 'active';
  if v_owner is null then perform public.mz_fail('not_found', 'La tienda no existe.'); end if;
  if v_owner = v_uid then perform public.mz_fail('own_store', 'No puedes seguir tu propia tienda.'); end if;
  if exists (select 1 from public.follows where user_id = v_uid and store_id = p_store_id) then
    delete from public.follows where user_id = v_uid and store_id = p_store_id;
    return jsonb_build_object('following', false, 'followers', (select count(*) from public.follows where store_id = p_store_id));
  end if;
  perform public.mz_rate_limit('follow:' || v_uid, 200, interval '1 hour');
  insert into public.follows (user_id, store_id) values (v_uid, p_store_id);
  insert into public.analytics_events (kind, store_id, user_id) values ('follow', p_store_id, v_uid);
  return jsonb_build_object('following', true, 'followers', (select count(*) from public.follows where store_id = p_store_id));
end $$;

create or replace function public.toggle_favorite(p_product_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user();
begin
  if not exists (select 1 from public.mz_public_products() p where p.id = p_product_id) then
    perform public.mz_fail('not_found', 'El producto no está disponible.');
  end if;
  if exists (select 1 from public.favorites where user_id = v_uid and product_id = p_product_id) then
    delete from public.favorites where user_id = v_uid and product_id = p_product_id;
    return jsonb_build_object('favorite', false);
  end if;
  perform public.mz_rate_limit('fav:' || v_uid, 300, interval '1 hour');
  insert into public.favorites (user_id, product_id) values (v_uid, p_product_id);
  return jsonb_build_object('favorite', true);
end $$;

create or replace function public.my_favorites() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user();
begin
  return coalesce((
    select jsonb_agg(public.mz_card(p) order by f.created_at desc)
    from public.favorites f join public.mz_public_products() p on p.id = f.product_id
    where f.user_id = v_uid), '[]'::jsonb);
end $$;

create or replace function public.my_notifications() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user();
begin
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select id, kind, title, body, link, read_at, created_at from public.notifications
      where user_id = v_uid order by created_at desc limit 60) x), '[]'::jsonb);
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user();
begin
  update public.notifications set read_at = now()
  where user_id = v_uid and read_at is null and (p_ids is null or id = any (p_ids));
end $$;

-- ---------------------------------------------------------------------
-- Catálogo público: inicio, búsqueda, producto, tienda
-- ---------------------------------------------------------------------
create or replace function public.home_feed() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'promoted', (
      select coalesce(jsonb_agg(x.card order by x.ord), '[]'::jsonb) from (
        select public.mz_card(p) || jsonb_build_object('sponsored', true, 'campaign_id', c.id) as card,
               row_number() over (order by c.starts_at desc) as ord
        from (select distinct on (product_id) * from public.campaigns
              where kind in ('promoted_product', 'featured_offer') and status = 'active'
                and product_id is not null and ends_at > now()
              order by product_id, starts_at desc) c
        join public.mz_public_products() p on p.id = c.product_id
        order by c.starts_at desc limit 8) x),
    'featured', (
      select coalesce(jsonb_agg(x.card order by x.ord), '[]'::jsonb) from (
        select public.mz_card(p) as card,
               row_number() over (order by (select count(*) from public.favorites f where f.product_id = p.id) desc, p.published_at desc) as ord
        from public.mz_public_products() p
        where exists (select 1 from public.product_images i where i.product_id = p.id)
          and exists (select 1 from public.product_variants v where v.product_id = p.id and v.is_active and v.stock_on_hand > v.stock_reserved)
        order by ord limit 8) x),
    'recent', (
      select coalesce(jsonb_agg(x.card order by x.ord), '[]'::jsonb) from (
        select public.mz_card(p) as card, row_number() over (order by p.published_at desc) as ord
        from public.mz_public_products() p order by p.published_at desc limit 12) x),
    'deals', (
      select coalesce(jsonb_agg(x.card order by x.ord), '[]'::jsonb) from (
        select public.mz_card(p) as card,
               row_number() over (order by (p.compare_at_cents - p.price_cents)::numeric / p.compare_at_cents desc) as ord
        from public.mz_public_products() p where p.compare_at_cents is not null
        order by ord limit 8) x),
    'stores', (
      select coalesce(jsonb_agg(x.card order by x.ord), '[]'::jsonb) from (
        select public.mz_store_card(s) as card,
               row_number() over (order by (select count(*) from public.follows f where f.store_id = s.id) desc,
                                           (select max(p.published_at) from public.products p where p.store_id = s.id) desc nulls last) as ord
        from public.stores s
        where s.status = 'active' and exists (select 1 from public.mz_public_products() p where p.store_id = s.id)
        order by ord limit 8) x),
    'businesses', (
      select coalesce(jsonb_agg(x.card order by x.ord), '[]'::jsonb) from (
        select public.mz_business_card(b) || jsonb_build_object('sponsored', c.id is not null, 'campaign_id', c.id) as card,
               row_number() over (order by (c.id is not null) desc, b.created_at desc) as ord
        from public.businesses b
        left join lateral (select id from public.campaigns cc
                           where cc.business_id = b.id and cc.status = 'active' and cc.kind = 'home_store' and cc.ends_at > now()
                           order by cc.starts_at desc limit 1) c on true
        where b.status = 'active'
        order by ord limit 6) x),
    'sponsored_stores', (
      select coalesce(jsonb_agg(public.mz_store_card(s) || jsonb_build_object('sponsored', true, 'campaign_id', c.id)), '[]'::jsonb)
      from public.campaigns c join public.stores s on s.id = c.store_id and s.status = 'active'
      where c.kind = 'home_store' and c.status = 'active' and c.ends_at > now() and c.business_id is null),
    'promos', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'campaign_id', c.id, 'kind', c.kind, 'headline', c.headline, 'body', c.body, 'ends_at', c.ends_at, 'is_test', c.is_test,
          'business', (select public.mz_business_card(b) from public.businesses b where b.id = c.business_id and b.status = 'active'),
          'store', (select jsonb_build_object('slug', s.slug, 'name', s.name) from public.stores s where s.id = c.store_id and s.status = 'active'))
        order by c.starts_at desc), '[]'::jsonb)
      from public.campaigns c where c.kind = 'temporary_promo' and c.status = 'active' and c.ends_at > now())
  );
$$;

create or replace function public.search_products(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_q text := lower(trim(coalesce(p ->> 'q', '')));
  v_words text[];
  v_cat text := nullif(p ->> 'category', '');
  v_sizes text[] := (select array_agg(lower(x)) from jsonb_array_elements_text(coalesce(p -> 'sizes', '[]'::jsonb)) x);
  v_conds text[] := (select array_agg(x) from jsonb_array_elements_text(coalesce(p -> 'conditions', '[]'::jsonb)) x);
  v_min int := nullif(p ->> 'min_price_cents', '')::int;
  v_max int := nullif(p ->> 'max_price_cents', '')::int;
  v_brand text := lower(nullif(trim(coalesce(p ->> 'brand', '')), ''));
  v_store text := lower(nullif(p ->> 'store_slug', ''));
  v_only_avail boolean := coalesce((p ->> 'only_available')::boolean, false);
  v_deals boolean := coalesce((p ->> 'only_deals')::boolean, false);
  v_sort text := coalesce(nullif(p ->> 'sort', ''), 'recent');
  v_limit int := least(greatest(coalesce((p ->> 'limit')::int, 24), 1), 60);
  v_offset int := greatest(coalesce((p ->> 'offset')::int, 0), 0);
  v_items jsonb;
  v_total int;
  v_spot jsonb := '[]'::jsonb;
begin
  v_words := array_remove(string_to_array(regexp_replace(v_q, '[%_\\]', '', 'g'), ' '), '');
  with base as (
    select x as prod, x.price_cents, x.published_at,
           (select count(*) from public.favorites f where f.product_id = x.id) as fav_count
    from public.mz_public_products() x
    where (v_cat is null or x.category_id = v_cat or x.category_id in (select id from public.categories where parent_id = v_cat))
      and (v_words is null or not exists (select 1 from unnest(v_words) w where x.search_text not like '%' || w || '%'))
      and (v_conds is null or x.condition = any (v_conds))
      and (v_min is null or x.price_cents >= v_min)
      and (v_max is null or x.price_cents <= v_max)
      and (v_brand is null or lower(x.brand) = v_brand)
      and (not v_deals or x.compare_at_cents is not null)
      and (v_store is null or x.store_id in (select id from public.stores where lower(slug) = v_store))
      and (v_sizes is null or exists (select 1 from public.product_variants v where v.product_id = x.id and v.is_active
                                       and lower(v.size) = any (v_sizes) and v.stock_on_hand > v.stock_reserved))
      and (not v_only_avail or exists (select 1 from public.product_variants v where v.product_id = x.id and v.is_active
                                        and v.stock_on_hand > v.stock_reserved))
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(public.mz_card(b.prod) order by b.ord) from (
            select base.*, row_number() over (
              order by
                case when v_sort = 'price_asc' then base.price_cents end asc,
                case when v_sort = 'price_desc' then base.price_cents end desc,
                case when v_sort = 'popular' then base.fav_count end desc,
                base.published_at desc) as ord
            from base order by ord limit v_limit offset v_offset) b), '[]'::jsonb)
  into v_total, v_items;

  if v_cat is not null and v_offset = 0 then
    select coalesce(jsonb_agg(public.mz_card(pp) || jsonb_build_object('sponsored', true, 'campaign_id', c.id)), '[]'::jsonb)
    into v_spot
    from public.campaigns c join public.mz_public_products() pp on pp.id = c.product_id
    where c.kind = 'category_spotlight' and c.status = 'active' and c.ends_at > now()
      and (c.category_id = v_cat or c.category_id in (select parent_id from public.categories where id = v_cat));
  end if;

  return jsonb_build_object('items', v_items, 'total', v_total, 'spotlight', v_spot, 'limit', v_limit, 'offset', v_offset);
end $$;

create or replace function public.get_product(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_p public.products%rowtype;
  v_is_owner boolean;
  v_visible boolean;
  v_settings public.platform_settings%rowtype := public.mz_settings();
begin
  select * into v_p from public.products where id = p_id;
  if not found then perform public.mz_fail('not_found', 'Este producto no existe o ya no está disponible.'); end if;
  v_is_owner := v_uid is not null and v_p.seller_id = v_uid;
  v_visible := exists (select 1 from public.mz_public_products() x where x.id = p_id);
  if not v_visible and not v_is_owner and not public.is_admin() then
    perform public.mz_fail('not_found', 'Este producto no existe o ya no está disponible.');
  end if;
  return jsonb_build_object(
    'product', to_jsonb(v_p) - 'search_text' - case when v_is_owner or public.is_admin() then 'zz' else 'moderation_note' end,
    'images', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'storage_path', i.storage_path) order by i.position, i.created_at)
                        from public.product_images i where i.product_id = p_id), '[]'::jsonb),
    'variants', coalesce((select jsonb_agg(jsonb_build_object(
                            'id', v.id, 'size', v.size, 'color', v.color, 'sku', case when v_is_owner then v.sku end,
                            'price_cents', coalesce(v.price_cents, v_p.price_cents),
                            'available', v.stock_on_hand - v.stock_reserved,
                            'stock_on_hand', case when v_is_owner then v.stock_on_hand end,
                            'stock_reserved', case when v_is_owner then v.stock_reserved end)
                          order by v.position, v.created_at)
                        from public.product_variants v where v.product_id = p_id and v.is_active), '[]'::jsonb),
    'seller', (select jsonb_build_object('id', pr.id, 'username', pr.username, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url)
               from public.profiles pr where pr.id = v_p.seller_id),
    'store', (select jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.name, 'logo_url', s.logo_url, 'is_demo', s.is_demo)
                     || jsonb_build_object('stats', public.mz_store_stats(s.id))
              from public.stores s where s.id = v_p.store_id),
    'category', (select jsonb_build_object('id', c.id, 'name', c.name, 'parent_id', c.parent_id, 'size_system', c.size_system)
                 from public.categories c where c.id = v_p.category_id),
    'is_owner', v_is_owner,
    'is_visible', v_visible,
    'is_favorite', exists (select 1 from public.favorites f where f.product_id = p_id and f.user_id = v_uid),
    'favorites_count', (select count(*) from public.favorites f where f.product_id = p_id),
    'offer_rules', jsonb_build_object(
        'enabled', v_p.offers_enabled and not v_is_owner and v_visible,
        'min_percent', v_settings.min_offer_percent,
        'min_cents', ceil(v_p.price_cents * v_settings.min_offer_percent / 100.0)::int),
    'my_open_offer', (select jsonb_build_object('id', o.id, 'status', o.status, 'amount_cents', o.amount_cents, 'awaiting', o.awaiting, 'expires_at', o.expires_at)
                      from public.offers o where o.product_id = p_id and o.buyer_id = v_uid
                        and o.status in ('pending', 'countered', 'accepted') order by o.created_at desc limit 1),
    'sponsored', exists (select 1 from public.campaigns c where c.product_id = p_id and c.status = 'active' and c.ends_at > now()),
    'similar', coalesce((select jsonb_agg(x.card) from (
                  select public.mz_card(s) as card from public.mz_public_products() s
                  where s.category_id = v_p.category_id and s.id <> p_id
                  order by s.published_at desc limit 8) x), '[]'::jsonb),
    'fees', jsonb_build_object('commission_bps', v_settings.commission_bps, 'shipping_flat_cents', v_settings.shipping_flat_cents,
                               'test_mode', v_settings.test_mode)
  );
end $$;

create or replace function public.get_store(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_s public.stores%rowtype;
begin
  select * into v_s from public.stores where lower(slug) = lower(p_slug);
  if not found or (v_s.status <> 'active' and v_s.owner_id is distinct from v_uid and not public.is_admin()) then
    perform public.mz_fail('not_found', 'Esta tienda no existe.');
  end if;
  return jsonb_build_object(
    'store', public.mz_store_card(v_s) || jsonb_build_object('status', v_s.status, 'social_links', v_s.social_links,
                                                             'business_info', v_s.business_info, 'created_at', v_s.created_at),
    'is_owner', v_s.owner_id = v_uid,
    'is_following', exists (select 1 from public.follows f where f.store_id = v_s.id and f.user_id = v_uid),
    'products', coalesce((select jsonb_agg(x.card) from (
                   select public.mz_card(p) as card from public.mz_public_products() p
                   where p.store_id = v_s.id order by p.published_at desc limit 120) x), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', r.id, 'rating', r.rating, 'body', r.body, 'created_at', r.created_at, 'is_test', r.is_test,
                   'reviewer', (select jsonb_build_object('username', pr.username, 'display_name', pr.display_name) from public.profiles pr where pr.id = r.reviewer_id))
                 order by r.created_at desc)
                 from (select * from public.reviews where store_id = v_s.id and status = 'visible' order by created_at desc limit 20) r), '[]'::jsonb),
    'business', (select public.mz_business_card(b) from public.businesses b where b.store_id = v_s.id and b.status = 'active' limit 1)
  );
end $$;

-- ---------------------------------------------------------------------
-- Publicaciones (vendedor)
-- ---------------------------------------------------------------------
create or replace function public.mz_apply_price(p_product public.products, p_new_price integer, p_actor uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
-- Devuelve el nuevo compare_at_cents. Solo hay "precio anterior" si el artículo
-- estaba publicado a un precio mayor (descuento real, no inventado).
declare v_compare integer;
begin
  if p_new_price = p_product.price_cents then
    return p_product.compare_at_cents;
  end if;
  if p_product.status = 'active' and p_product.published_at is not null and p_new_price < p_product.price_cents then
    v_compare := greatest(p_product.price_cents, coalesce(p_product.compare_at_cents, 0));
  elsif p_product.compare_at_cents is not null and p_new_price < p_product.compare_at_cents then
    v_compare := p_product.compare_at_cents;
  else
    v_compare := null;
  end if;
  insert into public.product_price_history (product_id, old_cents, new_cents, changed_by)
  values (p_product.id, p_product.price_cents, p_new_price, p_actor);
  return v_compare;
end $$;

create or replace function public.save_listing(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_old public.products%rowtype;
  v_is_new boolean := v_id is null;
  v_status text := coalesce(nullif(p ->> 'status', ''), 'draft');
  v_title text := trim(coalesce(p ->> 'title', ''));
  v_price integer;
  v_compare integer;
  v_condition text := p ->> 'condition';
  v_brand text := nullif(trim(coalesce(p ->> 'brand', '')), '');
  v_flaws text := nullif(trim(coalesce(p ->> 'flaws', '')), '');
  v_cat public.categories%rowtype;
  v_store uuid;
  v_tags text[];
  v_variants jsonb := coalesce(p -> 'variants', '[]'::jsonb);
  v_images jsonb := coalesce(p -> 'images', '[]'::jsonb);
  v_var jsonb;
  v_vrow public.product_variants%rowtype;
  v_vid uuid;
  v_size text;
  v_color text;
  v_qty integer;
  v_vprice integer;
  v_keep uuid[] := '{}';
  v_pos integer := 0;
  v_img jsonb;
  v_published_at timestamptz;
begin
  perform public.mz_rate_limit('listing:' || v_uid, 240, interval '1 hour');

  if v_status not in ('draft', 'active') then
    perform public.mz_fail('validation', 'Estado de publicación no válido.', '{"field":"status"}');
  end if;

  if not v_is_new then
    select * into v_old from public.products where id = v_id for update;
    if not found then perform public.mz_fail('not_found', 'La publicación no existe.'); end if;
    if v_old.seller_id <> v_uid then
      perform public.mz_fail('forbidden', 'No puedes modificar publicaciones de otros usuarios.');
    end if;
    if v_old.status = 'removed' then
      perform public.mz_fail('listing_removed', 'Esta publicación fue eliminada y no se puede editar.');
    end if;
    if v_old.moderation_status = 'blocked' and v_status = 'active' then
      perform public.mz_fail('listing_blocked', 'Esta publicación fue bloqueada por moderación y no puede publicarse.');
    end if;
  end if;

  -- Validación básica (también para borradores)
  if char_length(v_title) < 3 or char_length(v_title) > 120 then
    perform public.mz_fail('validation', 'El título debe tener entre 3 y 120 caracteres.', '{"field":"title"}');
  end if;
  begin
    v_price := round((p ->> 'price_cents')::numeric);
  exception when others then v_price := null;
  end;
  if v_price is null or v_price < 100 or v_price > 10000000 then
    perform public.mz_fail('validation', 'El precio debe estar entre $1 y $100,000.', '{"field":"price_cents"}');
  end if;
  if v_condition is null or v_condition not in ('new_with_tags', 'new_without_tags', 'used_excellent', 'used_good', 'used_flawed') then
    perform public.mz_fail('validation', 'Selecciona el estado del artículo.', '{"field":"condition"}');
  end if;
  if v_condition = 'used_flawed' and char_length(coalesce(v_flaws, '')) < 5 then
    perform public.mz_fail('validation', 'Describe los defectos del artículo (mínimo 5 caracteres).', '{"field":"flaws"}');
  end if;
  select * into v_cat from public.categories where id = p ->> 'category_id' and is_active;
  if not found then
    perform public.mz_fail('validation', 'Selecciona una categoría válida.', '{"field":"category_id"}');
  end if;
  if char_length(coalesce(p ->> 'description', '')) > 5000 then
    perform public.mz_fail('validation', 'La descripción admite hasta 5.000 caracteres.', '{"field":"description"}');
  end if;
  v_tags := coalesce((select array_agg(distinct lower(trim(t))) from jsonb_array_elements_text(coalesce(p -> 'tags', '[]'::jsonb)) t
                      where char_length(trim(t)) between 1 and 30), '{}');
  if coalesce(array_length(v_tags, 1), 0) > 15 then
    perform public.mz_fail('validation', 'Puedes añadir hasta 15 etiquetas.', '{"field":"tags"}');
  end if;
  if jsonb_typeof(v_variants) <> 'array' or jsonb_array_length(v_variants) = 0 then
    perform public.mz_fail('validation', 'Añade al menos una variante con su cantidad (por ejemplo, talla única con 1 unidad).', '{"field":"variants"}');
  end if;
  if jsonb_array_length(v_variants) > 100 then
    perform public.mz_fail('validation', 'Máximo 100 variantes por publicación.', '{"field":"variants"}');
  end if;
  if (select count(*) from jsonb_array_elements(v_variants) e) <>
     (select count(distinct (lower(coalesce(nullif(trim(e ->> 'size'), ''), '')), lower(coalesce(nullif(trim(e ->> 'color'), ''), ''))))
      from jsonb_array_elements(v_variants) e) then
    perform public.mz_fail('validation', 'Hay variantes repetidas (misma talla y color).', '{"field":"variants"}');
  end if;
  if jsonb_typeof(v_images) <> 'array' or jsonb_array_length(v_images) > 12 then
    perform public.mz_fail('validation', 'Puedes subir hasta 12 fotografías.', '{"field":"images"}');
  end if;
  if exists (select 1 from jsonb_array_elements(v_images) i where coalesce(i ->> 'url', '') !~ '^https?://') then
    perform public.mz_fail('validation', 'Las fotografías deben subirse al almacenamiento de MARKETXONE.', '{"field":"images"}');
  end if;

  -- Validación adicional para publicar
  if v_status = 'active' then
    if jsonb_array_length(v_images) = 0 then
      perform public.mz_fail('validation', 'Añade al menos una fotografía para publicar.', '{"field":"images"}');
    end if;
    if 'brand' = any (v_cat.required_fields) and v_brand is null then
      perform public.mz_fail('validation', format('La marca es obligatoria en %s.', v_cat.name), '{"field":"brand"}');
    end if;
    if 'size' = any (v_cat.required_fields)
       and exists (select 1 from jsonb_array_elements(v_variants) e where nullif(trim(coalesce(e ->> 'size', '')), '') is null) then
      perform public.mz_fail('validation', format('Indica la talla de cada variante en %s.', v_cat.name), '{"field":"variants"}');
    end if;
  end if;

  -- Tienda
  if nullif(p ->> 'store_id', '') is not null then
    select id into v_store from public.stores where id = (p ->> 'store_id')::uuid and owner_id = v_uid;
    if v_store is null then perform public.mz_fail('forbidden', 'La tienda seleccionada no te pertenece.'); end if;
  elsif not v_is_new then
    v_store := v_old.store_id;
  else
    v_store := public.mz_default_store(v_uid);
  end if;

  if v_is_new then
    v_compare := null;
    v_published_at := case when v_status = 'active' then now() end;
    insert into public.products (seller_id, store_id, category_id, title, description, brand, condition, flaws, color, material, fit,
                                 price_cents, compare_at_cents, tags, attributes, weight_grams, length_cm, width_cm, height_cm,
                                 offers_enabled, status, ai_assisted, published_at)
    values (v_uid, v_store, v_cat.id, v_title, coalesce(p ->> 'description', ''), v_brand, v_condition,
            case when v_condition = 'used_flawed' then v_flaws end,
            nullif(trim(coalesce(p ->> 'color', '')), ''), nullif(trim(coalesce(p ->> 'material', '')), ''),
            nullif(trim(coalesce(p ->> 'fit', '')), ''), v_price, null, v_tags,
            case when jsonb_typeof(p -> 'attributes') = 'object' then p -> 'attributes' else '{}'::jsonb end,
            nullif(p ->> 'weight_grams', '')::numeric::int, nullif(p ->> 'length_cm', '')::numeric,
            nullif(p ->> 'width_cm', '')::numeric, nullif(p ->> 'height_cm', '')::numeric,
            coalesce((p ->> 'offers_enabled')::boolean, true), v_status, coalesce((p ->> 'ai_assisted')::boolean, false),
            v_published_at)
    returning id into v_id;
  else
    v_compare := public.mz_apply_price(v_old, v_price, v_uid);
    update public.products set
      store_id = v_store, category_id = v_cat.id, title = v_title, description = coalesce(p ->> 'description', ''),
      brand = v_brand, condition = v_condition, flaws = case when v_condition = 'used_flawed' then v_flaws end,
      color = nullif(trim(coalesce(p ->> 'color', '')), ''), material = nullif(trim(coalesce(p ->> 'material', '')), ''),
      fit = nullif(trim(coalesce(p ->> 'fit', '')), ''), price_cents = v_price, compare_at_cents = v_compare, tags = v_tags,
      attributes = case when jsonb_typeof(p -> 'attributes') = 'object' then p -> 'attributes' else attributes end,
      weight_grams = nullif(p ->> 'weight_grams', '')::numeric::int, length_cm = nullif(p ->> 'length_cm', '')::numeric,
      width_cm = nullif(p ->> 'width_cm', '')::numeric, height_cm = nullif(p ->> 'height_cm', '')::numeric,
      offers_enabled = coalesce((p ->> 'offers_enabled')::boolean, offers_enabled),
      status = case when v_status = 'active' then 'active' when status = 'active' then 'active' else v_status end,
      ai_assisted = ai_assisted or coalesce((p ->> 'ai_assisted')::boolean, false),
      published_at = case when v_status = 'active' then coalesce(published_at, now()) else published_at end
    where id = v_id;
    -- Guardar como borrador una publicación activa la mantiene activa: para retirarla se usa "Pausar".
  end if;

  -- Variantes e inventario
  for v_var in select * from jsonb_array_elements(v_variants) loop
    v_pos := v_pos + 1;
    v_size := nullif(trim(coalesce(v_var ->> 'size', '')), '');
    v_color := nullif(trim(coalesce(v_var ->> 'color', '')), '');
    begin
      v_qty := (v_var ->> 'stock_on_hand')::int;
      v_vprice := nullif(v_var ->> 'price_cents', '')::numeric::int;
    exception when others then
      perform public.mz_fail('validation', 'Las cantidades deben ser números enteros.', '{"field":"variants"}');
    end;
    if v_qty is null or v_qty < 0 or v_qty > 100000 then
      perform public.mz_fail('validation', 'Cada variante necesita una cantidad entre 0 y 100.000.', '{"field":"variants"}');
    end if;
    if v_vprice is not null and (v_vprice < 100 or v_vprice > 10000000) then
      perform public.mz_fail('validation', 'El precio de la variante debe estar entre $1 y $100,000.', '{"field":"variants"}');
    end if;
    v_vid := null;
    select * into v_vrow from public.product_variants
    where product_id = v_id
      and (id = nullif(v_var ->> 'id', '')::uuid
           or (lower(coalesce(size, '')) = lower(coalesce(v_size, '')) and lower(coalesce(color, '')) = lower(coalesce(v_color, ''))))
    order by (id = nullif(v_var ->> 'id', '')::uuid) desc nulls last
    limit 1
    for update;
    if found then
      if v_qty < v_vrow.stock_reserved then
        perform public.mz_fail('stock_below_reserved',
          format('No puedes dejar %s en %s unidades: hay %s reservadas en pedidos pendientes.',
                 coalesce(v_size, 'la variante'), v_qty, v_vrow.stock_reserved),
          jsonb_build_object('field', 'variants', 'variant_id', v_vrow.id, 'reserved', v_vrow.stock_reserved));
      end if;
      update public.product_variants set
        size = v_size, color = v_color, sku = nullif(trim(coalesce(v_var ->> 'sku', '')), ''), price_cents = v_vprice,
        stock_on_hand = v_qty, is_active = true, position = v_pos
      where id = v_vrow.id;
      if v_qty <> v_vrow.stock_on_hand then
        perform public.mz_log_movement(v_vrow.id, 'adjustment', v_qty - v_vrow.stock_on_hand, 0, null, null, v_uid, 'Edición de publicación');
      end if;
      v_vid := v_vrow.id;
    else
      insert into public.product_variants (product_id, size, color, sku, price_cents, stock_on_hand, position)
      values (v_id, v_size, v_color, nullif(trim(coalesce(v_var ->> 'sku', '')), ''), v_vprice, v_qty, v_pos)
      returning id into v_vid;
      perform public.mz_log_movement(v_vid, 'initial', v_qty, 0, null, null, v_uid, 'Alta de variante');
    end if;
    v_keep := v_keep || v_vid;
  end loop;

  if exists (select 1 from public.product_variants where product_id = v_id and is_active and not (id = any (v_keep)) and stock_reserved > 0) then
    perform public.mz_fail('variant_has_reservations', 'No puedes quitar una variante con unidades reservadas en pedidos pendientes.', '{"field":"variants"}');
  end if;
  update public.product_variants set is_active = false where product_id = v_id and is_active and not (id = any (v_keep));

  -- Fotografías (orden según la carga)
  delete from public.product_images where product_id = v_id;
  v_pos := 0;
  for v_img in select * from jsonb_array_elements(v_images) loop
    insert into public.product_images (product_id, url, storage_path, position)
    values (v_id, v_img ->> 'url', nullif(v_img ->> 'storage_path', ''), v_pos);
    v_pos := v_pos + 1;
  end loop;

  return jsonb_build_object('id', v_id, 'status', (select status from public.products where id = v_id));
end $$;

create or replace function public.set_listing_status(p_ids uuid[], p_status text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_p public.products%rowtype;
  v_count integer := 0;
begin
  if p_status not in ('active', 'paused', 'draft', 'removed') then
    perform public.mz_fail('validation', 'Acción no válida.');
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 200 then
    perform public.mz_fail('validation', 'Selecciona entre 1 y 200 publicaciones.');
  end if;
  for v_p in select * from public.products where id = any (p_ids) order by id for update loop
    if v_p.seller_id <> v_uid then
      perform public.mz_fail('forbidden', 'No puedes modificar publicaciones de otros usuarios.');
    end if;
    if v_p.status = 'removed' then continue; end if;
    if p_status = 'active' then
      if v_p.moderation_status = 'blocked' then
        perform public.mz_fail('listing_blocked', format('"%s" fue bloqueada por moderación.', v_p.title));
      end if;
      if not exists (select 1 from public.product_images i where i.product_id = v_p.id) then
        perform public.mz_fail('validation', format('"%s" necesita al menos una fotografía para publicarse.', v_p.title));
      end if;
    end if;
    if p_status = 'removed' and exists (select 1 from public.product_variants v where v.product_id = v_p.id and v.stock_reserved > 0) then
      perform public.mz_fail('has_reservations', format('"%s" tiene unidades reservadas en pedidos pendientes. Pausa la publicación en su lugar.', v_p.title));
    end if;
    update public.products set
      status = p_status,
      published_at = case when p_status = 'active' then coalesce(published_at, now()) else published_at end
    where id = v_p.id;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('updated', v_count);
end $$;

create or replace function public.quick_update_variant(p_variant_id uuid, p_stock_on_hand integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_v public.product_variants%rowtype;
  v_seller uuid;
begin
  select v.* into v_v from public.product_variants v where v.id = p_variant_id for update;
  if not found then perform public.mz_fail('not_found', 'La variante no existe.'); end if;
  select seller_id into v_seller from public.products where id = v_v.product_id;
  if v_seller <> v_uid then perform public.mz_fail('forbidden', 'No puedes modificar el inventario de otros vendedores.'); end if;
  if p_stock_on_hand is null or p_stock_on_hand < 0 or p_stock_on_hand > 100000 then
    perform public.mz_fail('validation', 'La cantidad debe estar entre 0 y 100.000.');
  end if;
  if p_stock_on_hand < v_v.stock_reserved then
    perform public.mz_fail('stock_below_reserved',
      format('Hay %s unidades reservadas en pedidos pendientes; la cantidad no puede ser menor.', v_v.stock_reserved));
  end if;
  update public.product_variants set stock_on_hand = p_stock_on_hand where id = p_variant_id;
  if p_stock_on_hand <> v_v.stock_on_hand then
    perform public.mz_log_movement(p_variant_id, 'adjustment', p_stock_on_hand - v_v.stock_on_hand, 0, null, null, v_uid, 'Edición rápida');
  end if;
  return jsonb_build_object('id', p_variant_id, 'stock_on_hand', p_stock_on_hand, 'stock_reserved', v_v.stock_reserved,
                            'available', p_stock_on_hand - v_v.stock_reserved);
end $$;

create or replace function public.quick_update_price(p_product_id uuid, p_price_cents integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_p public.products%rowtype;
  v_compare integer;
begin
  select * into v_p from public.products where id = p_product_id for update;
  if not found then perform public.mz_fail('not_found', 'La publicación no existe.'); end if;
  if v_p.seller_id <> v_uid then perform public.mz_fail('forbidden', 'No puedes modificar publicaciones de otros usuarios.'); end if;
  if p_price_cents is null or p_price_cents < 100 or p_price_cents > 10000000 then
    perform public.mz_fail('validation', 'El precio debe estar entre $1 y $100,000.');
  end if;
  v_compare := public.mz_apply_price(v_p, p_price_cents, v_uid);
  update public.products set price_cents = p_price_cents, compare_at_cents = v_compare where id = p_product_id;
  return jsonb_build_object('id', p_product_id, 'price_cents', p_price_cents, 'compare_at_cents', v_compare);
end $$;

create or replace function public.bulk_adjust_price(p_ids uuid[], p_percent integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_p public.products%rowtype;
  v_new integer;
  v_count integer := 0;
begin
  if p_percent is null or p_percent < -90 or p_percent > 200 or p_percent = 0 then
    perform public.mz_fail('validation', 'El ajuste debe estar entre -90 % y +200 %.');
  end if;
  for v_p in select * from public.products where id = any (p_ids) order by id for update loop
    if v_p.seller_id <> v_uid then perform public.mz_fail('forbidden', 'No puedes modificar publicaciones de otros usuarios.'); end if;
    if v_p.status = 'removed' then continue; end if;
    v_new := greatest(100, least(10000000, round(v_p.price_cents * (100 + p_percent) / 100.0)::int));
    update public.products set price_cents = v_new, compare_at_cents = public.mz_apply_price(v_p, v_new, v_uid) where id = v_p.id;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('updated', v_count);
end $$;

create or replace function public.get_listing_for_edit(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_p public.products%rowtype;
begin
  select * into v_p from public.products where id = p_id;
  if not found or v_p.seller_id <> v_uid then perform public.mz_fail('not_found', 'La publicación no existe.'); end if;
  return to_jsonb(v_p) - 'search_text' || jsonb_build_object(
    'images', coalesce((select jsonb_agg(jsonb_build_object('url', i.url, 'storage_path', i.storage_path) order by i.position)
                        from public.product_images i where i.product_id = p_id), '[]'::jsonb),
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'size', v.size, 'color', v.color, 'sku', v.sku,
                                                              'price_cents', v.price_cents, 'stock_on_hand', v.stock_on_hand,
                                                              'stock_reserved', v.stock_reserved) order by v.position)
                          from public.product_variants v where v.product_id = p_id and v.is_active), '[]'::jsonb));
end $$;

create or replace function public.seller_catalog(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_q text := lower(trim(coalesce(p ->> 'q', '')));
  v_status text := coalesce(nullif(p ->> 'status', ''), 'all');
  v_cat text := nullif(p ->> 'category', '');
  v_size text := lower(nullif(trim(coalesce(p ->> 'size', '')), ''));
  v_min int := nullif(p ->> 'min_price_cents', '')::int;
  v_max int := nullif(p ->> 'max_price_cents', '')::int;
  v_from timestamptz := nullif(p ->> 'date_from', '')::timestamptz;
  v_to timestamptz := nullif(p ->> 'date_to', '')::timestamptz;
  v_avail text := coalesce(nullif(p ->> 'availability', ''), 'any');
  v_sort text := coalesce(nullif(p ->> 'sort', ''), 'updated');
  v_limit int := least(greatest(coalesce((p ->> 'limit')::int, 50), 1), 200);
  v_offset int := greatest(coalesce((p ->> 'offset')::int, 0), 0);
  v_result jsonb;
begin
  with base as (
    select pr.*,
           coalesce((select sum(v.stock_on_hand) from public.product_variants v where v.product_id = pr.id and v.is_active), 0)::int as on_hand,
           coalesce((select sum(v.stock_reserved) from public.product_variants v where v.product_id = pr.id and v.is_active), 0)::int as reserved
    from public.products pr
    where pr.seller_id = v_uid and pr.status <> 'removed'
  ), filtered as (
    select b.*, b.on_hand - b.reserved as available from base b
    where (v_q = '' or b.search_text like '%' || v_q || '%')
      and (v_cat is null or b.category_id = v_cat or b.category_id in (select id from public.categories where parent_id = v_cat))
      and (v_min is null or b.price_cents >= v_min)
      and (v_max is null or b.price_cents <= v_max)
      and (v_from is null or coalesce(b.published_at, b.created_at) >= v_from)
      and (v_to is null or coalesce(b.published_at, b.created_at) <= v_to)
      and (v_size is null or exists (select 1 from public.product_variants v where v.product_id = b.id and v.is_active and lower(v.size) = v_size))
      and (v_avail = 'any' or (v_avail = 'in_stock' and b.on_hand - b.reserved > 0) or (v_avail = 'sold_out' and b.on_hand - b.reserved <= 0))
  ), scoped as (
    select * from filtered f
    where v_status = 'all'
       or (v_status = 'sold_out' and f.status = 'active' and f.available <= 0)
       or (v_status <> 'sold_out' and f.status = v_status)
  )
  select jsonb_build_object(
    'total', (select count(*) from scoped),
    'counts', jsonb_build_object(
        'all', (select count(*) from filtered),
        'active', (select count(*) from filtered where status = 'active'),
        'draft', (select count(*) from filtered where status = 'draft'),
        'paused', (select count(*) from filtered where status = 'paused'),
        'sold_out', (select count(*) from filtered where status = 'active' and available <= 0)),
    'items', coalesce((select jsonb_agg(x.j order by x.ord) from (
        select jsonb_build_object(
          'id', s.id, 'title', s.title, 'brand', s.brand, 'status', s.status, 'moderation_status', s.moderation_status,
          'price_cents', s.price_cents, 'compare_at_cents', s.compare_at_cents, 'category_id', s.category_id,
          'condition', s.condition, 'is_demo', s.is_demo, 'published_at', s.published_at, 'updated_at', s.updated_at,
          'created_at', s.created_at, 'on_hand', s.on_hand, 'reserved', s.reserved, 'available', s.available,
          'image_url', (select i.url from public.product_images i where i.product_id = s.id order by i.position limit 1),
          'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'size', v.size, 'color', v.color, 'sku', v.sku,
                                    'stock_on_hand', v.stock_on_hand, 'stock_reserved', v.stock_reserved,
                                    'available', v.stock_on_hand - v.stock_reserved) order by v.position)
                                from public.product_variants v where v.product_id = s.id and v.is_active), '[]'::jsonb),
          'offers_pending', (select count(*) from public.offers o where o.product_id = s.id and o.status = 'pending')
        ) as j,
        row_number() over (order by
          case when v_sort = 'price_asc' then s.price_cents end asc,
          case when v_sort = 'price_desc' then s.price_cents end desc,
          case when v_sort = 'stock_asc' then s.available end asc,
          case when v_sort = 'published' then s.published_at end desc nulls last,
          s.updated_at desc) as ord
        from scoped s order by ord limit v_limit offset v_offset) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

create or replace function public.inventory_history(p_product_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user();
begin
  if not exists (select 1 from public.products where id = p_product_id and (seller_id = v_uid or public.is_admin())) then
    perform public.mz_fail('not_found', 'La publicación no existe.');
  end if;
  return coalesce((select jsonb_agg(x.j order by x.id desc) from (
    select m.id, jsonb_build_object('id', m.id, 'kind', m.kind, 'on_hand_delta', m.on_hand_delta, 'reserved_delta', m.reserved_delta,
             'on_hand_after', m.on_hand_after, 'reserved_after', m.reserved_after, 'note', m.note, 'created_at', m.created_at,
             'order_id', m.order_id, 'size', v.size, 'color', v.color) as j
    from public.inventory_movements m join public.product_variants v on v.id = m.variant_id
    where m.product_id = p_product_id order by m.id desc limit 200) x), '[]'::jsonb);
end $$;
