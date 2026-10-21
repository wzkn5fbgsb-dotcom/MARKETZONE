-- =====================================================================
-- MARKETZONE · 0500 · Panel del vendedor, negocios, campañas, analítica,
-- reseñas, reportes y administración.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Panel del vendedor: indicadores separando dinero real y de prueba
-- ---------------------------------------------------------------------
create or replace function public.mz_money_block(p_seller uuid, p_test boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'gross_cents', coalesce(sum(so.subtotal_cents) filter (where so.status in ('paid', 'preparing', 'shipped', 'delivered', 'refunded')), 0),
    'refunds_cents', coalesce(sum(so.subtotal_cents) filter (where so.status = 'refunded'), 0),
    'commission_cents', coalesce(sum(so.commission_cents) filter (where so.status in ('paid', 'preparing', 'shipped', 'delivered')), 0),
    'net_estimated_cents', coalesce(sum(so.seller_net_cents) filter (where so.status in ('paid', 'preparing', 'shipped', 'delivered')), 0),
    'pending_settlement_cents', coalesce(sum(so.seller_net_cents) filter (where so.payout_status = 'pending' and so.status <> 'refunded'), 0),
    'paid_out_cents', coalesce(sum(so.seller_net_cents) filter (where so.payout_status = 'paid_out'), 0),
    'pending_payment_cents', coalesce(sum(so.subtotal_cents) filter (where so.status = 'pending_payment'), 0)
  )
  from public.seller_orders so join public.orders o on o.id = so.order_id
  where so.seller_id = p_seller and o.is_test = p_test;
$$;

create or replace function public.seller_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user();
begin
  return jsonb_build_object(
    'listings', (
      select jsonb_build_object(
        'active', count(*) filter (where p.status = 'active'),
        'draft', count(*) filter (where p.status = 'draft'),
        'paused', count(*) filter (where p.status = 'paused'),
        'sold_out', count(*) filter (where p.status = 'active' and coalesce(st.available, 0) <= 0),
        'blocked', count(*) filter (where p.moderation_status = 'blocked'),
        'units_available', coalesce(sum(st.available) filter (where p.status = 'active'), 0),
        'units_reserved', coalesce(sum(st.reserved), 0))
      from public.products p
      left join lateral (select sum(v.stock_on_hand - v.stock_reserved)::int as available, sum(v.stock_reserved)::int as reserved
                         from public.product_variants v where v.product_id = p.id and v.is_active) st on true
      where p.seller_id = v_uid and p.status <> 'removed'),
    'orders', (
      select jsonb_build_object(
        'pending_payment', count(*) filter (where so.status = 'pending_payment'),
        'to_ship', count(*) filter (where so.status in ('paid', 'preparing')),
        'shipped', count(*) filter (where so.status = 'shipped'),
        'completed', count(*) filter (where so.status = 'delivered'),
        'cancelled', count(*) filter (where so.status = 'cancelled'),
        'refunded', count(*) filter (where so.status = 'refunded'))
      from public.seller_orders so where so.seller_id = v_uid),
    'money_real', public.mz_money_block(v_uid, false),
    'money_test', public.mz_money_block(v_uid, true),
    'offers', (
      select jsonb_build_object(
        'awaiting_you', count(*) filter (where o.status = 'pending'),
        'awaiting_buyer', count(*) filter (where o.status = 'countered'),
        'accepted_unpaid', count(*) filter (where o.status = 'accepted'))
      from public.offers o where o.seller_id = v_uid),
    'campaigns', (select jsonb_build_object('active', count(*) filter (where c.status = 'active'),
                                            'pending', count(*) filter (where c.status in ('pending_review', 'pending_payment')))
                  from public.campaigns c where c.owner_id = v_uid),
    'views_30d', (select count(*) from public.analytics_events e join public.products p on p.id = e.product_id
                  where p.seller_id = v_uid and e.kind = 'product_view' and e.created_at > now() - interval '30 days'),
    'settings', public.public_settings(),
    'stores', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.name) order by s.created_at)
                        from public.stores s where s.owner_id = v_uid), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- Negocios (páginas comerciales)
