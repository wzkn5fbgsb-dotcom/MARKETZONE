-- =====================================================================
-- MARKETXONE · 0400 · Carrito, checkout, reservas, pagos, pedidos y ofertas
--
-- Orden de bloqueos (evita interbloqueos):
--   1) fila del pedido (orders)  2) variantes ordenadas por id
-- La reserva de stock usa UPDATE condicional (stock_on_hand - stock_reserved >= qty),
-- que Postgres reevalúa tras esperar el bloqueo: dos compradores no pueden
-- confirmar la misma última unidad.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Reservas internas
-- ---------------------------------------------------------------------
create or replace function public.mz_reserve(
  p_variant_id uuid, p_qty integer, p_order_id uuid, p_buyer uuid, p_expires timestamptz
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res uuid;
  v_ok uuid;
begin
  update public.product_variants
     set stock_reserved = stock_reserved + p_qty
   where id = p_variant_id and is_active and stock_on_hand - stock_reserved >= p_qty
  returning id into v_ok;
  if v_ok is null then
    perform public.mz_fail('out_of_stock', 'No quedan suficientes unidades disponibles.', jsonb_build_object('variant_id', p_variant_id));
  end if;
  insert into public.reservations (variant_id, order_id, buyer_id, quantity, expires_at)
  values (p_variant_id, p_order_id, p_buyer, p_qty, p_expires)
  returning id into v_res;
  perform public.mz_log_movement(p_variant_id, 'reserve', 0, p_qty, p_order_id, v_res, p_buyer, 'Reserva temporal');
  return v_res;
end $$;

create or replace function public.mz_release_order(p_order_id uuid, p_status text, p_actor uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
-- p_status: 'released' (cancelación) o 'expired' (plazo vencido)
declare r record;
begin
  for r in
    select res.id, res.variant_id, res.quantity from public.reservations res
    where res.order_id = p_order_id and res.status = 'active'
    order by res.variant_id
  loop
    update public.product_variants set stock_reserved = stock_reserved - r.quantity where id = r.variant_id;
    update public.reservations set status = p_status, resolved_at = now() where id = r.id;
    perform public.mz_log_movement(r.variant_id, case when p_status = 'expired' then 'expire' else 'release' end,
                                   0, -r.quantity, p_order_id, r.id, p_actor,
                                   case when p_status = 'expired' then 'Reserva vencida' else 'Reserva liberada' end);
  end loop;
end $$;

create or replace function public.mz_convert_order(p_order_id uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in
    select res.id, res.variant_id, res.quantity from public.reservations res
    where res.order_id = p_order_id and res.status = 'active'
    order by res.variant_id
  loop
    update public.product_variants
       set stock_on_hand = stock_on_hand - r.quantity, stock_reserved = stock_reserved - r.quantity
     where id = r.variant_id;
    update public.reservations set status = 'converted', resolved_at = now() where id = r.id;
    perform public.mz_log_movement(r.variant_id, 'sale', -r.quantity, -r.quantity, p_order_id, r.id, p_actor, 'Venta confirmada');
  end loop;
end $$;

-- Vence un pedido pendiente: libera reservas, cancela partes del vendedor y la oferta asociada.
create or replace function public.mz_expire_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_o public.orders%rowtype;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found or v_o.status <> 'pending_payment' then return; end if;
  perform public.mz_release_order(p_order_id, 'expired', null);
  update public.orders set status = 'expired', cancelled_at = now() where id = p_order_id;
  update public.seller_orders set status = 'cancelled' where order_id = p_order_id;
  if v_o.offer_id is not null then
    update public.offers set status = 'expired', awaiting = 'none' where id = v_o.offer_id and status = 'accepted';
    insert into public.offer_events (offer_id, actor_role, kind, note)
    values (v_o.offer_id, 'system', 'expire', 'El plazo de pago terminó y se liberó la reserva.');
    perform public.mz_notify((select seller_id from public.offers where id = v_o.offer_id), 'offer_expired',
      'Oferta aceptada sin pagar', 'El comprador no pagó a tiempo. La unidad vuelve a estar disponible.', '/ofertas');
  end if;
  perform public.mz_notify(v_o.buyer_id, 'order_expired', format('Pedido #%s vencido', v_o.number),
    'No se completó el pago dentro del plazo y se liberaron los artículos reservados.', '/pedido/' || v_o.id);
end $$;

-- Vence pedidos pendientes que tienen reservas sobre ciertas variantes (precisión al instante).
create or replace function public.mz_expire_due_for_variants(p_variant_ids uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in
    select distinct o.id from public.orders o
    join public.reservations res on res.order_id = o.id and res.status = 'active'
    where o.status = 'pending_payment' and o.payment_due_at <= now() and res.variant_id = any (p_variant_ids)
  loop
    perform public.mz_expire_order(r.id);
  end loop;
end $$;

create or replace function public.mz_expire_due() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_orders integer := 0;
  v_offers integer := 0;
  v_campaigns integer := 0;
begin
  for r in
    select id from public.orders where status = 'pending_payment' and payment_due_at <= now()
    order by payment_due_at for update skip locked
  loop
    perform public.mz_expire_order(r.id);
    v_orders := v_orders + 1;
  end loop;

  for r in
    update public.offers set status = 'expired', awaiting = 'none'
    where status in ('pending', 'countered') and expires_at <= now()
    returning id, buyer_id, seller_id, status
  loop
    insert into public.offer_events (offer_id, actor_role, kind, note)
    values (r.id, 'system', 'expire', 'La oferta venció sin respuesta.');
    perform public.mz_notify(r.buyer_id, 'offer_expired', 'Tu oferta venció', 'No hubo respuesta dentro del plazo.', '/ofertas');
    v_offers := v_offers + 1;
  end loop;

  update public.campaigns set status = 'finished' where status in ('active', 'paused') and ends_at <= now();
  get diagnostics v_campaigns = row_count;

  update public.platform_settings set last_expiry_run = now() where id = 1;
  return jsonb_build_object('orders_expired', v_orders, 'offers_expired', v_offers, 'campaigns_finished', v_campaigns);
end $$;

-- Punto de entrada público (idempotente y limitado en frecuencia). pg_cron también lo ejecuta.
create or replace function public.expire_stale() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_last timestamptz;
begin
  select last_expiry_run into v_last from public.platform_settings where id = 1;
  if v_last is not null and v_last > now() - interval '20 seconds' and coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('skipped', true);
  end if;
  return public.mz_expire_due();
end $$;

-- ---------------------------------------------------------------------
-- Carrito
-- ---------------------------------------------------------------------
create or replace function public.cart_add(p_variant_id uuid, p_quantity integer default 1) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_v public.product_variants%rowtype;
  v_p public.products%rowtype;
  v_current integer;
  v_settings public.platform_settings%rowtype := public.mz_settings();
begin
  perform public.mz_rate_limit('cart:' || v_uid, 300, interval '1 hour');
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    perform public.mz_fail('validation', 'La cantidad debe estar entre 1 y 99.');
  end if;
  select * into v_v from public.product_variants where id = p_variant_id and is_active;
  if not found then perform public.mz_fail('not_found', 'Esta talla o variante ya no existe.'); end if;
  select * into v_p from public.products where id = v_v.product_id;
  if not exists (select 1 from public.mz_public_products() x where x.id = v_p.id) then
    perform public.mz_fail('unavailable', 'Este producto ya no está disponible.');
  end if;
  if v_p.seller_id = v_uid then perform public.mz_fail('own_item', 'No puedes comprar tus propios productos.'); end if;
  if v_p.is_demo and not v_settings.test_mode then
    perform public.mz_fail('demo_item', 'Este es un producto de ejemplo y no se puede comprar.');
  end if;
  select quantity into v_current from public.cart_items where user_id = v_uid and variant_id = p_variant_id;
  if coalesce(v_current, 0) + p_quantity > v_v.stock_on_hand - v_v.stock_reserved then
    perform public.mz_fail('insufficient_stock',
      format('Solo hay %s unidad(es) disponible(s) de esta variante.', greatest(v_v.stock_on_hand - v_v.stock_reserved, 0)),
      jsonb_build_object('available', greatest(v_v.stock_on_hand - v_v.stock_reserved, 0)));
  end if;
  insert into public.cart_items (user_id, variant_id, quantity) values (v_uid, p_variant_id, p_quantity)
  on conflict (user_id, variant_id) do update set quantity = public.cart_items.quantity + excluded.quantity;
  insert into public.analytics_events (kind, product_id, store_id, user_id) values ('add_to_cart', v_p.id, v_p.store_id, v_uid);
  return public.get_cart();
end $$;

create or replace function public.cart_update(p_item_id uuid, p_quantity integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user();
begin
  if p_quantity is null or p_quantity < 0 or p_quantity > 99 then
    perform public.mz_fail('validation', 'La cantidad debe estar entre 0 y 99.');
  end if;
  if p_quantity = 0 then
    delete from public.cart_items where id = p_item_id and user_id = v_uid;
  else
    update public.cart_items set quantity = p_quantity where id = p_item_id and user_id = v_uid;
  end if;
  return public.get_cart();
end $$;

create or replace function public.cart_remove(p_item_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user();
begin
  delete from public.cart_items where id = p_item_id and user_id = v_uid;
  return public.get_cart();
end $$;

create or replace function public.get_cart() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_settings public.platform_settings%rowtype := public.mz_settings();
  v_lines jsonb;
  v_subtotal integer;
  v_sellers integer;
  v_ok_sellers integer;
begin
  with lines as (
    select ci.id, ci.quantity, ci.created_at, v.id as variant_id, v.size, v.color,
           p.id as product_id, p.title, p.seller_id, p.store_id, p.is_demo,
           coalesce(v.price_cents, p.price_cents) as unit_price_cents,
           greatest(v.stock_on_hand - v.stock_reserved, 0) as available,
           (v.is_active and exists (select 1 from public.mz_public_products() x where x.id = p.id)) as purchasable,
           p.seller_id = v_uid as own_item
    from public.cart_items ci
    join public.product_variants v on v.id = ci.variant_id
    join public.products p on p.id = v.product_id
    where ci.user_id = v_uid
  ), judged as (
    select l.*,
           case when not l.purchasable then 'unavailable'
                when l.own_item then 'own_item'
                when l.is_demo and not v_settings.test_mode then 'demo_item'
                when l.available = 0 then 'sold_out'
                when l.quantity > l.available then 'insufficient_stock'
           end as issue
    from lines l
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', j.id, 'variant_id', j.variant_id, 'product_id', j.product_id, 'title', j.title, 'size', j.size, 'color', j.color,
      'quantity', j.quantity, 'unit_price_cents', j.unit_price_cents, 'line_total_cents', j.unit_price_cents * j.quantity,
      'available', j.available, 'issue', j.issue, 'is_demo', j.is_demo,
      'image_url', (select i.url from public.product_images i where i.product_id = j.product_id order by i.position limit 1),
      'seller', (select jsonb_build_object('id', pr.id, 'username', pr.username) from public.profiles pr where pr.id = j.seller_id),
      'store', (select jsonb_build_object('slug', s.slug, 'name', s.name) from public.stores s where s.id = j.store_id)
    ) order by j.created_at), '[]'::jsonb),
    coalesce(sum(j.unit_price_cents * j.quantity) filter (where j.issue is null), 0),
    count(distinct j.seller_id),
    count(distinct j.seller_id) filter (where j.issue is null)
  into v_lines, v_subtotal, v_sellers, v_ok_sellers
  from judged j;

  return jsonb_build_object(
    'lines', v_lines,
    'subtotal_cents', v_subtotal,
    'shipping_cents', v_ok_sellers * v_settings.shipping_flat_cents,
    'tax_cents', 0,
    'total_cents', v_subtotal + v_ok_sellers * v_settings.shipping_flat_cents,
    'sellers', v_sellers,
    'has_issues', exists (select 1 from jsonb_array_elements(v_lines) e where e ->> 'issue' is not null),
    'test_mode', v_settings.test_mode,
    'shipping_flat_cents', v_settings.shipping_flat_cents,
    'hold_minutes', v_settings.checkout_hold_minutes
  );
end $$;

-- ---------------------------------------------------------------------
-- Checkout: valida en el servidor precio y stock, crea el pedido y reserva
-- ---------------------------------------------------------------------
create or replace function public.checkout(p_address_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_settings public.platform_settings%rowtype := public.mz_settings();
  v_addr jsonb;
  v_issues jsonb := '[]'::jsonb;
  v_order public.orders%rowtype;
  v_so uuid;
  v_due timestamptz := now() + make_interval(mins => v_settings.checkout_hold_minutes);
  v_subtotal integer := 0;
  v_seller_count integer := 0;
  r record;
  s record;
begin
  perform public.mz_rate_limit('checkout:' || v_uid, 30, interval '10 minutes');

  select jsonb_build_object('full_name', a.full_name, 'line1', a.line1, 'line2', a.line2, 'city', a.city,
                            'region', a.region, 'postal_code', a.postal_code, 'country', a.country, 'phone', a.phone)
  into v_addr from public.addresses a where a.id = p_address_id and a.user_id = v_uid;
  if v_addr is null then
    perform public.mz_fail('address_required', 'Selecciona una dirección de envío.');
  end if;

  if not exists (select 1 from public.cart_items where user_id = v_uid) then
    perform public.mz_fail('cart_empty', 'Tu carrito está vacío.');
  end if;

  -- Libera al instante reservas vencidas de estas variantes.
  perform public.mz_expire_due_for_variants(array(select variant_id from public.cart_items where user_id = v_uid));

  -- Bloquea las variantes del carrito en orden estable y vuelve a comprobar todo en el servidor.
  perform 1 from public.product_variants v
  where v.id in (select variant_id from public.cart_items where user_id = v_uid)
  order by v.id for update;

  for r in
    select ci.id as item_id, ci.quantity, v.id as variant_id, v.is_active, v.stock_on_hand, v.stock_reserved,
           p.id as product_id, p.title, p.seller_id, p.is_demo,
           coalesce(v.price_cents, p.price_cents) as unit_price_cents,
           exists (select 1 from public.mz_public_products() x where x.id = p.id) as visible
    from public.cart_items ci
    join public.product_variants v on v.id = ci.variant_id
    join public.products p on p.id = v.product_id
    where ci.user_id = v_uid
  loop
    if not (r.visible and r.is_active) then
      v_issues := v_issues || jsonb_build_object('item_id', r.item_id, 'title', r.title, 'issue', 'unavailable');
    elsif r.seller_id = v_uid then
      v_issues := v_issues || jsonb_build_object('item_id', r.item_id, 'title', r.title, 'issue', 'own_item');
    elsif r.is_demo and not v_settings.test_mode then
      v_issues := v_issues || jsonb_build_object('item_id', r.item_id, 'title', r.title, 'issue', 'demo_item');
    elsif r.stock_on_hand - r.stock_reserved < r.quantity then
      v_issues := v_issues || jsonb_build_object('item_id', r.item_id, 'title', r.title, 'issue',
                    case when r.stock_on_hand - r.stock_reserved <= 0 then 'sold_out' else 'insufficient_stock' end,
                    'available', greatest(r.stock_on_hand - r.stock_reserved, 0));
    end if;
  end loop;

  if jsonb_array_length(v_issues) > 0 then
    perform public.mz_fail('cart_conflict', 'Algunos artículos cambiaron de disponibilidad. Revisa tu carrito antes de continuar.',
                           jsonb_build_object('issues', v_issues));
  end if;

  select coalesce(sum(coalesce(v.price_cents, p.price_cents) * ci.quantity), 0), count(distinct p.seller_id)
  into v_subtotal, v_seller_count
  from public.cart_items ci
  join public.product_variants v on v.id = ci.variant_id
  join public.products p on p.id = v.product_id
  where ci.user_id = v_uid;

  insert into public.orders (buyer_id, source, status, is_test, subtotal_cents, shipping_cents, tax_cents, total_cents,
                             shipping_address, payment_due_at)
  values (v_uid, 'cart', 'pending_payment', v_settings.test_mode, v_subtotal, v_seller_count * v_settings.shipping_flat_cents, 0,
          v_subtotal + v_seller_count * v_settings.shipping_flat_cents, v_addr, v_due)
  returning * into v_order;

  for s in
    select p.seller_id, p.store_id, sum(coalesce(v.price_cents, p.price_cents) * ci.quantity)::int as subtotal
    from public.cart_items ci
    join public.product_variants v on v.id = ci.variant_id
    join public.products p on p.id = v.product_id
    where ci.user_id = v_uid
    group by p.seller_id, p.store_id
  loop
    insert into public.seller_orders (order_id, seller_id, store_id, subtotal_cents, shipping_cents, commission_bps,
                                      commission_cents, seller_net_cents)
    values (v_order.id, s.seller_id, s.store_id, s.subtotal, v_settings.shipping_flat_cents, v_settings.commission_bps,
            round(s.subtotal * v_settings.commission_bps / 10000.0)::int,
            s.subtotal - round(s.subtotal * v_settings.commission_bps / 10000.0)::int)
    on conflict (order_id, seller_id) do update set
      subtotal_cents = public.seller_orders.subtotal_cents + excluded.subtotal_cents,
      commission_cents = round((public.seller_orders.subtotal_cents + excluded.subtotal_cents) * v_settings.commission_bps / 10000.0)::int,
      seller_net_cents = (public.seller_orders.subtotal_cents + excluded.subtotal_cents)
                         - round((public.seller_orders.subtotal_cents + excluded.subtotal_cents) * v_settings.commission_bps / 10000.0)::int;
  end loop;

  for r in
    select ci.id as item_id, ci.quantity, v.id as variant_id, v.size, v.color, p.id as product_id, p.title, p.seller_id,
           coalesce(v.price_cents, p.price_cents) as unit_price_cents,
           (select i.url from public.product_images i where i.product_id = p.id order by i.position limit 1) as image_url
    from public.cart_items ci
    join public.product_variants v on v.id = ci.variant_id
    join public.products p on p.id = v.product_id
    where ci.user_id = v_uid
    order by v.id
  loop
    select id into v_so from public.seller_orders where order_id = v_order.id and seller_id = r.seller_id;
    insert into public.order_items (order_id, seller_order_id, product_id, variant_id, title, size, color, image_url,
                                    unit_price_cents, quantity, line_total_cents)
    values (v_order.id, v_so, r.product_id, r.variant_id, r.title, r.size, r.color, r.image_url,
            r.unit_price_cents, r.quantity, r.unit_price_cents * r.quantity);
    perform public.mz_reserve(r.variant_id, r.quantity, v_order.id, v_uid, v_due);
  end loop;

  delete from public.cart_items where user_id = v_uid;

  return jsonb_build_object('order_id', v_order.id, 'number', v_order.number, 'total_cents', v_order.total_cents,
                            'payment_due_at', v_order.payment_due_at, 'is_test', v_order.is_test);
end $$;

-- ---------------------------------------------------------------------
-- Pagos
-- ---------------------------------------------------------------------
create or replace function public.mz_finalize_paid(p_order_id uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_o public.orders%rowtype;
  r record;
begin
  select * into v_o from public.orders where id = p_order_id;
  update public.orders set status = 'paid', paid_at = now() where id = p_order_id;
  update public.seller_orders set status = 'paid', payout_status = 'pending' where order_id = p_order_id;
  if v_o.offer_id is not null then
    update public.offers set status = 'completed', awaiting = 'none' where id = v_o.offer_id;
    insert into public.offer_events (offer_id, actor_id, actor_role, kind, amount_cents, note)
    values (v_o.offer_id, p_actor, 'buyer', 'complete', v_o.subtotal_cents, 'Pago confirmado por el importe acordado.');
  end if;
  for r in select so.id, so.seller_id, so.store_id from public.seller_orders so where so.order_id = p_order_id loop
    perform public.mz_notify(r.seller_id, 'new_sale', format('Nueva venta · pedido #%s', v_o.number),
      case when v_o.is_test then 'Pedido de prueba pagado (sin dinero real). Prepara el envío.' else 'Pago confirmado. Prepara el envío.' end,
      '/panel/pedidos');
    insert into public.analytics_events (kind, store_id, user_id) values ('purchase', r.store_id, v_o.buyer_id);
  end loop;
  perform public.mz_notify(v_o.buyer_id, 'order_paid', format('Pedido #%s confirmado', v_o.number),
    case when v_o.is_test then 'Pago de prueba registrado. No se cobró dinero real.' else 'Recibimos tu pago.' end,
    '/pedido/' || p_order_id);
end $$;

-- Pago en MODO DE PRUEBA: no mueve dinero. Solo disponible si la plataforma está en modo de prueba
-- y el pedido se creó como pedido de prueba.
create or replace function public.pay_order_test(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_settings public.platform_settings%rowtype := public.mz_settings();
  v_o public.orders%rowtype;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found or v_o.buyer_id <> v_uid then
    perform public.mz_fail('not_found', 'El pedido no existe.');
  end if;
  if v_o.status = 'paid' then
    return jsonb_build_object('order_id', v_o.id, 'status', 'paid', 'already_paid', true);
  end if;
  if not v_o.is_test then
    perform public.mz_fail('real_payment_required', 'Este pedido requiere un pago real a través del proveedor de pagos.');
  end if;
  if not v_settings.test_mode then
    perform public.mz_fail('test_mode_disabled', 'Los pagos de prueba están desactivados.');
  end if;
  if v_o.status <> 'pending_payment' then
    perform public.mz_fail('order_not_payable', 'Este pedido ya no se puede pagar.', jsonb_build_object('status', v_o.status));
  end if;
  if v_o.payment_due_at <= now() then
    perform public.mz_expire_order(v_o.id);
    return jsonb_build_object('order_id', v_o.id, 'status', 'expired');
  end if;
  if coalesce(v_o.shipping_address ->> 'line1', '') = '' then
    perform public.mz_fail('address_required', 'Añade una dirección de envío antes de pagar.');
  end if;
  perform public.mz_convert_order(v_o.id, v_uid);
  insert into public.payments (order_id, payer_id, provider, provider_ref, amount_cents, status, is_test)
  values (v_o.id, v_uid, 'test', 'test_' || replace(gen_random_uuid()::text, '-', ''), v_o.total_cents, 'succeeded', true);
  perform public.mz_finalize_paid(v_o.id, v_uid);
  return jsonb_build_object('order_id', v_o.id, 'status', 'paid', 'is_test', true);
end $$;

-- Confirmación de pago REAL: solo la invoca el servidor (service_role) desde el webhook
-- verificado del proveedor. Nunca se expone al navegador.
create or replace function public.mark_order_paid(p_order_id uuid, p_provider text, p_provider_ref text, p_amount_cents integer)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_o public.orders%rowtype;
  v_ok boolean := true;
  r record;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user <> 'postgres' then
    perform public.mz_fail('forbidden', 'Solo el servidor puede confirmar pagos.');
  end if;
  if exists (select 1 from public.payments where provider = p_provider and provider_ref = p_provider_ref) then
    return jsonb_build_object('order_id', p_order_id, 'status', (select status from public.orders where id = p_order_id), 'duplicate', true);
  end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then perform public.mz_fail('not_found', 'Pedido inexistente.'); end if;
  if p_amount_cents <> v_o.total_cents then
    insert into public.payments (order_id, payer_id, provider, provider_ref, amount_cents, status, is_test)
    values (v_o.id, v_o.buyer_id, p_provider, p_provider_ref, p_amount_cents, 'failed', v_o.is_test);
    perform public.mz_audit('payment_amount_mismatch', 'order', v_o.id::text,
      jsonb_build_object('expected', v_o.total_cents, 'received', p_amount_cents));
    return jsonb_build_object('order_id', v_o.id, 'status', v_o.status, 'error', 'amount_mismatch');
  end if;
  insert into public.payments (order_id, payer_id, provider, provider_ref, amount_cents, status, is_test)
  values (v_o.id, v_o.buyer_id, p_provider, p_provider_ref, p_amount_cents, 'succeeded', v_o.is_test);

  if v_o.status = 'pending_payment' then
    perform public.mz_convert_order(v_o.id, v_o.buyer_id);
    perform public.mz_finalize_paid(v_o.id, v_o.buyer_id);
    return jsonb_build_object('order_id', v_o.id, 'status', 'paid');
  end if;

  if v_o.status in ('expired', 'cancelled') then
    -- Pago tardío: intenta tomar el stock ahora; si no hay, se registra un reembolso pendiente.
    begin
      for r in select oi.variant_id, oi.quantity from public.order_items oi where oi.order_id = v_o.id order by oi.variant_id loop
        update public.product_variants set stock_on_hand = stock_on_hand - r.quantity
        where id = r.variant_id and stock_on_hand - stock_reserved >= r.quantity;
        if not found then raise exception 'late_payment_no_stock'; end if;
        perform public.mz_log_movement(r.variant_id, 'sale', -r.quantity, 0, v_o.id, null, null, 'Venta por pago tardío');
      end loop;
    exception when others then
      v_ok := false;
    end;
    if v_ok then
      perform public.mz_finalize_paid(v_o.id, v_o.buyer_id);
      return jsonb_build_object('order_id', v_o.id, 'status', 'paid', 'late', true);
    end if;
    insert into public.refunds (order_id, amount_cents, reason, status, is_test)
    values (v_o.id, v_o.total_cents, 'Pago recibido después de vencer la reserva y sin stock disponible.', 'pending', v_o.is_test);
    perform public.mz_notify(v_o.buyer_id, 'payment_conflict', format('Pedido #%s: reembolso en curso', v_o.number),
      'Recibimos tu pago después de vencer la reserva y el artículo ya no estaba disponible. Se tramitará el reembolso completo.',
      '/pedido/' || v_o.id);
    return jsonb_build_object('order_id', v_o.id, 'status', v_o.status, 'refund_pending', true);
  end if;

  return jsonb_build_object('order_id', v_o.id, 'status', v_o.status);
end $$;

create or replace function public.cancel_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_o public.orders%rowtype;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found or v_o.buyer_id <> v_uid then perform public.mz_fail('not_found', 'El pedido no existe.'); end if;
  if v_o.status <> 'pending_payment' then
    perform public.mz_fail('order_not_cancellable', 'Solo puedes cancelar pedidos pendientes de pago.');
  end if;
  perform public.mz_release_order(v_o.id, 'released', v_uid);
  update public.orders set status = 'cancelled', cancelled_at = now() where id = v_o.id;
  update public.seller_orders set status = 'cancelled' where order_id = v_o.id;
  if v_o.offer_id is not null then
    update public.offers set status = 'cancelled', awaiting = 'none' where id = v_o.offer_id;
    insert into public.offer_events (offer_id, actor_id, actor_role, kind, note)
    values (v_o.offer_id, v_uid, 'buyer', 'cancel', 'El comprador canceló la compra antes de pagar.');
    perform public.mz_notify((select seller_id from public.offers where id = v_o.offer_id), 'offer_cancelled',
      'Compra cancelada', 'El comprador canceló antes de pagar. La unidad vuelve a estar disponible.', '/ofertas');
  end if;
  return jsonb_build_object('order_id', v_o.id, 'status', 'cancelled');
end $$;

create or replace function public.set_order_address(p_order_id uuid, p_address_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_addr jsonb;
begin
  select jsonb_build_object('full_name', a.full_name, 'line1', a.line1, 'line2', a.line2, 'city', a.city,
                            'region', a.region, 'postal_code', a.postal_code, 'country', a.country, 'phone', a.phone)
  into v_addr from public.addresses a where a.id = p_address_id and a.user_id = v_uid;
  if v_addr is null then perform public.mz_fail('not_found', 'La dirección no existe.'); end if;
  update public.orders set shipping_address = v_addr
  where id = p_order_id and buyer_id = v_uid and status = 'pending_payment';
  if not found then perform public.mz_fail('order_not_editable', 'Solo puedes cambiar la dirección de pedidos pendientes de pago.'); end if;
  return public.get_order(p_order_id);
end $$;

-- ---------------------------------------------------------------------
-- Consulta de pedidos
-- ---------------------------------------------------------------------
create or replace function public.mz_seller_order_json(so public.seller_orders) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', so.id, 'order_id', so.order_id, 'seller_id', so.seller_id, 'status', so.status,
    'subtotal_cents', so.subtotal_cents, 'shipping_cents', so.shipping_cents, 'commission_bps', so.commission_bps,
    'commission_cents', so.commission_cents, 'seller_net_cents', so.seller_net_cents, 'payout_status', so.payout_status,
    'carrier', so.carrier, 'tracking_number', so.tracking_number, 'shipped_at', so.shipped_at, 'delivered_at', so.delivered_at,
    'created_at', so.created_at,
    'seller', (select jsonb_build_object('username', pr.username, 'display_name', pr.display_name) from public.profiles pr where pr.id = so.seller_id),
    'store', (select jsonb_build_object('slug', s.slug, 'name', s.name) from public.stores s where s.id = so.store_id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', oi.id, 'product_id', oi.product_id, 'variant_id', oi.variant_id,
                         'title', oi.title, 'size', oi.size, 'color', oi.color, 'image_url', oi.image_url,
                         'unit_price_cents', oi.unit_price_cents, 'quantity', oi.quantity, 'line_total_cents', oi.line_total_cents))
                       from public.order_items oi where oi.seller_order_id = so.id), '[]'::jsonb),
    'review', (select jsonb_build_object('id', r.id, 'rating', r.rating, 'body', r.body) from public.reviews r where r.seller_order_id = so.id)
  );
$$;

create or replace function public.get_order(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_o public.orders%rowtype;
  v_is_buyer boolean;
  v_admin boolean := public.is_admin();
begin
  select * into v_o from public.orders where id = p_order_id;
  if not found then perform public.mz_fail('not_found', 'El pedido no existe.'); end if;
  v_is_buyer := v_o.buyer_id = v_uid;
  if not v_is_buyer and not v_admin and not exists (select 1 from public.seller_orders so where so.order_id = v_o.id and so.seller_id = v_uid) then
    perform public.mz_fail('not_found', 'El pedido no existe.');
  end if;
  return jsonb_build_object(
    'id', v_o.id, 'number', v_o.number, 'status', v_o.status, 'source', v_o.source, 'offer_id', v_o.offer_id,
    'is_test', v_o.is_test, 'currency', v_o.currency,
    'subtotal_cents', case when v_is_buyer or v_admin then v_o.subtotal_cents end,
    'shipping_cents', case when v_is_buyer or v_admin then v_o.shipping_cents end,
    'tax_cents', case when v_is_buyer or v_admin then v_o.tax_cents end,
    'total_cents', case when v_is_buyer or v_admin then v_o.total_cents end,
    'shipping_address', v_o.shipping_address, 'payment_due_at', v_o.payment_due_at, 'paid_at', v_o.paid_at,
    'cancelled_at', v_o.cancelled_at, 'created_at', v_o.created_at,
    'viewer_role', case when v_is_buyer then 'buyer' when v_admin then 'admin' else 'seller' end,
    'buyer', (select jsonb_build_object('username', pr.username, 'display_name', pr.display_name) from public.profiles pr where pr.id = v_o.buyer_id),
    'seller_orders', coalesce((select jsonb_agg(public.mz_seller_order_json(so) order by so.created_at)
                               from public.seller_orders so
                               where so.order_id = v_o.id and (v_is_buyer or v_admin or so.seller_id = v_uid)), '[]'::jsonb),
    'payments', case when v_is_buyer or v_admin then coalesce((select jsonb_agg(jsonb_build_object('provider', pm.provider, 'status', pm.status,
                    'amount_cents', pm.amount_cents, 'is_test', pm.is_test, 'created_at', pm.created_at) order by pm.created_at)
                    from public.payments pm where pm.order_id = v_o.id), '[]'::jsonb) else '[]'::jsonb end,
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('amount_cents', rf.amount_cents, 'status', rf.status, 'reason', rf.reason,
                    'is_test', rf.is_test, 'seller_order_id', rf.seller_order_id, 'created_at', rf.created_at) order by rf.created_at)
                    from public.refunds rf where rf.order_id = v_o.id
                      and (v_is_buyer or v_admin or rf.seller_order_id in (select id from public.seller_orders where seller_id = v_uid))), '[]'::jsonb)
  );
end $$;

create or replace function public.my_orders() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'number', o.number, 'status', o.status, 'is_test', o.is_test, 'source', o.source,
      'total_cents', o.total_cents, 'payment_due_at', o.payment_due_at, 'created_at', o.created_at,
      'items_count', (select coalesce(sum(quantity), 0) from public.order_items oi where oi.order_id = o.id),
      'preview', (select jsonb_agg(x.image_url) from (select oi.image_url from public.order_items oi where oi.order_id = o.id limit 3) x),
      'fulfillment', (select jsonb_agg(so.status) from public.seller_orders so where so.order_id = o.id)
    ) order by o.created_at desc)
    from public.orders o where o.buyer_id = v_uid), '[]'::jsonb);
