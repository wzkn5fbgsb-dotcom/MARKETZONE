-- =====================================================================
-- MARKETXONE · 1200 · Protección contra estafas sin castigar a inocentes
--
-- - El vendedor ya NO puede marcar un pedido como entregado: lo confirma
--   el comprador, o se confirma solo si el comprador no reporta un
--   problema (7 días después del envío con número de guía; 21 sin guía).
-- - El comprador puede reportar un problema con un pedido enviado: se
--   congela la confirmación automática y lo revisa un administrador.
-- - Nadie se suspende de forma automática: los reportes solo crean un caso
--   para revisión humana.
-- =====================================================================

alter table public.seller_orders add column if not exists auto_complete_at timestamptz;
alter table public.seller_orders add column if not exists dispute_status text not null default 'none'
  check (dispute_status in ('none', 'open', 'resolved'));
alter table public.seller_orders add column if not exists dispute_reason text;
alter table public.seller_orders add column if not exists dispute_opened_at timestamptz;

create or replace function public.seller_update_fulfillment(p_seller_order_id uuid, p_status text, p_carrier text default null,
                                                            p_tracking text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_so public.seller_orders%rowtype;
  v_number bigint;
  v_buyer uuid;
  v_tracking text := nullif(trim(coalesce(p_tracking, '')), '');
begin
  select * into v_so from public.seller_orders where id = p_seller_order_id for update;
  if not found or v_so.seller_id <> v_uid then perform public.mz_fail('not_found', 'El pedido no existe.'); end if;
  if p_status = 'delivered' then
    perform public.mz_fail('buyer_confirms_delivery',
      'La entrega la confirma el comprador. Si no reporta un problema, se confirma sola 7 días después del envío con número de guía (21 días sin guía).');
  end if;
  if not ((v_so.status = 'paid' and p_status in ('preparing', 'shipped'))
       or (v_so.status = 'preparing' and p_status = 'shipped')) then
    perform public.mz_fail('invalid_transition', 'Ese cambio de estado no es válido para este pedido.',
                           jsonb_build_object('from', v_so.status, 'to', p_status));
  end if;
  if v_tracking is not null and char_length(v_tracking) < 6 then
    perform public.mz_fail('validation', 'El número de guía parece incompleto. Revísalo o déjalo vacío.', '{"field":"tracking"}');
  end if;
  update public.seller_orders set
    status = p_status,
    carrier = case when p_status = 'shipped' then nullif(trim(coalesce(p_carrier, '')), '') else carrier end,
    tracking_number = case when p_status = 'shipped' then v_tracking else tracking_number end,
    shipped_at = case when p_status = 'shipped' then now() else shipped_at end,
    auto_complete_at = case when p_status = 'shipped'
                            then now() + case when v_tracking is null then interval '21 days' else interval '7 days' end
                            else auto_complete_at end
  where id = p_seller_order_id;
  select o.number, o.buyer_id into v_number, v_buyer from public.orders o where o.id = v_so.order_id;
  perform public.mz_notify(v_buyer, 'order_' || p_status,
    format('Pedido #%s: %s', v_number, case p_status when 'preparing' then 'en preparación' else 'enviado' end),
    case when p_status = 'shipped' then
      concat_ws(' ', case when v_tracking is not null then format('Guía: %s %s.', coalesce(p_carrier, ''), v_tracking) end,
                'Cuando lo recibas, confírmalo. Si hay un problema, repórtalo desde el pedido.') end,
    '/pedido/' || v_so.order_id);
  return public.mz_seller_order_json((select so from public.seller_orders so where so.id = p_seller_order_id));
end $$;

create or replace function public.mz_seller_order_json(so public.seller_orders) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', so.id, 'order_id', so.order_id, 'seller_id', so.seller_id, 'status', so.status,
    'subtotal_cents', so.subtotal_cents, 'shipping_cents', so.shipping_cents, 'commission_bps', so.commission_bps,
    'commission_cents', so.commission_cents, 'seller_net_cents', so.seller_net_cents, 'payout_status', so.payout_status,
    'carrier', so.carrier, 'tracking_number', so.tracking_number, 'shipped_at', so.shipped_at, 'delivered_at', so.delivered_at,
    'created_at', so.created_at, 'auto_complete_at', so.auto_complete_at,
    'dispute_status', so.dispute_status, 'dispute_opened_at', so.dispute_opened_at,
    'seller', (select jsonb_build_object('username', pr.username, 'display_name', pr.display_name) from public.profiles pr where pr.id = so.seller_id),
    'store', (select jsonb_build_object('slug', s.slug, 'name', s.name) from public.stores s where s.id = so.store_id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', oi.id, 'product_id', oi.product_id, 'variant_id', oi.variant_id,
                         'title', oi.title, 'size', oi.size, 'color', oi.color, 'image_url', oi.image_url,
                         'unit_price_cents', oi.unit_price_cents, 'quantity', oi.quantity, 'line_total_cents', oi.line_total_cents))
                       from public.order_items oi where oi.seller_order_id = so.id), '[]'::jsonb),
    'review', (select jsonb_build_object('id', r.id, 'rating', r.rating, 'body', r.body) from public.reviews r where r.seller_order_id = so.id)
  );
