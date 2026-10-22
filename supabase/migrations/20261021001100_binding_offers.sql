-- =====================================================================
-- MARKETXONE · 1100 · Ofertas con pago al ofertar + comisión del 7 %
--
-- Regla de negocio: quien oferta paga en ese momento (el dinero queda
-- retenido). Si el vendedor acepta, el trato está hecho: la venta se
-- confirma al instante por el importe acordado. Si rechaza, vence o el
-- comprador la retira, la retención se libera sin cargo.
-- Contraoferta: si el comprador la acepta, se cobra el importe
-- contraofertado (se ajusta la retención) y la venta queda cerrada.
-- Al vendedor se le liquida cuando el pedido se entrega (protección
-- contra estafas: nadie cobra por algo que no envió).
-- =====================================================================

update public.platform_settings set commission_bps = 700 where commission_bps = 1000;
alter table public.platform_settings alter column commission_bps set default 700;

alter table public.offers add column if not exists payment_status text not null default 'none'
  check (payment_status in ('none', 'held', 'captured', 'released'));
alter table public.offers add column if not exists held_cents integer check (held_cents is null or held_cents >= 0);
alter table public.offers add column if not exists payment_ref text;
alter table public.offers add column if not exists shipping_address jsonb;

-- La retención sigue al estado de la oferta en todos los caminos (rechazo, vencimiento,
-- retiro, bloqueo, cuenta eliminada, falta de stock): nunca queda dinero retenido de más.
create or replace function public.tg_offer_hold() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.payment_status = 'held' and new.status in ('declined', 'expired', 'cancelled') then
    new.payment_status := 'released';
  elsif new.payment_status = 'held' and new.status = 'completed' then
    new.payment_status := 'captured';
  end if;
  return new;
end $$;
drop trigger if exists offer_hold on public.offers;
create trigger offer_hold before update of status on public.offers for each row execute function public.tg_offer_hold();

create or replace function public.mz_offer_json(o public.offers) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', o.id, 'status', o.status, 'awaiting', o.awaiting, 'quantity', o.quantity,
    'list_price_cents', o.list_price_cents, 'offer_cents', o.offer_cents, 'amount_cents', o.amount_cents,
    'payment_status', o.payment_status, 'held_cents', o.held_cents,
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