end $$;

create or replace function public.seller_orders_list(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user();
begin
  return coalesce((select jsonb_agg(public.mz_seller_order_json(so) || jsonb_build_object(
      'order_number', o.number, 'order_status', o.status, 'is_test', o.is_test, 'payment_due_at', o.payment_due_at,
      'shipping_address', case when so.status in ('paid', 'preparing', 'shipped', 'delivered') then o.shipping_address end,
      'buyer', (select jsonb_build_object('username', pr.username) from public.profiles pr where pr.id = o.buyer_id))
      order by so.created_at desc)
    from public.seller_orders so join public.orders o on o.id = so.order_id
    where so.seller_id = v_uid and (p_status is null or p_status = '' or so.status = p_status)), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Envío, entrega y reembolsos
-- ---------------------------------------------------------------------
create or replace function public.seller_update_fulfillment(p_seller_order_id uuid, p_status text, p_carrier text default null,
                                                            p_tracking text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_so public.seller_orders%rowtype;
  v_number bigint;
  v_buyer uuid;
begin
  select * into v_so from public.seller_orders where id = p_seller_order_id for update;
  if not found or v_so.seller_id <> v_uid then perform public.mz_fail('not_found', 'El pedido no existe.'); end if;
  if not ((v_so.status = 'paid' and p_status in ('preparing', 'shipped'))
       or (v_so.status = 'preparing' and p_status = 'shipped')
       or (v_so.status = 'shipped' and p_status = 'delivered')) then
    perform public.mz_fail('invalid_transition', 'Ese cambio de estado no es válido para este pedido.',
                           jsonb_build_object('from', v_so.status, 'to', p_status));
  end if;
  update public.seller_orders set
    status = p_status,
    carrier = case when p_status = 'shipped' then nullif(trim(coalesce(p_carrier, '')), '') else carrier end,
    tracking_number = case when p_status = 'shipped' then nullif(trim(coalesce(p_tracking, '')), '') else tracking_number end,
    shipped_at = case when p_status = 'shipped' then now() else shipped_at end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end
  where id = p_seller_order_id;
  select o.number, o.buyer_id into v_number, v_buyer from public.orders o where o.id = v_so.order_id;
  perform public.mz_notify(v_buyer, 'order_' || p_status,
    format('Pedido #%s: %s', v_number, case p_status when 'preparing' then 'en preparación' when 'shipped' then 'enviado' else 'entregado' end),
    case when p_status = 'shipped' and nullif(trim(coalesce(p_tracking, '')), '') is not null
         then format('Seguimiento: %s %s', coalesce(p_carrier, ''), p_tracking) end,
    '/pedido/' || v_so.order_id);
  return public.mz_seller_order_json((select so from public.seller_orders so where so.id = p_seller_order_id));
end $$;

create or replace function public.buyer_confirm_delivery(p_seller_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_so public.seller_orders%rowtype;
begin
  select so.* into v_so from public.seller_orders so join public.orders o on o.id = so.order_id
  where so.id = p_seller_order_id and o.buyer_id = v_uid for update of so;
  if not found then perform public.mz_fail('not_found', 'El pedido no existe.'); end if;
  if v_so.status <> 'shipped' then perform public.mz_fail('invalid_transition', 'Solo puedes confirmar la entrega de pedidos enviados.'); end if;
  update public.seller_orders set status = 'delivered', delivered_at = now() where id = p_seller_order_id;
  perform public.mz_notify(v_so.seller_id, 'order_delivered', 'Entrega confirmada por el comprador', null, '/panel/pedidos');
  return public.get_order(v_so.order_id);
end $$;

create or replace function public.refund_seller_order(p_seller_order_id uuid, p_reason text, p_restock boolean default true) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_admin boolean := public.is_admin();
  v_so public.seller_orders%rowtype;
  v_o public.orders%rowtype;
  v_amount integer;
  r record;
begin
  select * into v_so from public.seller_orders where id = p_seller_order_id;
  if not found or (v_so.seller_id <> v_uid and not v_admin) then perform public.mz_fail('not_found', 'El pedido no existe.'); end if;
  select * into v_o from public.orders where id = v_so.order_id for update;
  select * into v_so from public.seller_orders where id = p_seller_order_id for update;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    perform public.mz_fail('validation', 'Indica el motivo del reembolso.');
  end if;
  if not v_admin and v_so.status not in ('paid', 'preparing') then
    perform public.mz_fail('invalid_transition', 'Solo puedes reembolsar pedidos pagados que aún no se han enviado. Contacta con soporte para otros casos.');
  end if;
  if v_admin and v_so.status not in ('paid', 'preparing', 'shipped', 'delivered') then
    perform public.mz_fail('invalid_transition', 'Este pedido no admite reembolso.');
  end if;
  if not v_o.is_test then
    perform public.mz_fail('provider_required', 'Los reembolsos de pagos reales se tramitarán por el proveedor de pagos (pendiente de integración).');
  end if;
  v_amount := v_so.subtotal_cents + v_so.shipping_cents;
  insert into public.refunds (order_id, seller_order_id, amount_cents, reason, status, is_test, restocked, created_by)
  values (v_o.id, v_so.id, v_amount, trim(p_reason), 'succeeded', true, coalesce(p_restock, false), v_uid);
  update public.seller_orders set status = 'refunded', payout_status = 'reversed' where id = v_so.id;
  if coalesce(p_restock, false) then
    for r in select oi.variant_id, oi.quantity from public.order_items oi
             where oi.seller_order_id = v_so.id and oi.variant_id is not null order by oi.variant_id loop
      update public.product_variants set stock_on_hand = stock_on_hand + r.quantity where id = r.variant_id;
      perform public.mz_log_movement(r.variant_id, 'restock', r.quantity, 0, v_o.id, null, v_uid, 'Reposición por reembolso');
    end loop;
  end if;
  update public.orders set status = case
      when not exists (select 1 from public.seller_orders where order_id = v_o.id and status not in ('refunded', 'cancelled')) then 'refunded'
      else 'partially_refunded' end
  where id = v_o.id;
  perform public.mz_notify(v_o.buyer_id, 'order_refunded', format('Reembolso del pedido #%s', v_o.number),
    format('Reembolso de prueba por %s (sin dinero real).', public.mz_money(v_amount)), '/pedido/' || v_o.id);
  if v_admin then perform public.mz_audit('refund_seller_order', 'seller_order', v_so.id::text, jsonb_build_object('amount', v_amount)); end if;
  return public.get_order(v_o.id);
end $$;

-- ---------------------------------------------------------------------
-- Ofertas y contraofertas
-- ---------------------------------------------------------------------
create or replace function public.mz_offer_json(o public.offers) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', o.id, 'status', o.status, 'awaiting', o.awaiting, 'quantity', o.quantity,
    'list_price_cents', o.list_price_cents, 'offer_cents', o.offer_cents, 'amount_cents', o.amount_cents,
    'expires_at', o.expires_at, 'order_id', o.order_id, 'created_at', o.created_at, 'updated_at', o.updated_at,
    'viewer_role', case when o.buyer_id = auth.uid() then 'buyer' when o.seller_id = auth.uid() then 'seller' else 'admin' end,
    'product', (select public.mz_card(p) from public.products p where p.id = o.product_id),
    'variant', (select jsonb_build_object('id', v.id, 'size', v.size, 'color', v.color) from public.product_variants v where v.id = o.variant_id),
    'buyer', (select jsonb_build_object('id', pr.id, 'username', pr.username) from public.profiles pr where pr.id = o.buyer_id),
    'seller', (select jsonb_build_object('id', pr.id, 'username', pr.username) from public.profiles pr where pr.id = o.seller_id),
    'order', (select jsonb_build_object('id', od.id, 'number', od.number, 'status', od.status, 'total_cents', od.total_cents,
                                        'payment_due_at', od.payment_due_at) from public.orders od where od.id = o.order_id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'actor_role', e.actor_role, 'amount_cents', e.amount_cents,
                                                            'note', e.note, 'created_at', e.created_at) order by e.id)
                        from public.offer_events e where e.offer_id = o.id), '[]'::jsonb)
  );