-- ---------------------------------------------------------------------
create or replace function public.save_business(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_slug text := lower(trim(coalesce(p ->> 'slug', '')));
  v_store uuid := nullif(p ->> 'store_id', '')::uuid;
  v_row public.businesses%rowtype;
begin
  perform public.mz_rate_limit('business:' || v_uid, 60, interval '1 hour');
  if v_slug !~ '^[a-z0-9][a-z0-9-]{2,39}$' then
    perform public.mz_fail('validation', 'La dirección del negocio debe tener 3–40 caracteres: minúsculas, números y guiones.', '{"field":"slug"}');
  end if;
  if exists (select 1 from public.businesses where lower(slug) = v_slug and id is distinct from v_id) then
    perform public.mz_fail('slug_taken', 'Esa dirección ya está en uso.', '{"field":"slug"}');
  end if;
  if v_store is not null and not exists (select 1 from public.stores where id = v_store and owner_id = v_uid) then
    perform public.mz_fail('forbidden', 'Solo puedes vincular tus propias tiendas.', '{"field":"store_id"}');
  end if;
  if v_id is null and (select count(*) from public.businesses where owner_id = v_uid) >= 5 then
    perform public.mz_fail('limit_reached', 'Puedes registrar hasta 5 negocios por cuenta.');
  end if;
  begin
    if v_id is null then
      insert into public.businesses (owner_id, store_id, slug, name, logo_url, cover_url, description, category, location,
                                     contact, hours, social_links, customer_info)
      values (v_uid, v_store, v_slug, trim(p ->> 'name'), nullif(p ->> 'logo_url', ''), nullif(p ->> 'cover_url', ''),
              coalesce(p ->> 'description', ''), coalesce(nullif(p ->> 'category', ''), 'otro'), nullif(trim(coalesce(p ->> 'location', '')), ''),
              coalesce(p -> 'contact', '{}'::jsonb), coalesce(p -> 'hours', '{}'::jsonb), coalesce(p -> 'social_links', '{}'::jsonb),
              nullif(trim(coalesce(p ->> 'customer_info', '')), ''))
      returning * into v_row;
    else
      update public.businesses set
        store_id = v_store, slug = v_slug, name = trim(p ->> 'name'), logo_url = nullif(p ->> 'logo_url', ''),
        cover_url = nullif(p ->> 'cover_url', ''), description = coalesce(p ->> 'description', ''),
        category = coalesce(nullif(p ->> 'category', ''), category), location = nullif(trim(coalesce(p ->> 'location', '')), ''),
        contact = coalesce(p -> 'contact', contact), hours = coalesce(p -> 'hours', hours),
        social_links = coalesce(p -> 'social_links', social_links), customer_info = nullif(trim(coalesce(p ->> 'customer_info', '')), '')
      where id = v_id and owner_id = v_uid
      returning * into v_row;
      if not found then perform public.mz_fail('forbidden', 'No puedes modificar negocios de otros usuarios.'); end if;
    end if;
  exception
    when check_violation or not_null_violation then
      perform public.mz_fail('validation', 'Revisa los datos del negocio: nombre (2–80 caracteres), categoría y descripción (máx. 2.000).');
  end;
  return to_jsonb(v_row);
end $$;

create or replace function public.get_business(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_b public.businesses%rowtype;
begin
  select * into v_b from public.businesses where lower(slug) = lower(p_slug);
  if not found or (v_b.status <> 'active' and v_b.owner_id is distinct from v_uid and not public.is_admin()) then
    perform public.mz_fail('not_found', 'Este negocio no existe.');
  end if;
  return jsonb_build_object(
    'business', to_jsonb(v_b),
    'is_owner', v_b.owner_id = v_uid,
    'store', (select public.mz_store_card(s) from public.stores s where s.id = v_b.store_id and s.status = 'active'),
    'products', coalesce((select jsonb_agg(x.card) from (
                   select public.mz_card(p) as card from public.mz_public_products() p
                   where v_b.store_id is not null and p.store_id = v_b.store_id order by p.published_at desc limit 24) x), '[]'::jsonb),
    'promotions', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'headline', c.headline, 'body', c.body,
                                                                'ends_at', c.ends_at, 'is_test', c.is_test) order by c.starts_at desc)
                            from public.campaigns c where c.business_id = v_b.id and c.status = 'active' and c.ends_at > now()), '[]'::jsonb)
  );
end $$;

create or replace function public.list_businesses(p jsonb default '{}'::jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x.card order by x.sponsored desc, x.created_at desc), '[]'::jsonb) from (
    select public.mz_business_card(b) || jsonb_build_object('sponsored', c.id is not null, 'campaign_id', c.id) as card,
           c.id is not null as sponsored, b.created_at
    from public.businesses b
    left join lateral (select id from public.campaigns cc where cc.business_id = b.id and cc.status = 'active'
                       and cc.ends_at > now() order by cc.starts_at desc limit 1) c on true
    where b.status = 'active'
      and (nullif(p ->> 'category', '') is null or b.category = p ->> 'category')
      and (nullif(trim(coalesce(p ->> 'q', '')), '') is null
           or lower(b.name || ' ' || b.description) like '%' || lower(trim(p ->> 'q')) || '%')
    limit 100) x;
$$;