drop function if exists public.make_offer(uuid, integer, integer);
create or replace function public.make_offer(p_variant_id uuid, p_amount_cents integer, p_quantity integer default 1,
                                             p_address_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_settings public.platform_settings%rowtype := public.mz_settings();
  v_v public.product_variants%rowtype;
  v_p public.products%rowtype;
  v_list integer;
  v_min integer;
  v_addr jsonb;
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
  if not v_settings.test_mode then
    perform public.mz_fail('payments_not_ready', 'Los pagos reales todavía no están activos.');
  end if;
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
  -- El pago se hace al ofertar, así que la dirección de envío se fija ahora.
  select jsonb_build_object('full_name', a.full_name, 'line1', a.line1, 'line2', a.line2, 'city', a.city,
                            'region', a.region, 'postal_code', a.postal_code, 'country', a.country, 'phone', a.phone)
    into v_addr from public.addresses a
   where a.user_id = v_uid and (p_address_id is null or a.id = p_address_id)
   order by a.is_default desc, a.created_at limit 1;
  if v_addr is null then
    perform public.mz_fail('address_required', 'Agrega una dirección de envío: tu oferta se paga al enviarla y, si la aceptan, se envía a esa dirección.');
  end if;
  perform public.mz_expire_due_for_variants(array[p_variant_id]);
  select * into v_v from public.product_variants where id = p_variant_id;
  if v_v.stock_on_hand - v_v.stock_reserved < p_quantity then
    perform public.mz_fail('out_of_stock', 'No hay unidades disponibles de esta variante en este momento.');
  end if;
  begin
    insert into public.offers (product_id, variant_id, buyer_id, seller_id, quantity, list_price_cents, offer_cents, amount_cents,
                               status, awaiting, expires_at, payment_status, held_cents, payment_ref, shipping_address)
    values (v_p.id, v_v.id, v_uid, v_p.seller_id, p_quantity, v_list, p_amount_cents, p_amount_cents, 'pending', 'seller',
            now() + make_interval(mins => v_settings.offer_response_minutes),
            'held', p_amount_cents * p_quantity + v_settings.shipping_flat_cents,
            'test_hold_' || replace(gen_random_uuid()::text, '-', ''), v_addr)
    returning * into v_offer;
  exception when unique_violation then
    perform public.mz_fail('offer_exists', 'Ya tienes una oferta abierta para esta variante. Espera la respuesta del vendedor.');
  end;
  insert into public.offer_events (offer_id, actor_id, actor_role, kind, amount_cents, note)
  values (v_offer.id, v_uid, 'buyer', 'offer', p_amount_cents, 'Oferta pagada. El dinero queda retenido hasta que el vendedor responda.');
  perform public.mz_notify(v_p.seller_id, 'offer_received', format('Oferta pagada: %s', public.mz_money(p_amount_cents)),
    format('Por "%s" (precio publicado %s). Si la aceptas, la venta queda cerrada.', v_p.title, public.mz_money(v_list)), '/ofertas');
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
  v_order public.orders%rowtype;
  v_so uuid;
  v_subtotal integer;
  v_commission integer;
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
    insert into public.offer_events (offer_id, actor_role, kind, note) values (v_o.id, 'system', 'expire', 'La oferta venció sin respuesta. Se liberó el pago.');
    return public.mz_offer_json(v_o);
  end if;

  if p_action = 'cancel' then
    if v_role <> 'buyer' or v_o.status not in ('pending', 'countered') then
      perform public.mz_fail('invalid_action', 'No puedes retirar esta oferta.');
    end if;
    update public.offers set status = 'cancelled', awaiting = 'none' where id = v_o.id returning * into v_o;
    insert into public.offer_events (offer_id, actor_id, actor_role, kind, note) values (v_o.id, v_uid, 'buyer', 'cancel', 'Oferta retirada. Se liberó el pago.');
    return public.mz_offer_json(v_o);
  end if;

  if v_o.status not in ('pending', 'countered') or v_o.awaiting <> v_role then
    perform public.mz_fail('not_your_turn', 'Esta oferta no está esperando tu respuesta.');
  end if;

  if p_action = 'decline' then
    update public.offers set status = 'declined', awaiting = 'none' where id = v_o.id returning * into v_o;
    insert into public.offer_events (offer_id, actor_id, actor_role, kind, note) values (v_o.id, v_uid, v_role, 'decline', 'Se liberó el pago.');
    perform public.mz_notify(v_other, 'offer_declined',
      case when v_role = 'seller' then 'El vendedor rechazó tu oferta' else 'El comprador rechazó tu contraoferta' end,
      case when v_role = 'seller' then 'Se liberó tu pago; no se te cobró nada.' else null end, '/ofertas');
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
      'Si la aceptas, se cobra ese importe y la compra queda cerrada.', '/ofertas');
    return public.mz_offer_json(v_o);
  end if;

  if p_action <> 'accept' then
    perform public.mz_fail('invalid_action', 'Acción no válida.');
  end if;

  -- Aceptación = trato hecho: venta confirmada y pagada por el importe acordado.
  perform public.mz_expire_due_for_variants(array[v_o.variant_id]);
  select * into v_v from public.product_variants where id = v_o.variant_id for update;
  select * into v_p from public.products where id = v_o.product_id;
  if not (v_v.is_active and exists (select 1 from public.mz_public_products() x where x.id = v_p.id))
     or v_v.stock_on_hand - v_v.stock_reserved < v_o.quantity then
    update public.offers set status = 'cancelled', awaiting = 'none' where id = v_o.id returning * into v_o;
    insert into public.offer_events (offer_id, actor_id, actor_role, kind, note)
    values (v_o.id, v_uid, v_role, 'conflict', 'El artículo ya no tiene unidades disponibles; la oferta se canceló y se liberó el pago.');
    perform public.mz_notify(v_o.buyer_id, 'offer_conflict', 'Oferta cancelada por falta de stock',
      format('"%s" se agotó antes de cerrar el trato. Se liberó tu pago; no se te cobró nada.', v_p.title), '/ofertas');
    perform public.mz_notify(v_o.seller_id, 'offer_conflict', 'Oferta cancelada por falta de stock',
      format('"%s" no tenía unidades disponibles al aceptar.', v_p.title), '/ofertas');
    return public.mz_offer_json(v_o) || jsonb_build_object('conflict', true);
  end if;

  v_subtotal := v_o.amount_cents * v_o.quantity;
  v_commission := round(v_subtotal * v_settings.commission_bps / 10000.0)::int;
  insert into public.orders (buyer_id, source, offer_id, status, is_test, subtotal_cents, shipping_cents, tax_cents, total_cents,
                             shipping_address, payment_due_at)
  values (v_o.buyer_id, 'offer', v_o.id, 'pending_payment', v_settings.test_mode, v_subtotal, v_settings.shipping_flat_cents, 0,
          v_subtotal + v_settings.shipping_flat_cents, coalesce(v_o.shipping_address, '{}'::jsonb), now() + interval '5 minutes')
  returning * into v_order;
  insert into public.seller_orders (order_id, seller_id, store_id, subtotal_cents, shipping_cents, commission_bps, commission_cents, seller_net_cents)
  values (v_order.id, v_o.seller_id, v_p.store_id, v_subtotal, v_settings.shipping_flat_cents, v_settings.commission_bps,
          v_commission, v_subtotal - v_commission)
  returning id into v_so;
  insert into public.order_items (order_id, seller_order_id, product_id, variant_id, title, size, color, image_url,
                                  unit_price_cents, quantity, line_total_cents)
  values (v_order.id, v_so, v_p.id, v_v.id, v_p.title, v_v.size, v_v.color,
          (select i.url from public.product_images i where i.product_id = v_p.id order by i.position limit 1),
          v_o.amount_cents, v_o.quantity, v_subtotal);
  perform public.mz_reserve(v_v.id, v_o.quantity, v_order.id, v_o.buyer_id, v_order.payment_due_at);
  perform public.mz_convert_order(v_order.id, v_uid);
  insert into public.payments (order_id, payer_id, provider, provider_ref, amount_cents, status, is_test)
  values (v_order.id, v_o.buyer_id, 'test', coalesce(v_o.payment_ref, 'test_' || replace(gen_random_uuid()::text, '-', '')),
          v_order.total_cents, 'succeeded', true);
  update public.offers set held_cents = v_order.total_cents, order_id = v_order.id where id = v_o.id;
  insert into public.offer_events (offer_id, actor_id, actor_role, kind, amount_cents, note)
  values (v_o.id, v_uid, v_role, 'accept', v_o.amount_cents, 'Trato hecho: venta confirmada por el importe acordado.');
  perform public.mz_finalize_paid(v_order.id, v_uid); -- marca el pedido pagado y la oferta como completada
  select * into v_o from public.offers where id = v_o.id;
  perform public.mz_notify(v_other, 'offer_accepted',
    case when v_role = 'seller' then format('¡Oferta aceptada! Compraste por %s', public.mz_money(v_o.amount_cents))
         else format('El comprador aceptó tu contraoferta de %s', public.mz_money(v_o.amount_cents)) end,
    case when v_role = 'seller' then 'La venta está cerrada y el vendedor prepara el envío.' else 'La venta está cerrada. Prepara el envío.' end,
    case when v_role = 'seller' then '/pedido/' || v_order.id else '/panel/pedidos' end);
  return public.mz_offer_json(v_o);
end $$;

revoke execute on function public.make_offer(uuid, integer, integer, uuid), public.tg_offer_hold() from public, anon, authenticated;
grant execute on function public.make_offer(uuid, integer, integer, uuid) to authenticated;