$$;

create or replace function public.make_offer(p_variant_id uuid, p_amount_cents integer, p_quantity integer default 1) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_settings public.platform_settings%rowtype := public.mz_settings();
  v_v public.product_variants%rowtype;
  v_p public.products%rowtype;
  v_list integer;
  v_min integer;
  v_offer public.offers%rowtype;
begin
  perform public.mz_rate_limit('offer:' || v_uid, 30, interval '1 hour');
  select * into v_v from public.product_variants where id = p_variant_id and is_active;
  if not found then perform public.mz_fail('not_found', 'Esta variante ya no existe.'); end if;
  select * into v_p from public.products where id = v_v.product_id;
  if not exists (select 1 from public.mz_public_products() x where x.id = v_p.id) then
    perform public.mz_fail('unavailable', 'Este producto ya no está disponible.');
  end if;
  if v_p.seller_id = v_uid then perform public.mz_fail('own_item', 'No puedes hacer ofertas a tus propios productos.'); end if;
  if not v_p.offers_enabled then perform public.mz_fail('offers_disabled', 'El vendedor no acepta ofertas en este artículo.'); end if;
  if v_p.is_demo and not v_settings.test_mode then perform public.mz_fail('demo_item', 'Este es un producto de ejemplo.'); end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 10 then
    perform public.mz_fail('validation', 'La cantidad de la oferta debe estar entre 1 y 10.');
  end if;
  v_list := coalesce(v_v.price_cents, v_p.price_cents);
  v_min := ceil(v_list * v_settings.min_offer_percent / 100.0)::int;
  if p_amount_cents is null or p_amount_cents >= v_list then
    perform public.mz_fail('offer_too_high', 'Tu oferta debe ser menor que el precio publicado. Para pagar el precio completo, añade el artículo al carrito.');
  end if;
  if p_amount_cents < v_min then
    perform public.mz_fail('offer_too_low', format('La oferta mínima para este artículo es %s.', public.mz_money(v_min)),
                           jsonb_build_object('min_cents', v_min));
  end if;
  perform public.mz_expire_due_for_variants(array[p_variant_id]);
  select * into v_v from public.product_variants where id = p_variant_id;
  if v_v.stock_on_hand - v_v.stock_reserved < p_quantity then
    perform public.mz_fail('out_of_stock', 'No hay unidades disponibles de esta variante en este momento.');
  end if;
  begin
    insert into public.offers (product_id, variant_id, buyer_id, seller_id, quantity, list_price_cents, offer_cents, amount_cents,
                               status, awaiting, expires_at)
    values (v_p.id, v_v.id, v_uid, v_p.seller_id, p_quantity, v_list, p_amount_cents, p_amount_cents, 'pending', 'seller',
            now() + make_interval(mins => v_settings.offer_response_minutes))
    returning * into v_offer;
  exception when unique_violation then
    perform public.mz_fail('offer_exists', 'Ya tienes una oferta abierta para esta variante. Espera la respuesta del vendedor.');
  end;
  insert into public.offer_events (offer_id, actor_id, actor_role, kind, amount_cents) values (v_offer.id, v_uid, 'buyer', 'offer', p_amount_cents);
  perform public.mz_notify(v_p.seller_id, 'offer_received', format('Nueva oferta: %s', public.mz_money(p_amount_cents)),
    format('Por "%s" (precio publicado %s).', v_p.title, public.mz_money(v_list)), '/ofertas');
  return public.mz_offer_json(v_offer);