$$;

create or replace function public.report_order_problem(p_seller_order_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_so public.seller_orders%rowtype;
  v_number bigint;
  r record;
begin
  perform public.mz_rate_limit('dispute:' || v_uid, 10, interval '1 day');
  select so.* into v_so from public.seller_orders so join public.orders o on o.id = so.order_id
   where so.id = p_seller_order_id and o.buyer_id = v_uid for update of so;
  if not found then perform public.mz_fail('not_found', 'El pedido no existe.'); end if;
  if v_so.status not in ('paid', 'preparing', 'shipped') then
    perform public.mz_fail('invalid_transition', 'Solo puedes reportar problemas de pedidos pagados que aún no se confirman como entregados.');
  end if;
  if v_so.dispute_status = 'open' then
    perform public.mz_fail('already_reported', 'Ya reportaste un problema con este pedido. El equipo lo está revisando.');
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 10 then
    perform public.mz_fail('validation', 'Cuéntanos qué pasó (al menos 10 caracteres).', '{"field":"reason"}');
  end if;
  update public.seller_orders set dispute_status = 'open', dispute_reason = left(trim(p_reason), 1000), dispute_opened_at = now()
   where id = v_so.id;
  select number into v_number from public.orders where id = v_so.order_id;
  perform public.mz_notify(v_so.seller_id, 'order_dispute', format('Problema reportado en el pedido #%s', v_number),
    'El comprador reportó un problema. El pago queda retenido mientras el equipo lo revisa; no se tomó ninguna medida contra tu cuenta.',
    '/panel/pedidos');
  for r in select id from public.profiles where role = 'admin' and status = 'active' loop
    perform public.mz_notify(r.id, 'order_dispute', format('Disputa abierta: pedido #%s', v_number), left(trim(p_reason), 200), '/admin/pedidos');
  end loop;
  return jsonb_build_object('seller_order_id', v_so.id, 'dispute_status', 'open');
end $$;

-- El comprador confirma la entrega (también cierra una disputa que él mismo abrió).
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
  update public.seller_orders set status = 'delivered', delivered_at = now(),
    dispute_status = case when dispute_status = 'open' then 'resolved' else dispute_status end
  where id = p_seller_order_id;
  perform public.mz_notify(v_so.seller_id, 'order_delivered', 'Entrega confirmada por el comprador', 'Tu pago queda liberado.', '/panel/pedidos');
  return public.get_order(v_so.order_id);
end $$;

create or replace function public.mz_expire_due() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_orders integer := 0;
  v_offers integer := 0;
  v_campaigns integer := 0;
  v_delivered integer := 0;
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
    values (r.id, 'system', 'expire', 'La oferta venció sin respuesta. Se liberó el pago.');
    perform public.mz_notify(r.buyer_id, 'offer_expired', 'Tu oferta venció', 'No hubo respuesta a tiempo. Se liberó tu pago; no se te cobró nada.', '/ofertas');
    v_offers := v_offers + 1;
  end loop;

  -- Confirmación automática de entrega si el comprador no reportó ningún problema.
  for r in
    update public.seller_orders set status = 'delivered', delivered_at = now()
    where status = 'shipped' and dispute_status = 'none' and auto_complete_at is not null and auto_complete_at <= now()
    returning id, seller_id, order_id
  loop
    perform public.mz_notify(r.seller_id, 'order_delivered', 'Entrega confirmada automáticamente',
      'Pasó el plazo sin reportes del comprador. Tu pago queda liberado.', '/panel/pedidos');
    v_delivered := v_delivered + 1;
  end loop;

  update public.campaigns set status = 'finished' where status in ('active', 'paused') and ends_at <= now();
  get diagnostics v_campaigns = row_count;

  update public.platform_settings set last_expiry_run = now() where id = 1;
  return jsonb_build_object('orders_expired', v_orders, 'offers_expired', v_offers, 'campaigns_finished', v_campaigns,
                            'orders_auto_delivered', v_delivered);
end $$;

revoke execute on function public.report_order_problem(uuid, text) from public, anon, authenticated;
grant execute on function public.report_order_problem(uuid, text) to authenticated;