-- ---------------------------------------------------------------------
-- Campañas de promoción
-- ---------------------------------------------------------------------
create or replace function public.mz_campaign_json(c public.campaigns) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(c) || jsonb_build_object(
    'business', (select jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name) from public.businesses b where b.id = c.business_id),
    'store', (select jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.name) from public.stores s where s.id = c.store_id),
    'product', (select public.mz_card(p) from public.products p where p.id = c.product_id),
    'stats', jsonb_build_object(
      'impressions', (select count(*) from public.analytics_events e where e.campaign_id = c.id and e.kind = 'impression'),
      'clicks', (select count(*) from public.analytics_events e where e.campaign_id = c.id and e.kind = 'click'))
  );
$$;

create or replace function public.save_campaign(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_settings public.platform_settings%rowtype := public.mz_settings();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_kind text := p ->> 'kind';
  v_business uuid := nullif(p ->> 'business_id', '')::uuid;
  v_store uuid := nullif(p ->> 'store_id', '')::uuid;
  v_product uuid := nullif(p ->> 'product_id', '')::uuid;
  v_category text := nullif(p ->> 'category_id', '');
  v_budget integer := nullif(p ->> 'budget_cents', '')::numeric::int;
  v_days integer := nullif(p ->> 'duration_days', '')::int;
  v_old public.campaigns%rowtype;
  v_row public.campaigns%rowtype;
begin
  perform public.mz_rate_limit('campaign:' || v_uid, 60, interval '1 hour');
  if v_id is not null then
    select * into v_old from public.campaigns where id = v_id for update;
    if not found or v_old.owner_id <> v_uid then perform public.mz_fail('not_found', 'La campaña no existe.'); end if;
    if v_old.status not in ('draft', 'rejected') then
      perform public.mz_fail('not_editable', 'Solo puedes editar campañas en borrador o rechazadas.');
    end if;
  end if;
  if v_kind is null or v_kind not in ('home_store', 'promoted_product', 'category_spotlight', 'temporary_promo', 'featured_offer') then
    perform public.mz_fail('validation', 'Selecciona el tipo de promoción.', '{"field":"kind"}');
  end if;
  if v_business is not null and not exists (select 1 from public.businesses where id = v_business and owner_id = v_uid) then
    perform public.mz_fail('forbidden', 'Solo puedes promocionar tus propios negocios.', '{"field":"business_id"}');
  end if;
  if v_store is not null and not exists (select 1 from public.stores where id = v_store and owner_id = v_uid) then
    perform public.mz_fail('forbidden', 'Solo puedes promocionar tus propias tiendas.', '{"field":"store_id"}');
  end if;
  if v_product is not null and not exists (select 1 from public.products where id = v_product and seller_id = v_uid and status <> 'removed') then
    perform public.mz_fail('forbidden', 'Solo puedes promocionar tus propios productos.', '{"field":"product_id"}');
  end if;
  if v_kind in ('promoted_product', 'featured_offer', 'category_spotlight') and v_product is null then
    perform public.mz_fail('validation', 'Elige el producto que quieres promocionar.', '{"field":"product_id"}');
  end if;
  if v_kind = 'category_spotlight' then
    v_category := coalesce(v_category, (select category_id from public.products where id = v_product));
  end if;
  if v_kind in ('home_store', 'temporary_promo') and v_business is null and v_store is null then
    perform public.mz_fail('validation', 'Elige el negocio o la tienda que quieres promocionar.', '{"field":"business_id"}');
  end if;
  if v_budget is null or v_budget < v_settings.min_campaign_cents or v_budget > 100000000 then
    perform public.mz_fail('validation', format('El presupuesto mínimo es %s.', public.mz_money(v_settings.min_campaign_cents)), '{"field":"budget_cents"}');
  end if;
  if v_days is null or v_days < 1 or v_days > 90 then
    perform public.mz_fail('validation', 'La duración debe estar entre 1 y 90 días.', '{"field":"duration_days"}');
  end if;
  if char_length(trim(coalesce(p ->> 'headline', ''))) not between 3 and 80 then
    perform public.mz_fail('validation', 'El titular debe tener entre 3 y 80 caracteres.', '{"field":"headline"}');
  end if;
  if char_length(coalesce(p ->> 'body', '')) > 300 then
    perform public.mz_fail('validation', 'El texto admite hasta 300 caracteres.', '{"field":"body"}');
  end if;
  if v_id is null then
    insert into public.campaigns (owner_id, business_id, store_id, product_id, kind, category_id, headline, body, budget_cents, duration_days)
    values (v_uid, v_business, v_store, v_product, v_kind, v_category, trim(p ->> 'headline'), nullif(trim(coalesce(p ->> 'body', '')), ''),
            v_budget, v_days)
    returning * into v_row;
  else
    update public.campaigns set business_id = v_business, store_id = v_store, product_id = v_product, kind = v_kind,
      category_id = v_category, headline = trim(p ->> 'headline'), body = nullif(trim(coalesce(p ->> 'body', '')), ''),
      budget_cents = v_budget, duration_days = v_days, status = 'draft', review_note = null
    where id = v_id returning * into v_row;
  end if;
  return public.mz_campaign_json(v_row);
end $$;

create or replace function public.submit_campaign(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_c public.campaigns%rowtype;
  r record;
begin
  update public.campaigns set status = 'pending_review' where id = p_id and owner_id = v_uid and status = 'draft' returning * into v_c;
  if not found then perform public.mz_fail('invalid_transition', 'Solo puedes enviar a revisión campañas en borrador.'); end if;
  for r in select id from public.profiles where role = 'admin' and status = 'active' loop
    perform public.mz_notify(r.id, 'campaign_review', 'Campaña pendiente de revisión', v_c.headline, '/admin');
  end loop;
  return public.mz_campaign_json(v_c);
end $$;

create or replace function public.pay_campaign_test(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_settings public.platform_settings%rowtype := public.mz_settings();
  v_c public.campaigns%rowtype;
begin
  select * into v_c from public.campaigns where id = p_id for update;
  if not found or v_c.owner_id <> v_uid then perform public.mz_fail('not_found', 'La campaña no existe.'); end if;
  if v_c.status <> 'pending_payment' then
    perform public.mz_fail('invalid_transition', 'La campaña debe estar aprobada y pendiente de pago.');
  end if;
  if not v_settings.test_mode then
    perform public.mz_fail('test_mode_disabled', 'Los pagos de prueba están desactivados; el pago real requiere el proveedor de pagos.');
  end if;
  insert into public.payments (campaign_id, payer_id, provider, provider_ref, amount_cents, status, is_test)
  values (v_c.id, v_uid, 'test', 'test_' || replace(gen_random_uuid()::text, '-', ''), v_c.budget_cents, 'succeeded', true);
  update public.campaigns set status = 'active', is_test = true, starts_at = now(),
                              ends_at = now() + make_interval(days => v_c.duration_days)
  where id = v_c.id returning * into v_c;
  return public.mz_campaign_json(v_c);
end $$;

create or replace function public.mark_campaign_paid(p_id uuid, p_provider text, p_provider_ref text, p_amount_cents integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c public.campaigns%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user <> 'postgres' then
    perform public.mz_fail('forbidden', 'Solo el servidor puede confirmar pagos.');
  end if;
  if exists (select 1 from public.payments where provider = p_provider and provider_ref = p_provider_ref) then
    return jsonb_build_object('campaign_id', p_id, 'duplicate', true);
  end if;
  select * into v_c from public.campaigns where id = p_id for update;
  if not found then perform public.mz_fail('not_found', 'Campaña inexistente.'); end if;
  if p_amount_cents <> v_c.budget_cents or v_c.status <> 'pending_payment' then
    insert into public.payments (campaign_id, payer_id, provider, provider_ref, amount_cents, status, is_test)
    values (v_c.id, v_c.owner_id, p_provider, p_provider_ref, p_amount_cents, 'failed', false);
    return jsonb_build_object('campaign_id', p_id, 'error', 'amount_or_status_mismatch');
  end if;
  insert into public.payments (campaign_id, payer_id, provider, provider_ref, amount_cents, status, is_test)
  values (v_c.id, v_c.owner_id, p_provider, p_provider_ref, p_amount_cents, 'succeeded', false);
  update public.campaigns set status = 'active', is_test = false, starts_at = now(), ends_at = now() + make_interval(days => v_c.duration_days)
  where id = v_c.id;
  return jsonb_build_object('campaign_id', p_id, 'status', 'active');
end $$;

create or replace function public.set_campaign_paused(p_id uuid, p_paused boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_c public.campaigns%rowtype;
begin
  update public.campaigns set status = case when p_paused then 'paused' else 'active' end
  where id = p_id and owner_id = v_uid and status = case when p_paused then 'active' else 'paused' end and ends_at > now()
  returning * into v_c;
  if not found then perform public.mz_fail('invalid_transition', 'No se puede cambiar el estado de esta campaña.'); end if;
  return public.mz_campaign_json(v_c);
end $$;

create or replace function public.delete_campaign(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user();
begin
  delete from public.campaigns where id = p_id and owner_id = v_uid and status in ('draft', 'rejected');
  if not found then perform public.mz_fail('invalid_transition', 'Solo puedes eliminar campañas en borrador o rechazadas.'); end if;
end $$;

create or replace function public.my_campaigns() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user();
begin
  return coalesce((select jsonb_agg(public.mz_campaign_json(c) order by c.created_at desc)
                   from public.campaigns c where c.owner_id = v_uid), '[]'::jsonb);
end $$;

create or replace function public.campaign_stats(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_c public.campaigns%rowtype;
  v_imp integer;
  v_clicks integer;
begin
  select * into v_c from public.campaigns where id = p_id;
  if not found or (v_c.owner_id <> v_uid and not public.is_admin()) then perform public.mz_fail('not_found', 'La campaña no existe.'); end if;
  select count(*) filter (where kind = 'impression'), count(*) filter (where kind = 'click')
  into v_imp, v_clicks from public.analytics_events where campaign_id = p_id;
  return jsonb_build_object(
    'campaign', public.mz_campaign_json(v_c),
    'impressions', v_imp,
    'clicks', v_clicks,
    'ctr', case when v_imp > 0 then round(v_clicks::numeric * 100 / v_imp, 2) end,
    'product_views', (select count(*) from public.analytics_events e where e.campaign_id = p_id and e.kind in ('product_view', 'store_view', 'business_view')),
    'new_followers', (select count(*) from public.follows f where v_c.store_id is not null and f.store_id = v_c.store_id
                      and v_c.starts_at is not null and f.created_at >= v_c.starts_at),
    'attributed_sales', null,
    'attribution_note', 'Las ventas atribuidas se mostrarán cuando exista un sistema de atribución fiable. Las impresiones no equivalen a ventas.',
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'impressions', d.imp, 'clicks', d.clk) order by d.day)
                       from (select date_trunc('day', created_at)::date as day,
                                    count(*) filter (where kind = 'impression') as imp,
                                    count(*) filter (where kind = 'click') as clk
                             from public.analytics_events where campaign_id = p_id group by 1) d), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- Analítica (eventos de interacción, con límites anti-abuso)
-- ---------------------------------------------------------------------
create or replace function public.track_event(p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_kind text := p ->> 'kind';
  v_session text := left(coalesce(nullif(p ->> 'session_id', ''), 'anon'), 64);
  v_campaign uuid := nullif(p ->> 'campaign_id', '')::uuid;
  v_product uuid := nullif(p ->> 'product_id', '')::uuid;
  v_store uuid := nullif(p ->> 'store_id', '')::uuid;
  v_business uuid := nullif(p ->> 'business_id', '')::uuid;
begin
  if v_kind not in ('impression', 'click', 'product_view', 'store_view', 'business_view') then return; end if;
  begin
    perform public.mz_rate_limit('evt:' || coalesce(auth.uid()::text, v_session), 400, interval '10 minutes');
  exception when others then
    return; -- se descarta en silencio: la analítica nunca bloquea la navegación
  end;
  if v_campaign is not null and not exists (select 1 from public.campaigns where id = v_campaign and status = 'active') then
    v_campaign := null;
    if v_kind in ('impression', 'click') then return; end if;
  end if;
  -- Una impresión por sesión y campaña cada 30 minutos.
  if v_kind = 'impression' and exists (
      select 1 from public.analytics_events where kind = 'impression' and campaign_id = v_campaign and session_id = v_session
      and created_at > now() - interval '30 minutes') then
    return;
  end if;
  insert into public.analytics_events (kind, product_id, store_id, business_id, campaign_id, user_id, session_id)
  values (v_kind, v_product, v_store, v_business, v_campaign, auth.uid(), v_session);
end $$;

-- ---------------------------------------------------------------------
-- Reseñas y reportes
-- ---------------------------------------------------------------------
create or replace function public.create_review(p_seller_order_id uuid, p_rating integer, p_body text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_so public.seller_orders%rowtype;
  v_o public.orders%rowtype;
  v_row public.reviews%rowtype;
begin
  perform public.mz_rate_limit('review:' || v_uid, 20, interval '1 day');
  select * into v_so from public.seller_orders where id = p_seller_order_id;
  if not found then perform public.mz_fail('not_found', 'El pedido no existe.'); end if;
  select * into v_o from public.orders where id = v_so.order_id;
  if v_o.buyer_id <> v_uid then perform public.mz_fail('forbidden', 'Solo quien compró puede calificar este pedido.'); end if;
  if v_so.status <> 'delivered' then perform public.mz_fail('not_delivered', 'Podrás calificar la compra cuando se haya entregado.'); end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then perform public.mz_fail('validation', 'La calificación debe estar entre 1 y 5.'); end if;
  if char_length(coalesce(p_body, '')) > 1000 then perform public.mz_fail('validation', 'La reseña admite hasta 1.000 caracteres.'); end if;
  begin
    insert into public.reviews (seller_order_id, reviewer_id, seller_id, store_id, rating, body, is_test)
    values (v_so.id, v_uid, v_so.seller_id, v_so.store_id, p_rating, nullif(trim(coalesce(p_body, '')), ''), v_o.is_test)
    returning * into v_row;
  exception when unique_violation then
    perform public.mz_fail('already_reviewed', 'Ya calificaste esta compra.');
  end;
  perform public.mz_notify(v_so.seller_id, 'review', format('Nueva reseña: %s/5', p_rating), left(coalesce(p_body, ''), 120), '/panel');
  return to_jsonb(v_row);
end $$;

create or replace function public.create_report(p_target_type text, p_target_id uuid, p_reason text, p_details text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_row public.reports%rowtype;
begin
  perform public.mz_rate_limit('report:' || v_uid, 10, interval '1 day');
  if p_target_type not in ('product', 'store', 'business', 'user', 'review', 'campaign') then
    perform public.mz_fail('validation', 'Tipo de reporte no válido.');
  end if;
  if p_reason not in ('prohibited', 'counterfeit', 'scam', 'offensive', 'spam', 'other') then
    perform public.mz_fail('validation', 'Selecciona un motivo.');
  end if;
  begin
    insert into public.reports (reporter_id, target_type, target_id, reason, details)
    values (v_uid, p_target_type, p_target_id, p_reason, nullif(trim(coalesce(p_details, '')), ''))
    returning * into v_row;
  exception when unique_violation then
    perform public.mz_fail('already_reported', 'Ya enviaste un reporte sobre esto. Lo estamos revisando.');
  when check_violation then
    perform public.mz_fail('validation', 'Los detalles admiten hasta 1.000 caracteres.');
  end;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end $$;

-- ---------------------------------------------------------------------
-- Administración (permisos verificados en el servidor en cada función)
-- ---------------------------------------------------------------------
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.mz_require_admin();
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'suspended_users', (select count(*) from public.profiles where status = 'suspended'),
    'sellers', (select count(distinct seller_id) from public.products where status <> 'removed'),
    'stores', (select count(*) from public.stores),
    'businesses', (select count(*) from public.businesses),
    'products', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.products group by status) x),
    'blocked_products', (select count(*) from public.products where moderation_status = 'blocked'),
    'orders_real', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.orders where not is_test group by status) x),
    'orders_test', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.orders where is_test group by status) x),
    'gmv_real_cents', (select coalesce(sum(subtotal_cents), 0) from public.orders where not is_test and status in ('paid', 'partially_refunded')),
    'gmv_test_cents', (select coalesce(sum(subtotal_cents), 0) from public.orders where is_test and status in ('paid', 'partially_refunded')),
    'commission_real_cents', (select coalesce(sum(so.commission_cents), 0) from public.seller_orders so join public.orders o on o.id = so.order_id
                              where not o.is_test and so.status in ('paid', 'preparing', 'shipped', 'delivered')),
    'commission_test_cents', (select coalesce(sum(so.commission_cents), 0) from public.seller_orders so join public.orders o on o.id = so.order_id
                              where o.is_test and so.status in ('paid', 'preparing', 'shipped', 'delivered')),
    'open_offers', (select count(*) from public.offers where status in ('pending', 'countered', 'accepted')),
    'open_reports', (select count(*) from public.reports where status in ('open', 'reviewing')),
    'campaigns_pending_review', (select count(*) from public.campaigns where status = 'pending_review'),
    'campaigns_active', (select count(*) from public.campaigns where status = 'active'),
    'refunds_pending', (select count(*) from public.refunds where status = 'pending'),
    'settings', (select to_jsonb(s) from public.platform_settings s where s.id = 1)
  );
end $$;

create or replace function public.admin_list(p_entity text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_q text := lower(trim(coalesce(p ->> 'q', '')));
  v_status text := nullif(p ->> 'status', '');
  v_limit int := least(greatest(coalesce((p ->> 'limit')::int, 50), 1), 200);
  v_offset int := greatest(coalesce((p ->> 'offset')::int, 0), 0);
  v_items jsonb;
begin
  perform public.mz_require_admin();
  case p_entity
    when 'users' then
      select coalesce(jsonb_agg(x.j), '[]'::jsonb) into v_items from (
        select jsonb_build_object('id', pr.id, 'username', pr.username, 'display_name', pr.display_name, 'role', pr.role,
                                  'status', pr.status, 'created_at', pr.created_at,
                                  'email', (select u.email from auth.users u where u.id = pr.id),
                                  'products', (select count(*) from public.products pp where pp.seller_id = pr.id and pp.status <> 'removed')) j
        from public.profiles pr
        where (v_q = '' or lower(pr.username || ' ' || pr.display_name) like '%' || v_q || '%') and (v_status is null or pr.status = v_status)
        order by pr.created_at desc limit v_limit offset v_offset) x;
    when 'stores' then
      select coalesce(jsonb_agg(x.j), '[]'::jsonb) into v_items from (
        select public.mz_store_card(s) || jsonb_build_object('status', s.status, 'created_at', s.created_at) j
        from public.stores s where (v_q = '' or lower(s.name || ' ' || s.slug) like '%' || v_q || '%') and (v_status is null or s.status = v_status)
        order by s.created_at desc limit v_limit offset v_offset) x;
    when 'businesses' then
      select coalesce(jsonb_agg(x.j), '[]'::jsonb) into v_items from (
        select to_jsonb(b) j from public.businesses b
        where (v_q = '' or lower(b.name || ' ' || b.slug) like '%' || v_q || '%') and (v_status is null or b.status = v_status)
        order by b.created_at desc limit v_limit offset v_offset) x;
    when 'products' then
      select coalesce(jsonb_agg(x.j), '[]'::jsonb) into v_items from (
        select public.mz_card(pp) || jsonb_build_object('moderation_status', pp.moderation_status, 'moderation_note', pp.moderation_note) j
        from public.products pp
        where (v_q = '' or pp.search_text like '%' || v_q || '%')
          and (v_status is null or pp.status = v_status or (v_status = 'blocked' and pp.moderation_status = 'blocked'))
        order by pp.created_at desc limit v_limit offset v_offset) x;
    when 'orders' then
      select coalesce(jsonb_agg(x.j), '[]'::jsonb) into v_items from (
        select jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'is_test', o.is_test, 'total_cents', o.total_cents,
                                  'source', o.source, 'created_at', o.created_at,
                                  'buyer', (select pr.username from public.profiles pr where pr.id = o.buyer_id),
                                  'sellers', (select jsonb_agg(jsonb_build_object('username', pr.username, 'status', so.status,
                                                     'commission_cents', so.commission_cents))
                                              from public.seller_orders so join public.profiles pr on pr.id = so.seller_id where so.order_id = o.id)) j
        from public.orders o where (v_status is null or o.status = v_status) and (v_q = '' or o.number::text like v_q || '%')
        order by o.created_at desc limit v_limit offset v_offset) x;
    when 'offers' then
      select coalesce(jsonb_agg(x.j), '[]'::jsonb) into v_items from (
        select public.mz_offer_json(o) j from public.offers o where (v_status is null or o.status = v_status)
        order by o.updated_at desc limit v_limit offset v_offset) x;
    when 'campaigns' then
      select coalesce(jsonb_agg(x.j), '[]'::jsonb) into v_items from (
        select public.mz_campaign_json(c) || jsonb_build_object('owner', (select pr.username from public.profiles pr where pr.id = c.owner_id)) j
        from public.campaigns c where (v_status is null or c.status = v_status)
        order by case when c.status = 'pending_review' then 0 else 1 end, c.created_at desc limit v_limit offset v_offset) x;
    when 'reports' then
      select coalesce(jsonb_agg(x.j), '[]'::jsonb) into v_items from (
        select to_jsonb(r) || jsonb_build_object('reporter', (select pr.username from public.profiles pr where pr.id = r.reporter_id)) j
        from public.reports r where (v_status is null or r.status = v_status)
        order by case when r.status in ('open', 'reviewing') then 0 else 1 end, r.created_at desc limit v_limit offset v_offset) x;
    when 'payments' then
      select coalesce(jsonb_agg(x.j), '[]'::jsonb) into v_items from (
        select to_jsonb(pm) || jsonb_build_object('order_number', (select o.number from public.orders o where o.id = pm.order_id)) j
        from public.payments pm where (v_status is null or pm.status = v_status)
        order by pm.created_at desc limit v_limit offset v_offset) x;
    when 'audit' then
      select coalesce(jsonb_agg(x.j), '[]'::jsonb) into v_items from (
        select to_jsonb(a) || jsonb_build_object('actor', (select pr.username from public.profiles pr where pr.id = a.actor_id)) j
        from public.admin_audit_log a order by a.id desc limit v_limit offset v_offset) x;
    else
      perform public.mz_fail('validation', 'Entidad no válida.');
  end case;
  return jsonb_build_object('items', v_items);
end $$;

create or replace function public.admin_update_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_admin();
  v_s public.platform_settings%rowtype := public.mz_settings();
begin
  if p ? 'test_mode' and not (p ->> 'test_mode')::boolean and not v_s.real_payments_ready then
    perform public.mz_fail('payments_not_ready', 'No puedes desactivar el modo de prueba hasta integrar y verificar el proveedor de pagos.');
  end if;
  begin
    update public.platform_settings set
      commission_bps = coalesce((p ->> 'commission_bps')::int, commission_bps),
      shipping_flat_cents = coalesce((p ->> 'shipping_flat_cents')::int, shipping_flat_cents),
      checkout_hold_minutes = coalesce((p ->> 'checkout_hold_minutes')::int, checkout_hold_minutes),
      offer_response_minutes = coalesce((p ->> 'offer_response_minutes')::int, offer_response_minutes),
      offer_payment_minutes = coalesce((p ->> 'offer_payment_minutes')::int, offer_payment_minutes),
      min_offer_percent = coalesce((p ->> 'min_offer_percent')::int, min_offer_percent),
      min_campaign_cents = coalesce((p ->> 'min_campaign_cents')::int, min_campaign_cents),
      test_mode = coalesce((p ->> 'test_mode')::boolean, test_mode),
      updated_at = now(), updated_by = v_uid
    where id = 1;
  exception when check_violation then
    perform public.mz_fail('validation', 'Algún valor está fuera del rango permitido.');
  end;
  perform public.mz_audit('update_settings', 'platform_settings', '1', p);
  return (select to_jsonb(s) from public.platform_settings s where s.id = 1);
end $$;

create or replace function public.admin_moderate(p_entity text, p_id uuid, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_admin();
  v_target uuid;
begin
  case
    when p_entity = 'product' and p_action in ('block', 'unblock') then
      update public.products set moderation_status = case when p_action = 'block' then 'blocked' else 'ok' end,
                                 moderation_note = nullif(trim(coalesce(p_note, '')), '')
      where id = p_id returning seller_id into v_target;
      if v_target is not null then
        perform public.mz_notify(v_target, 'moderation',
          case when p_action = 'block' then 'Una publicación fue bloqueada' else 'Una publicación fue desbloqueada' end,
          p_note, '/panel/catalogo');
      end if;
    when p_entity = 'store' and p_action in ('suspend', 'activate') then
      update public.stores set status = case when p_action = 'suspend' then 'suspended' else 'active' end where id = p_id returning owner_id into v_target;
    when p_entity = 'business' and p_action in ('suspend', 'activate') then
      update public.businesses set status = case when p_action = 'suspend' then 'suspended' else 'active' end where id = p_id returning owner_id into v_target;
    when p_entity = 'user' and p_action in ('suspend', 'activate') then
      if p_id = v_uid then perform public.mz_fail('validation', 'No puedes suspender tu propia cuenta.'); end if;
      update public.profiles set status = case when p_action = 'suspend' then 'suspended' else 'active' end where id = p_id returning id into v_target;
    when p_entity = 'user' and p_action in ('make_admin', 'remove_admin') then
      if p_id = v_uid then perform public.mz_fail('validation', 'No puedes cambiar tu propio rol.'); end if;
      update public.profiles set role = case when p_action = 'make_admin' then 'admin' else 'user' end where id = p_id returning id into v_target;
    when p_entity = 'review' and p_action in ('hide', 'show') then
      update public.reviews set status = case when p_action = 'hide' then 'hidden' else 'visible' end where id = p_id returning reviewer_id into v_target;
    when p_entity = 'report' and p_action in ('reviewing', 'resolved', 'dismissed') then
      update public.reports set status = p_action, resolution_note = nullif(trim(coalesce(p_note, '')), ''),
                                resolved_by = case when p_action in ('resolved', 'dismissed') then v_uid end,
                                resolved_at = case when p_action in ('resolved', 'dismissed') then now() end
      where id = p_id returning reporter_id into v_target;
    when p_entity = 'campaign' and p_action in ('approve', 'reject') then
      update public.campaigns set status = case when p_action = 'approve' then 'pending_payment' else 'rejected' end,
                                  review_note = nullif(trim(coalesce(p_note, '')), ''), reviewed_by = v_uid, reviewed_at = now()
      where id = p_id and status = 'pending_review' returning owner_id into v_target;
      if v_target is null then perform public.mz_fail('invalid_transition', 'La campaña no está pendiente de revisión.'); end if;
      perform public.mz_notify(v_target, 'campaign_' || p_action,
        case when p_action = 'approve' then 'Campaña aprobada: pendiente de pago' else 'Campaña rechazada' end, p_note, '/promociona/campanas');
    when p_entity = 'campaign' and p_action in ('pause', 'finish') then
      update public.campaigns set status = case when p_action = 'pause' then 'paused' else 'finished' end,
                                  review_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), review_note)
      where id = p_id and status in ('active', 'paused') returning owner_id into v_target;
    else
      perform public.mz_fail('validation', 'Acción de moderación no válida.');
  end case;
  if v_target is null then perform public.mz_fail('not_found', 'El elemento no existe.'); end if;
  perform public.mz_audit('moderate_' || p_entity || '_' || p_action, p_entity, p_id::text, jsonb_build_object('note', p_note));
  return jsonb_build_object('ok', true);
end $$;