end $$;

create or replace function public.respond_offer(p_offer_id uuid, p_action text, p_amount_cents integer default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_settings public.platform_settings%rowtype := public.mz_settings();
  v_o public.offers%rowtype;
  v_role text;
  v_p public.products%rowtype;
  v_v public.product_variants%rowtype;
  v_addr jsonb := '{}'::jsonb;
  v_due timestamptz;
  v_order public.orders%rowtype;
  v_so uuid;
  v_subtotal integer;
  v_other uuid;
begin
  perform public.mz_rate_limit('offer_resp:' || v_uid, 120, interval '1 hour');
  select * into v_o from public.offers where id = p_offer_id for update;
  if not found or (v_o.buyer_id <> v_uid and v_o.seller_id <> v_uid) then
    perform public.mz_fail('not_found', 'La oferta no existe.');
  end if;
  v_role := case when v_o.seller_id = v_uid then 'seller' else 'buyer' end;
  v_other := case when v_role = 'seller' then v_o.buyer_id else v_o.seller_id end;

  if v_o.status in ('pending', 'countered') and v_o.expires_at <= now() then
    update public.offers set status = 'expired', awaiting = 'none' where id = v_o.id returning * into v_o;
    insert into public.offer_events (offer_id, actor_role, kind, note) values (v_o.id, 'system', 'expire', 'La oferta venció sin respuesta.');
    return public.mz_offer_json(v_o);
  end if;

  if p_action = 'cancel' then
    if v_role <> 'buyer' or v_o.status not in ('pending', 'countered') then
      perform public.mz_fail('invalid_action', 'No puedes retirar esta oferta.');
    end if;
    update public.offers set status = 'cancelled', awaiting = 'none' where id = v_o.id returning * into v_o;
    insert into public.offer_events (offer_id, actor_id, actor_role, kind) values (v_o.id, v_uid, 'buyer', 'cancel');
    return public.mz_offer_json(v_o);
  end if;

  if v_o.status not in ('pending', 'countered') or v_o.awaiting <> v_role then
    perform public.mz_fail('not_your_turn', 'Esta oferta no está esperando tu respuesta.');
  end if;

  if p_action = 'decline' then
    update public.offers set status = 'declined', awaiting = 'none' where id = v_o.id returning * into v_o;
    insert into public.offer_events (offer_id, actor_id, actor_role, kind) values (v_o.id, v_uid, v_role, 'decline');
    perform public.mz_notify(v_other, 'offer_declined',
      case when v_role = 'seller' then 'El vendedor rechazó tu oferta' else 'El comprador rechazó tu contraoferta' end, null, '/ofertas');
    return public.mz_offer_json(v_o);
  end if;

  if p_action = 'counter' then
    if v_role <> 'seller' or v_o.status <> 'pending' then
      perform public.mz_fail('invalid_action', 'Solo el vendedor puede contraofertar una oferta pendiente.');
    end if;
    if p_amount_cents is null or p_amount_cents <= v_o.amount_cents or p_amount_cents >= v_o.list_price_cents then
      perform public.mz_fail('validation', format('La contraoferta debe estar entre %s y %s.',
        public.mz_money(v_o.amount_cents + 1), public.mz_money(v_o.list_price_cents - 1)));
    end if;
    update public.offers set status = 'countered', awaiting = 'buyer', amount_cents = p_amount_cents,
                             expires_at = now() + make_interval(mins => v_settings.offer_response_minutes)
    where id = v_o.id returning * into v_o;
    insert into public.offer_events (offer_id, actor_id, actor_role, kind, amount_cents) values (v_o.id, v_uid, 'seller', 'counter', p_amount_cents);
    perform public.mz_notify(v_o.buyer_id, 'offer_countered', format('Contraoferta recibida: %s', public.mz_money(p_amount_cents)),
      'Acéptala o recházala antes de que venza.', '/ofertas');
    return public.mz_offer_json(v_o);
  end if;

  if p_action <> 'accept' then
    perform public.mz_fail('invalid_action', 'Acción no válida.');
  end if;

  -- Aceptación: crea una compra pendiente de pago por el importe acordado y reserva la unidad.
  perform public.mz_expire_due_for_variants(array[v_o.variant_id]);
  select * into v_v from public.product_variants where id = v_o.variant_id for update;
  select * into v_p from public.products where id = v_o.product_id;
  if not (v_v.is_active and exists (select 1 from public.mz_public_products() x where x.id = v_p.id))
     or v_v.stock_on_hand - v_v.stock_reserved < v_o.quantity then
    update public.offers set status = 'cancelled', awaiting = 'none' where id = v_o.id returning * into v_o;
    insert into public.offer_events (offer_id, actor_id, actor_role, kind, note)
    values (v_o.id, v_uid, v_role, 'conflict', 'El artículo ya no tiene unidades disponibles; la oferta se canceló sin cargos.');
    perform public.mz_notify(v_o.buyer_id, 'offer_conflict', 'Oferta cancelada por falta de stock',
      format('"%s" se agotó antes de completar la operación. No se realizó ningún cargo.', v_p.title), '/ofertas');
    perform public.mz_notify(v_o.seller_id, 'offer_conflict', 'Oferta cancelada por falta de stock',
      format('"%s" no tenía unidades disponibles al aceptar.', v_p.title), '/ofertas');
    return public.mz_offer_json(v_o) || jsonb_build_object('conflict', true);
  end if;

  select jsonb_build_object('full_name', a.full_name, 'line1', a.line1, 'line2', a.line2, 'city', a.city,
                            'region', a.region, 'postal_code', a.postal_code, 'country', a.country, 'phone', a.phone)
  into v_addr from public.addresses a where a.user_id = v_o.buyer_id order by a.is_default desc, a.created_at limit 1;
  v_due := now() + make_interval(mins => v_settings.offer_payment_minutes);
  v_subtotal := v_o.amount_cents * v_o.quantity;

  insert into public.orders (buyer_id, source, offer_id, status, is_test, subtotal_cents, shipping_cents, tax_cents, total_cents,
                             shipping_address, payment_due_at)
  values (v_o.buyer_id, 'offer', v_o.id, 'pending_payment', v_settings.test_mode, v_subtotal, v_settings.shipping_flat_cents, 0,
          v_subtotal + v_settings.shipping_flat_cents, coalesce(v_addr, '{}'::jsonb), v_due)
  returning * into v_order;
  insert into public.seller_orders (order_id, seller_id, store_id, subtotal_cents, shipping_cents, commission_bps, commission_cents, seller_net_cents)
  values (v_order.id, v_o.seller_id, v_p.store_id, v_subtotal, v_settings.shipping_flat_cents, v_settings.commission_bps,
          round(v_subtotal * v_settings.commission_bps / 10000.0)::int,
          v_subtotal - round(v_subtotal * v_settings.commission_bps / 10000.0)::int)
  returning id into v_so;
  insert into public.order_items (order_id, seller_order_id, product_id, variant_id, title, size, color, image_url,
                                  unit_price_cents, quantity, line_total_cents)
  values (v_order.id, v_so, v_p.id, v_v.id, v_p.title, v_v.size, v_v.color,
          (select i.url from public.product_images i where i.product_id = v_p.id order by i.position limit 1),
          v_o.amount_cents, v_o.quantity, v_subtotal);
  perform public.mz_reserve(v_v.id, v_o.quantity, v_order.id, v_o.buyer_id, v_due);

  update public.offers set status = 'accepted', awaiting = 'buyer', order_id = v_order.id, expires_at = v_due
  where id = v_o.id returning * into v_o;
  insert into public.offer_events (offer_id, actor_id, actor_role, kind, amount_cents, note)
  values (v_o.id, v_uid, v_role, 'accept', v_o.amount_cents, 'Compra pendiente de pago por el importe acordado.');
  perform public.mz_notify(v_o.buyer_id, 'offer_accepted', format('Oferta aceptada: %s', public.mz_money(v_o.amount_cents)),
    format('Completa el pago antes de %s para asegurar el artículo.', to_char(v_due at time zone 'UTC', 'DD/MM HH24:MI "UTC"')),
    '/pedido/' || v_order.id);
  if v_role = 'buyer' then
    perform public.mz_notify(v_o.seller_id, 'offer_accepted', 'El comprador aceptó tu contraoferta',
      'La unidad queda reservada hasta que se complete el pago.', '/ofertas');
  end if;
  return public.mz_offer_json(v_o);
end $$;

create or replace function public.my_offers(p_role text default 'buyer') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user();
begin
  return coalesce((select jsonb_agg(public.mz_offer_json(o) order by o.updated_at desc)
                   from public.offers o
                   where (p_role = 'seller' and o.seller_id = v_uid) or (p_role <> 'seller' and o.buyer_id = v_uid)), '[]'::jsonb);
end $$;
