-- =====================================================================
-- MARKETXONE · 1300 · Subastas en vivo por fotos
--
-- Reglas de negocio:
-- - Nadie puja sin dinero: para entrar a una subasta se retiene un límite
--   que elige la persona (más el envío). Ninguna puja puede pasar ese límite.
-- - El precio sube de dólar en dólar: cada puja es de al menos $1 más que la
--   anterior y siempre en dólares enteros. Nunca hay dos pujas al mismo precio.
-- - Si alguien puja en los últimos segundos, el reloj se extiende
--   (auction_extend_seconds, 15 s por defecto) para que nadie gane "de último segundo".
-- - Al cerrar, el ganador ya pagó: se cobra de su retención el precio final
--   más el envío. A quienes no ganaron se les libera la retención al instante.
-- - El vendedor acepta la venta o reenlista dentro de auction_decision_minutes
--   (60 min). Si no responde, la venta se confirma sola. Puede reenlistar como
--   máximo auction_max_relists veces (3): en la última ronda la venta es obligatoria.
-- - El vendedor tiene auction_ship_days (3 días) para enviar con número de guía.
--   Si no envía a tiempo, se reembolsa al comprador automáticamente.
-- - Las fotos son obligatorias (mínimo 1) y también las medidas (mínimo 2),
--   el estado y los detalles. La descripción es opcional.
-- - Pagos: hoy funciona en MODO DE PRUEBA (sin dinero real). Con Stripe, cada
--   retención será un PaymentIntent con capture_method = 'manual': se captura
--   el precio final + envío del ganador y se cancelan las demás.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configuración
-- ---------------------------------------------------------------------
alter table public.platform_settings add column if not exists auction_decision_minutes integer not null default 60
  check (auction_decision_minutes between 5 and 1440);
alter table public.platform_settings add column if not exists auction_ship_days integer not null default 3
  check (auction_ship_days between 1 and 14);
alter table public.platform_settings add column if not exists auction_extend_seconds integer not null default 15
  check (auction_extend_seconds between 0 and 120);
alter table public.platform_settings add column if not exists auction_max_relists integer not null default 3
  check (auction_max_relists between 0 and 10);

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table if not exists public.auctions (
  id                  uuid primary key default gen_random_uuid(),
  seller_id           uuid not null references public.profiles(id) on delete cascade,
  store_id            uuid references public.stores(id) on delete set null,
  root_id             uuid,
  previous_id         uuid references public.auctions(id) on delete set null,
  next_id             uuid,
  round               smallint not null default 1 check (round between 1 and 11),
  title               text not null check (char_length(title) between 5 and 120),
  brand               text check (brand is null or char_length(brand) <= 60),
  category_id         text not null references public.categories(id),
  size                text check (size is null or char_length(size) <= 20),
  color               text check (color is null or char_length(color) <= 40),
  condition           text not null check (condition in ('new_with_tags', 'new_without_tags', 'used_excellent', 'used_good', 'used_flawed')),
  flaws               text check (flaws is null or char_length(flaws) <= 1000),
  measurements        jsonb not null default '[]'::jsonb check (jsonb_typeof(measurements) = 'array'),
  description         text not null default '' check (char_length(description) <= 3000),
  photos_confirmed    boolean not null default false check (photos_confirmed),
  start_price_cents   integer not null check (start_price_cents between 100 and 10000000 and start_price_cents % 100 = 0),
  duration_minutes    integer not null check (duration_minutes in (5, 10, 15, 30, 60)),
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  status              text not null default 'open'
                      check (status in ('open', 'awaiting_seller', 'sold', 'relisted', 'unsold', 'cancelled')),
  current_price_cents integer check (current_price_cents is null or current_price_cents >= 100),
  high_bidder_id      uuid references public.profiles(id),
  bid_count           integer not null default 0 check (bid_count >= 0),
  ended_at            timestamptz,
  decision_due_at     timestamptz,
  final_price_cents   integer,
  order_id            uuid references public.orders(id),
  is_demo             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint auction_flawed_requires_description check (condition <> 'used_flawed' or char_length(coalesce(flaws, '')) >= 5),
  constraint auction_times check (ends_at > starts_at)
);
create index if not exists auctions_open_idx on public.auctions (status, ends_at);
create index if not exists auctions_seller_idx on public.auctions (seller_id, created_at desc);
create index if not exists auctions_root_idx on public.auctions (root_id);

create table if not exists public.auction_images (
  id            uuid primary key default gen_random_uuid(),
  auction_id    uuid not null references public.auctions(id) on delete cascade,
  url           text not null check (char_length(url) <= 2000),
  storage_path  text,
  position      smallint not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists auction_images_auction_idx on public.auction_images (auction_id, position);

-- Dinero retenido para poder pujar (uno por persona y subasta).
create table if not exists public.auction_holds (
  id                uuid primary key default gen_random_uuid(),
  auction_id        uuid not null references public.auctions(id) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  limit_cents       integer not null check (limit_cents between 100 and 10000000 and limit_cents % 100 = 0),
  shipping_cents    integer not null check (shipping_cents >= 0),
  held_cents        integer not null check (held_cents >= 0),
  status            text not null default 'held' check (status in ('held', 'captured', 'released')),
  payment_ref       text,
  is_test           boolean not null,
  shipping_address  jsonb not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (auction_id, user_id)
);
create index if not exists auction_holds_user_idx on public.auction_holds (user_id, updated_at desc);

create table if not exists public.auction_bids (
  id            bigint generated always as identity primary key,
  auction_id    uuid not null references public.auctions(id) on delete cascade,
  bidder_id     uuid not null references public.profiles(id) on delete cascade,
  amount_cents  integer not null check (amount_cents >= 100 and amount_cents % 100 = 0),
  created_at    timestamptz not null default now(),
  unique (auction_id, amount_cents)
);
create index if not exists auction_bids_auction_idx on public.auction_bids (auction_id, id desc);
create index if not exists auction_bids_bidder_idx on public.auction_bids (bidder_id, created_at desc);

-- Pedidos que vienen de una subasta (reutilizan envío, entrega, reseñas y disputas).
alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check check (source in ('cart', 'offer', 'auction'));
alter table public.orders add column if not exists auction_id uuid references public.auctions(id);
alter table public.seller_orders add column if not exists ship_by timestamptz;

-- Sin acceso directo a las tablas: todo pasa por las funciones de abajo.
alter table public.auctions enable row level security;
alter table public.auction_images enable row level security;
alter table public.auction_holds enable row level security;
alter table public.auction_bids enable row level security;
revoke all on public.auctions, public.auction_images, public.auction_holds, public.auction_bids from anon, authenticated;

drop trigger if exists set_updated_at on public.auctions;
create trigger set_updated_at before update on public.auctions for each row execute function public.tg_set_updated_at();
drop trigger if exists set_updated_at on public.auction_holds;
create trigger set_updated_at before update on public.auction_holds for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Utilidades internas
-- ---------------------------------------------------------------------
create or replace function public.mz_auction_phase(a public.auctions) returns text
language sql stable as $$
  select case
    when a.status = 'open' and now() < a.starts_at then 'upcoming'
    when a.status = 'open' and now() < a.ends_at then 'live'
    when a.status = 'open' then 'closing'
    else a.status end;
$$;

create or replace function public.mz_auction_visible(a public.auctions) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select a.status <> 'cancelled'
     and exists (select 1 from public.profiles pr where pr.id = a.seller_id and pr.status = 'active')
     and (a.store_id is null or exists (select 1 from public.stores s where s.id = a.store_id and s.status = 'active'))
     and (auth.uid() is null or auth.uid() = a.seller_id or not public.mz_blocked_between(auth.uid(), a.seller_id));
$$;

create or replace function public.mz_auction_card(a public.auctions) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', a.id, 'title', a.title, 'brand', a.brand, 'size', a.size, 'color', a.color, 'condition', a.condition,
    'status', a.status, 'phase', public.mz_auction_phase(a), 'round', a.round,
    'start_price_cents', a.start_price_cents, 'current_price_cents', a.current_price_cents,
    'next_bid_cents', coalesce(a.current_price_cents + 100, a.start_price_cents),
    'final_price_cents', a.final_price_cents, 'bid_count', a.bid_count,
    'starts_at', a.starts_at, 'ends_at', a.ends_at, 'ended_at', a.ended_at, 'decision_due_at', a.decision_due_at,
    'is_demo', a.is_demo, 'created_at', a.created_at,
    'image_url', (select i.url from public.auction_images i where i.auction_id = a.id order by i.position limit 1),
    'bidders', (select count(*) from public.auction_holds h where h.auction_id = a.id),
    'seller', (select jsonb_build_object('username', pr.username, 'display_name', pr.display_name)
               from public.profiles pr where pr.id = a.seller_id)
  );
$$;

create or replace function public.mz_auction_json(a public.auctions) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_s public.platform_settings%rowtype := public.mz_settings();
  v_hold public.auction_holds%rowtype;
begin
  if v_uid is not null then
    select * into v_hold from public.auction_holds where auction_id = a.id and user_id = v_uid;
  end if;
  return public.mz_auction_card(a) || jsonb_build_object(
    'category_id', a.category_id, 'flaws', a.flaws, 'measurements', a.measurements, 'description', a.description,
    'duration_minutes', a.duration_minutes, 'previous_id', a.previous_id, 'next_id', a.next_id,
    'root_start_price_cents', (select r.start_price_cents from public.auctions r where r.id = coalesce(a.root_id, a.id)),
    'order_id', case when v_uid is not null and v_uid in (a.seller_id, a.high_bidder_id) then a.order_id end,
    'max_rounds', v_s.auction_max_relists + 1,
    'relists_left', greatest(0, v_s.auction_max_relists + 1 - a.round),
    'is_final_round', a.round >= v_s.auction_max_relists + 1,
    'shipping_cents', v_s.shipping_flat_cents, 'commission_bps', v_s.commission_bps,
    'extend_seconds', v_s.auction_extend_seconds, 'decision_minutes', v_s.auction_decision_minutes,
    'ship_days', v_s.auction_ship_days, 'test_mode', v_s.test_mode, 'server_now', now(),
    'images', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url) order by i.position)
                        from public.auction_images i where i.auction_id = a.id), '[]'::jsonb),
    'store', (select jsonb_build_object('slug', s.slug, 'name', s.name) from public.stores s where s.id = a.store_id),
    'ship_by', (select so.ship_by from public.seller_orders so where so.order_id = a.order_id limit 1),
    'bids', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'amount_cents', b.amount_cents, 'created_at', b.created_at,
                                                         'mine', b.bidder_id = v_uid,
                                                         'bidder', left(pr.username, 2) || '***' || right(pr.username, 1)) order by b.id desc)
                      from (select * from public.auction_bids where auction_id = a.id order by id desc limit 20) b
                      join public.profiles pr on pr.id = b.bidder_id), '[]'::jsonb),
    'viewer', jsonb_build_object(
      'signed_in', v_uid is not null,
      'is_seller', v_uid is not null and v_uid = a.seller_id,
      'is_high_bidder', v_uid is not null and v_uid = a.high_bidder_id,
      'has_bid', v_uid is not null and exists (select 1 from public.auction_bids b where b.auction_id = a.id and b.bidder_id = v_uid),
      'won', v_uid is not null and v_uid = a.high_bidder_id and a.status in ('awaiting_seller', 'sold'),
      'hold', case when v_hold.id is null then null
                   else jsonb_build_object('limit_cents', v_hold.limit_cents, 'held_cents', v_hold.held_cents,
                                           'shipping_cents', v_hold.shipping_cents, 'status', v_hold.status) end
    )
  );
end $$;

-- Crea el pedido de la subasta y cobra al ganador de lo que ya tenía retenido.
create or replace function public.mz_auction_sell(p_id uuid, p_actor uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.auctions%rowtype;
  v_s public.platform_settings%rowtype := public.mz_settings();
  v_h public.auction_holds%rowtype;
  v_order public.orders%rowtype;
  v_so uuid;
  v_commission integer;
begin
  select * into a from public.auctions where id = p_id for update;
  if not found or a.status <> 'awaiting_seller' then return; end if;
  select * into v_h from public.auction_holds where auction_id = a.id and user_id = a.high_bidder_id for update;
  if public.mz_blocked_between(a.high_bidder_id, a.seller_id) then
    -- Se bloquearon entre sí después de la puja: no hay venta y nadie paga.
    update public.auction_holds set status = 'released' where id = v_h.id;
    update public.auctions set status = 'unsold' where id = a.id;
    perform public.mz_notify(a.high_bidder_id, 'auction_cancelled', format('Sin venta: "%s"', a.title),
      'La venta no se pudo completar. Se liberó tu dinero retenido; no se te cobró nada.', '/subastas');
    return;
  end if;
  v_commission := round(a.final_price_cents * v_s.commission_bps / 10000.0)::int;
  insert into public.orders (buyer_id, source, auction_id, status, is_test, subtotal_cents, shipping_cents, tax_cents, total_cents,
                             shipping_address, payment_due_at)
  values (a.high_bidder_id, 'auction', a.id, 'pending_payment', v_h.is_test, a.final_price_cents, v_h.shipping_cents, 0,
          a.final_price_cents + v_h.shipping_cents, v_h.shipping_address, now() + interval '5 minutes')
  returning * into v_order;
  insert into public.seller_orders (order_id, seller_id, store_id, subtotal_cents, shipping_cents, commission_bps, commission_cents,
                                    seller_net_cents, ship_by)
  values (v_order.id, a.seller_id, a.store_id, a.final_price_cents, v_h.shipping_cents, v_s.commission_bps, v_commission,
          a.final_price_cents - v_commission, now() + make_interval(days => v_s.auction_ship_days))
  returning id into v_so;
  insert into public.order_items (order_id, seller_order_id, product_id, variant_id, title, size, color, image_url,
                                  unit_price_cents, quantity, line_total_cents)
  values (v_order.id, v_so, null, null, a.title, a.size, a.color,
          (select i.url from public.auction_images i where i.auction_id = a.id order by i.position limit 1),
          a.final_price_cents, 1, a.final_price_cents);
  insert into public.payments (order_id, payer_id, provider, provider_ref, amount_cents, status, is_test)
  values (v_order.id, a.high_bidder_id, 'test', coalesce(v_h.payment_ref, 'test_' || replace(gen_random_uuid()::text, '-', '')),
          v_order.total_cents, 'succeeded', true);
  update public.auction_holds set status = 'captured', held_cents = v_order.total_cents where id = v_h.id;
  update public.auctions set status = 'sold', order_id = v_order.id where id = a.id;
  perform public.mz_finalize_paid(v_order.id, p_actor);
  perform public.mz_notify(a.high_bidder_id, 'auction_sold',
    format('Compra confirmada: "%s" por %s', a.title, public.mz_money(a.final_price_cents)),
    format('Se cobró %s (precio final + envío) de tu dinero retenido. El vendedor tiene %s días para enviarlo; si no lo envía, se te reembolsa.',
           public.mz_money(v_order.total_cents), v_s.auction_ship_days),
    '/pedido/' || v_order.id);
  perform public.mz_notify(a.seller_id, 'auction_sold',
    format('Vendido en subasta: "%s" por %s', a.title, public.mz_money(a.final_price_cents)),
    case p_reason
      when 'auto' then format('No respondiste a tiempo y la venta se confirmó sola. Envíalo en menos de %s días con número de guía.', v_s.auction_ship_days)
      when 'final_round' then format('Era la última ronda: la venta es obligatoria. Envíalo en menos de %s días con número de guía.', v_s.auction_ship_days)
      else format('Envíalo en menos de %s días con número de guía. Si no lo envías a tiempo, se reembolsa al comprador.', v_s.auction_ship_days) end,
    '/panel/pedidos');
end $$;

-- Cierra una subasta vencida o confirma la venta si el vendedor no respondió.
create or replace function public.mz_auction_tick(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.auctions%rowtype;
  v_s public.platform_settings%rowtype := public.mz_settings();
  v_left integer;
  r record;
begin
  select * into a from public.auctions where id = p_id for update;
  if not found then return; end if;
  v_left := greatest(0, v_s.auction_max_relists + 1 - a.round);

  if a.status = 'open' and a.ends_at <= now() then
    if a.bid_count = 0 then
      update public.auctions set status = 'unsold', ended_at = now() where id = a.id;
      for r in update public.auction_holds set status = 'released' where auction_id = a.id and status = 'held' returning user_id loop
        perform public.mz_notify(r.user_id, 'auction_ended', format('Terminó "%s" sin pujas', a.title),
          'Se liberó tu dinero retenido; no se te cobró nada.', '/subasta/' || a.id);
      end loop;
      perform public.mz_notify(a.seller_id, 'auction_unsold', format('"%s" terminó sin pujas', a.title),
        case when v_left > 0 then format('Puedes reenlistarla (te quedan %s).', v_left) else 'Ya no quedan reenlistados para este artículo.' end,
        '/subasta/' || a.id);
      return;
    end if;

    for r in update public.auction_holds set status = 'released'
             where auction_id = a.id and status = 'held' and user_id <> a.high_bidder_id returning user_id loop
      perform public.mz_notify(r.user_id, 'auction_lost', format('Subasta terminada: "%s"', a.title),
        format('Ganó otra persona con %s. Se liberó tu dinero retenido; no se te cobró nada.', public.mz_money(a.current_price_cents)),
        '/subasta/' || a.id);
    end loop;
    update public.auctions set status = 'awaiting_seller', ended_at = now(), final_price_cents = a.current_price_cents,
                               decision_due_at = now() + make_interval(mins => v_s.auction_decision_minutes)
     where id = a.id returning * into a;

    if v_left = 0 then
      perform public.mz_auction_sell(a.id, null, 'final_round');
    else
      perform public.mz_notify(a.seller_id, 'auction_decide', format('"%s" terminó en %s', a.title, public.mz_money(a.final_price_cents)),
        format('Acepta la venta o reenlístala (te quedan %s). Si no respondes en %s min, la venta se confirma sola.',
               v_left, v_s.auction_decision_minutes),
        '/subasta/' || a.id);
      perform public.mz_notify(a.high_bidder_id, 'auction_won', format('¡Ganaste "%s" por %s!', a.title, public.mz_money(a.final_price_cents)),
        format('El vendedor tiene %s min para confirmar. Tu dinero sigue retenido: si confirma, se cobra el precio final + envío; si reenlista, se libera.',
               v_s.auction_decision_minutes),
        '/subasta/' || a.id);
    end if;
  elsif a.status = 'awaiting_seller' and a.decision_due_at <= now() then
    perform public.mz_auction_sell(a.id, null, 'auto');
  end if;
end $$;

-- Reembolsa una venta de subasta que el vendedor no envió a tiempo.
create or replace function public.mz_auction_ship_refund(p_seller_order_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_so public.seller_orders%rowtype;
  v_o public.orders%rowtype;
  v_amount integer;
begin
  select * into v_so from public.seller_orders where id = p_seller_order_id for update;
  if not found or v_so.status not in ('paid', 'preparing') then return; end if;
  select * into v_o from public.orders where id = v_so.order_id for update;
  v_amount := v_so.subtotal_cents + v_so.shipping_cents;
  insert into public.refunds (order_id, seller_order_id, amount_cents, reason, status, is_test, restocked, created_by)
  values (v_o.id, v_so.id, v_amount, 'El vendedor no envió a tiempo (subasta).', 'succeeded', v_o.is_test, false, null);
  update public.seller_orders set status = 'refunded', payout_status = 'reversed' where id = v_so.id;
  update public.orders set status = 'refunded' where id = v_o.id;
  perform public.mz_notify(v_o.buyer_id, 'order_refunded', format('Reembolso del pedido #%s', v_o.number),
    format('El vendedor no envió a tiempo. Se te devolvió %s%s.', public.mz_money(v_amount),
           case when v_o.is_test then ' (prueba, sin dinero real)' else '' end), '/pedido/' || v_o.id);
  perform public.mz_notify(v_so.seller_id, 'auction_ship_missed', format('Pedido #%s cancelado', v_o.number),
    'No lo enviaste a tiempo y se reembolsó al comprador.', '/panel/pedidos');
end $$;

-- Tarea programada (y llamada perezosa desde la API).
create or replace function public.mz_auction_sweep() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_ticks integer := 0;
  v_refunds integer := 0;
begin
  for r in
    select id from public.auctions
     where (status = 'open' and ends_at <= now()) or (status = 'awaiting_seller' and decision_due_at <= now())
     order by ends_at limit 200
  loop
    begin
      perform public.mz_auction_tick(r.id);
      v_ticks := v_ticks + 1;
    exception when others then
      raise warning 'auction % tick failed: %', r.id, sqlerrm;
    end;
  end loop;
  for r in
    select so.id from public.seller_orders so join public.orders o on o.id = so.order_id
     where o.source = 'auction' and so.status in ('paid', 'preparing') and so.ship_by is not null and so.ship_by <= now()
     limit 200
  loop
    perform public.mz_auction_ship_refund(r.id);
    v_refunds := v_refunds + 1;
  end loop;
  return jsonb_build_object('auctions_processed', v_ticks, 'auction_orders_refunded', v_refunds);
end $$;

create or replace function public.mz_auction_validate_price(p_cents integer) returns void
language plpgsql immutable as $$
begin
  if p_cents is null or p_cents < 100 or p_cents > 10000000 or p_cents % 100 <> 0 then
    perform public.mz_fail('validation', 'El precio inicial debe ser en dólares enteros, desde $1.', '{"field":"start_price_cents"}');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- API pública
-- ---------------------------------------------------------------------
create or replace function public.list_auctions(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tab text := coalesce(p->>'tab', 'live');
  v_limit integer := least(greatest(coalesce((p->>'limit')::int, 40), 1), 100);
begin
  perform public.mz_auction_sweep();
  return coalesce((
    select jsonb_agg(x.card order by x.sort_key)
    from (
      select public.mz_auction_card(a) as card,
             row_number() over (order by
               case when v_tab = 'live' then a.ends_at end asc,
               case when v_tab = 'upcoming' then a.starts_at end asc,
               case when v_tab = 'ended' then a.ended_at end desc) as sort_key
        from public.auctions a
       where public.mz_auction_visible(a)
         and case v_tab
               when 'live' then a.status = 'open' and a.starts_at <= now() and a.ends_at > now()
               when 'upcoming' then a.status = 'open' and a.starts_at > now()
               when 'ended' then a.status in ('awaiting_seller', 'sold', 'unsold') and a.ended_at > now() - interval '7 days'
               else false end
       order by sort_key
       limit v_limit
    ) x
  ), '[]'::jsonb);
end $$;

create or replace function public.get_auction(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.auctions%rowtype;
begin
  perform public.mz_auction_tick(p_id);
  select * into a from public.auctions where id = p_id;
  if not found or not (public.mz_auction_visible(a) or a.seller_id = auth.uid()
                       or exists (select 1 from public.auction_holds h where h.auction_id = a.id and h.user_id = auth.uid())) then
    perform public.mz_fail('not_found', 'La subasta no existe.');
  end if;
  return public.mz_auction_json(a);
end $$;

create or replace function public.create_auction(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_title text := nullif(trim(coalesce(p->>'title', '')), '');
  v_desc text := nullif(trim(coalesce(p->>'description', '')), '');
  v_condition text := p->>'condition';
  v_flaws text := nullif(trim(coalesce(p->>'flaws', '')), '');
  v_price integer := (p->>'start_price_cents')::int;
  v_duration integer := coalesce((p->>'duration_minutes')::int, 10);
  v_delay integer := coalesce((p->>'starts_in_minutes')::int, 0);
  v_images jsonb := coalesce(p->'images', '[]'::jsonb);
  v_meas jsonb := '[]'::jsonb;
  v_m jsonb;
  v_starts timestamptz;
  a public.auctions%rowtype;
  i integer := 0;
begin
  perform public.mz_rate_limit('auction_create:' || v_uid, 20, interval '1 day');
  if v_title is null or char_length(v_title) < 5 or char_length(v_title) > 120 then
    perform public.mz_fail('validation', 'Escribe un título de 5 a 120 caracteres.', '{"field":"title"}');
  end if;
  if not exists (select 1 from public.categories c where c.id = p->>'category_id' and c.is_active) then
    perform public.mz_fail('validation', 'Elige una categoría.', '{"field":"category_id"}');
  end if;
  if v_condition is null or v_condition not in ('new_with_tags', 'new_without_tags', 'used_excellent', 'used_good', 'used_flawed') then
    perform public.mz_fail('validation', 'Indica el estado del artículo.', '{"field":"condition"}');
  end if;
  if v_condition = 'used_flawed' and char_length(coalesce(v_flaws, '')) < 5 then
    perform public.mz_fail('validation', 'Describe los detalles o defectos (al menos 5 caracteres) y muéstralos en las fotos.', '{"field":"flaws"}');
  end if;
  if char_length(coalesce(v_desc, '')) > 3000 then
    perform public.mz_fail('validation', 'La descripción puede tener hasta 3000 caracteres.', '{"field":"description"}');
  end if;
  if jsonb_typeof(v_images) <> 'array' or jsonb_array_length(v_images) < 1 or jsonb_array_length(v_images) > 12 then
    perform public.mz_fail('validation', 'Sube de 1 a 12 fotos claras del artículo.', '{"field":"images"}');
  end if;
  if exists (select 1 from jsonb_array_elements(v_images) x where coalesce(x->>'url', '') !~ '^https://' or char_length(x->>'url') > 2000) then
    perform public.mz_fail('validation', 'Las fotos deben subirse al almacenamiento de MARKETXONE.', '{"field":"images"}');
  end if;
  if jsonb_typeof(p->'measurements') <> 'array' then
    perform public.mz_fail('validation', 'Agrega al menos 2 medidas.', '{"field":"measurements"}');
  end if;
  for v_m in select * from jsonb_array_elements(p->'measurements') loop
    if char_length(trim(coalesce(v_m->>'label', ''))) between 1 and 30
       and coalesce(v_m->>'value', '') ~ '^[0-9]{1,4}([.,][0-9]{1,2})?$'
       and coalesce(v_m->>'unit', '') in ('in', 'cm') then
      v_meas := v_meas || jsonb_build_array(jsonb_build_object('label', trim(v_m->>'label'),
                                                               'value', replace(v_m->>'value', ',', '.'), 'unit', v_m->>'unit'));
    end if;
  end loop;
  if jsonb_array_length(v_meas) < 2 or jsonb_array_length(v_meas) > 12 then
    perform public.mz_fail('validation', 'Agrega de 2 a 12 medidas con su número y unidad (por ejemplo: Largo 28 in).', '{"field":"measurements"}');
  end if;
  if coalesce((p->>'photos_confirmed')::boolean, false) is not true then
    perform public.mz_fail('validation', 'Confirma que las fotos son claras, reales y muestran los detalles.', '{"field":"photos_confirmed"}');
  end if;
  perform public.mz_auction_validate_price(v_price);
  if v_duration not in (5, 10, 15, 30, 60) then
    perform public.mz_fail('validation', 'Elige una duración válida.', '{"field":"duration_minutes"}');
  end if;
  if v_delay < 0 or v_delay > 10080 then
    perform public.mz_fail('validation', 'La subasta puede empezar ahora o en los próximos 7 días.', '{"field":"starts_in_minutes"}');
  end if;
  if (select count(*) from public.auctions where seller_id = v_uid and status in ('open', 'awaiting_seller')) >= 30 then
    perform public.mz_fail('too_many_auctions', 'Tienes 30 subastas abiertas. Espera a que terminen algunas.');
  end if;
  v_starts := now() + make_interval(mins => v_delay);
  insert into public.auctions (seller_id, store_id, title, brand, category_id, size, color, condition, flaws, measurements, description,
                               photos_confirmed, start_price_cents, duration_minutes, starts_at, ends_at)
  values (v_uid, public.mz_default_store(v_uid), v_title, left(nullif(trim(coalesce(p->>'brand', '')), ''), 60), p->>'category_id',
          left(nullif(trim(coalesce(p->>'size', '')), ''), 20), left(nullif(trim(coalesce(p->>'color', '')), ''), 40),
          v_condition, left(v_flaws, 1000), v_meas, coalesce(v_desc, ''), true, v_price, v_duration,
          v_starts, v_starts + make_interval(mins => v_duration))
  returning * into a;
  update public.auctions set root_id = a.id where id = a.id returning * into a;
  for v_m in select * from jsonb_array_elements(v_images) loop
    insert into public.auction_images (auction_id, url, storage_path, position)
    values (a.id, v_m->>'url', left(v_m->>'storage_path', 500), i);
    i := i + 1;
  end loop;
  return public.mz_auction_json(a);
end $$;

-- Entrar con dinero: retiene un límite (más el envío). Se puede subir en cualquier momento.
create or replace function public.join_auction(p_auction_id uuid, p_limit_cents integer, p_address_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_s public.platform_settings%rowtype := public.mz_settings();
  a public.auctions%rowtype;
  v_h public.auction_holds%rowtype;
  v_addr jsonb;
  v_next integer;
begin
  perform public.mz_rate_limit('auction_join:' || v_uid, 60, interval '1 hour');
  perform public.mz_auction_tick(p_auction_id);
  select * into a from public.auctions where id = p_auction_id for update;
  if not found or not public.mz_auction_visible(a) then perform public.mz_fail('not_found', 'La subasta no existe.'); end if;
  if public.mz_auction_phase(a) not in ('upcoming', 'live') then
    perform public.mz_fail('auction_closed', 'Esta subasta ya terminó.');
  end if;
  if a.seller_id = v_uid then perform public.mz_fail('own_item', 'No puedes pujar en tu propia subasta.'); end if;
  if public.mz_blocked_between(v_uid, a.seller_id) then perform public.mz_fail('blocked', 'No puedes comprar ni hacer ofertas a esta persona.'); end if;
  if a.is_demo and not v_s.test_mode then perform public.mz_fail('demo_item', 'Esta es una subasta de ejemplo.'); end if;
  if not v_s.test_mode then
    perform public.mz_fail('payments_not_ready', 'Los pagos reales todavía no están activos.');
  end if;
  v_next := coalesce(a.current_price_cents + 100, a.start_price_cents);
  if p_limit_cents is null or p_limit_cents % 100 <> 0 or p_limit_cents < v_next or p_limit_cents > 10000000 then
    perform public.mz_fail('validation', format('Tu límite debe ser en dólares enteros y de al menos %s.', public.mz_money(v_next)),
                           jsonb_build_object('field', 'limit_cents', 'min_cents', v_next));
  end if;
  select * into v_h from public.auction_holds where auction_id = a.id and user_id = v_uid for update;
  if found and v_h.status = 'held' then
    if a.high_bidder_id = v_uid and p_limit_cents < a.current_price_cents then
      perform public.mz_fail('validation', 'Vas ganando: tu límite no puede quedar por debajo de tu puja actual.');
    end if;
    update public.auction_holds set limit_cents = p_limit_cents, held_cents = p_limit_cents + shipping_cents
     where id = v_h.id;
    return public.mz_auction_json(a);
  end if;
  select jsonb_build_object('full_name', ad.full_name, 'line1', ad.line1, 'line2', ad.line2, 'city', ad.city,
                            'region', ad.region, 'postal_code', ad.postal_code, 'country', ad.country, 'phone', ad.phone)
    into v_addr from public.addresses ad
   where ad.user_id = v_uid and (p_address_id is null or ad.id = p_address_id)
   order by ad.is_default desc, ad.created_at limit 1;
  if v_addr is null then
    perform public.mz_fail('address_required', 'Agrega una dirección de envío: si ganas, el artículo se envía ahí.');
  end if;
  insert into public.auction_holds (auction_id, user_id, limit_cents, shipping_cents, held_cents, status, payment_ref, is_test, shipping_address)
  values (a.id, v_uid, p_limit_cents, v_s.shipping_flat_cents, p_limit_cents + v_s.shipping_flat_cents, 'held',
          'test_hold_' || replace(gen_random_uuid()::text, '-', ''), true, v_addr)
  on conflict (auction_id, user_id) do update set limit_cents = excluded.limit_cents, held_cents = excluded.held_cents,
    status = 'held', payment_ref = excluded.payment_ref, shipping_address = excluded.shipping_address;
  return public.mz_auction_json(a);
end $$;

create or replace function public.place_bid(p_auction_id uuid, p_amount_cents integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_s public.platform_settings%rowtype := public.mz_settings();
  a public.auctions%rowtype;
  v_h public.auction_holds%rowtype;
  v_next integer;
  v_prev uuid;
begin
  perform public.mz_rate_limit('bid:' || v_uid, 300, interval '10 minutes');
  perform public.mz_auction_tick(p_auction_id);
  select * into a from public.auctions where id = p_auction_id for update;
  if not found or not public.mz_auction_visible(a) then perform public.mz_fail('not_found', 'La subasta no existe.'); end if;
  if public.mz_auction_phase(a) = 'upcoming' then perform public.mz_fail('auction_not_started', 'La subasta todavía no empieza.'); end if;
  if public.mz_auction_phase(a) <> 'live' then perform public.mz_fail('auction_closed', 'Esta subasta ya terminó.'); end if;
  if a.seller_id = v_uid then perform public.mz_fail('own_item', 'No puedes pujar en tu propia subasta.'); end if;
  if public.mz_blocked_between(v_uid, a.seller_id) then perform public.mz_fail('blocked', 'No puedes comprar ni hacer ofertas a esta persona.'); end if;
  select * into v_h from public.auction_holds where auction_id = a.id and user_id = v_uid;
  if not found or v_h.status <> 'held' then
    perform public.mz_fail('hold_required', 'Para pujar, primero entra a la subasta con tu dinero retenido.');
  end if;
  if a.high_bidder_id = v_uid then
    perform public.mz_fail('already_winning', 'Ya vas ganando. Espera a que alguien te supere.');
  end if;
  v_next := coalesce(a.current_price_cents + 100, a.start_price_cents);
  if p_amount_cents is null or p_amount_cents % 100 <> 0 then
    perform public.mz_fail('validation', 'Las pujas van en dólares enteros.');
  end if;
  if p_amount_cents < v_next then
    perform public.mz_fail('outbid', format('Alguien pujó antes que tú. La siguiente puja es de %s.', public.mz_money(v_next)),
                           jsonb_build_object('current_price_cents', a.current_price_cents, 'next_bid_cents', v_next));
  end if;
  if p_amount_cents > v_h.limit_cents then
    perform public.mz_fail('limit_reached', format('Esa puja pasa tu límite retenido de %s. Sube tu límite para seguir pujando.',
                                                   public.mz_money(v_h.limit_cents)),
                           jsonb_build_object('limit_cents', v_h.limit_cents));
  end if;
  v_prev := a.high_bidder_id;
  insert into public.auction_bids (auction_id, bidder_id, amount_cents) values (a.id, v_uid, p_amount_cents);
  update public.auctions set current_price_cents = p_amount_cents, high_bidder_id = v_uid, bid_count = bid_count + 1,
    ends_at = greatest(ends_at, now() + make_interval(secs => v_s.auction_extend_seconds))
   where id = a.id returning * into a;
  if v_prev is not null and v_prev <> v_uid and not exists (
       select 1 from public.notifications n where n.user_id = v_prev and n.kind = 'auction_outbid'
          and n.link = '/subasta/' || a.id and n.created_at > now() - interval '2 minutes') then
    perform public.mz_notify(v_prev, 'auction_outbid', format('Te superaron en "%s"', a.title),
      format('La puja va en %s. Entra para seguir pujando.', public.mz_money(p_amount_cents)), '/subasta/' || a.id);
  end if;
  return public.mz_auction_json(a);
end $$;

-- Decisión del vendedor al terminar: aceptar la venta o reenlistar (máximo 3 veces).
create or replace function public.auction_decide(p_auction_id uuid, p_action text, p_start_price_cents integer default null,
                                                 p_duration_minutes integer default null, p_starts_in_minutes integer default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_s public.platform_settings%rowtype := public.mz_settings();
  a public.auctions%rowtype;
  n public.auctions%rowtype;
  v_price integer;
  v_duration integer;
  v_delay integer := coalesce(p_starts_in_minutes, 0);
begin
  perform public.mz_rate_limit('auction_decide:' || v_uid, 60, interval '1 hour');
  perform public.mz_auction_tick(p_auction_id);
  select * into a from public.auctions where id = p_auction_id for update;
  if not found or a.seller_id <> v_uid then perform public.mz_fail('not_found', 'La subasta no existe.'); end if;

  if p_action = 'accept' then
    if a.status <> 'awaiting_seller' then
      perform public.mz_fail('invalid_action', 'Esta subasta no está esperando tu decisión.');
    end if;
    perform public.mz_auction_sell(a.id, v_uid, 'accepted');
    select * into a from public.auctions where id = a.id;
    return public.mz_auction_json(a);
  end if;

  if p_action <> 'relist' then perform public.mz_fail('invalid_action', 'Acción no válida.'); end if;
  if a.status not in ('awaiting_seller', 'unsold') then
    perform public.mz_fail('invalid_action', 'Solo puedes reenlistar una subasta terminada que no se vendió.');
  end if;
  if a.round >= v_s.auction_max_relists + 1 then
    perform public.mz_fail('no_relists_left', format('Ya reenlistaste este artículo %s veces: la última ronda es obligatoria.', v_s.auction_max_relists));
  end if;
  v_price := coalesce(p_start_price_cents, a.start_price_cents);
  perform public.mz_auction_validate_price(v_price);
  -- Al reenlistar no se puede subir el precio inicial original (evita esquivar la venta obligatoria).
  if v_price > (select r.start_price_cents from public.auctions r where r.id = coalesce(a.root_id, a.id)) then
    perform public.mz_fail('validation', format('Al reenlistar, el precio inicial no puede pasar el original de %s.',
      public.mz_money((select r.start_price_cents from public.auctions r where r.id = coalesce(a.root_id, a.id)))),
      '{"field":"start_price_cents"}');
  end if;
  v_duration := coalesce(p_duration_minutes, a.duration_minutes);
  if v_duration not in (5, 10, 15, 30, 60) then perform public.mz_fail('validation', 'Elige una duración válida.'); end if;
  if v_delay < 0 or v_delay > 10080 then perform public.mz_fail('validation', 'La subasta puede empezar ahora o en los próximos 7 días.'); end if;

  if a.status = 'awaiting_seller' then
    update public.auction_holds set status = 'released' where auction_id = a.id and status = 'held';
    perform public.mz_notify(a.high_bidder_id, 'auction_relisted', format('El vendedor reenlistó "%s"', a.title),
      'No aceptó el precio final y lo volverá a subastar. Se liberó tu dinero retenido; no se te cobró nada.', '/subasta/' || a.id);
  end if;
  insert into public.auctions (seller_id, store_id, root_id, previous_id, round, title, brand, category_id, size, color, condition, flaws,
                               measurements, description, photos_confirmed, start_price_cents, duration_minutes, starts_at, ends_at, is_demo)
  values (a.seller_id, a.store_id, coalesce(a.root_id, a.id), a.id, a.round + 1, a.title, a.brand, a.category_id, a.size, a.color,
          a.condition, a.flaws, a.measurements, a.description, true, v_price, v_duration,
          now() + make_interval(mins => v_delay), now() + make_interval(mins => v_delay + v_duration), a.is_demo)
  returning * into n;
  insert into public.auction_images (auction_id, url, storage_path, position)
  select n.id, i.url, i.storage_path, i.position from public.auction_images i where i.auction_id = a.id;
  update public.auctions set status = 'relisted', next_id = n.id where id = a.id;
  return public.mz_auction_json(n);
end $$;

-- Cancelar solo mientras nadie haya pujado (protege a quien ya pujó).
create or replace function public.cancel_auction(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  a public.auctions%rowtype;
  r record;
begin
  perform public.mz_auction_tick(p_id);
  select * into a from public.auctions where id = p_id for update;
  if not found or a.seller_id <> v_uid then perform public.mz_fail('not_found', 'La subasta no existe.'); end if;
  if not ((a.status = 'open' and a.bid_count = 0) or a.status = 'unsold') then
    perform public.mz_fail('invalid_action', 'Ya hay pujas: la subasta no se puede cancelar.');
  end if;
  for r in update public.auction_holds set status = 'released' where auction_id = a.id and status = 'held' returning user_id loop
    perform public.mz_notify(r.user_id, 'auction_cancelled', format('Se canceló "%s"', a.title),
      'El vendedor canceló la subasta antes de recibir pujas. Se liberó tu dinero retenido.', '/subastas');
  end loop;
  update public.auctions set status = 'cancelled', ended_at = coalesce(ended_at, now()) where id = a.id returning * into a;
  return public.mz_auction_json(a);
end $$;

create or replace function public.my_auctions(p_role text default 'buyer') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user();
begin
  perform public.mz_auction_sweep();
  if p_role = 'seller' then
    return coalesce((select jsonb_agg(x.j order by x.created_at desc)
                     from (select public.mz_auction_json(a) - 'bids' - 'images' - 'description' as j, a.created_at
                             from public.auctions a where a.seller_id = v_uid and a.status <> 'cancelled'
                            order by a.created_at desc limit 100) x), '[]'::jsonb);
  end if;
  return coalesce((select jsonb_agg(x.j order by x.updated_at desc)
                   from (select public.mz_auction_json(a) - 'bids' - 'images' - 'description' as j, h.updated_at
                           from public.auction_holds h join public.auctions a on a.id = h.auction_id
                          where h.user_id = v_uid and h.updated_at > now() - interval '60 days'
                          order by h.updated_at desc limit 100) x), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function
  public.mz_auction_phase(public.auctions), public.mz_auction_visible(public.auctions), public.mz_auction_card(public.auctions),
  public.mz_auction_json(public.auctions), public.mz_auction_sell(uuid, uuid, text), public.mz_auction_tick(uuid),
  public.mz_auction_ship_refund(uuid), public.mz_auction_sweep(), public.mz_auction_validate_price(integer),
  public.list_auctions(jsonb), public.get_auction(uuid), public.create_auction(jsonb), public.join_auction(uuid, integer, uuid),
  public.place_bid(uuid, integer), public.auction_decide(uuid, text, integer, integer, integer), public.cancel_auction(uuid),
  public.my_auctions(text)
from public, anon, authenticated;

grant execute on function public.list_auctions(jsonb), public.get_auction(uuid) to anon, authenticated;
grant execute on function
  public.create_auction(jsonb), public.join_auction(uuid, integer, uuid), public.place_bid(uuid, integer),
  public.auction_decide(uuid, text, integer, integer, integer), public.cancel_auction(uuid), public.my_auctions(text)
to authenticated;
grant execute on function public.mz_auction_sweep() to service_role;

-- Cada minuto se cierran subastas y se reembolsan envíos vencidos (además del cierre al instante en la API).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('marketxone-auctions', '* * * * *', 'select public.mz_auction_sweep()');
  end if;
exception when others then
  raise notice 'pg_cron no disponible: %', sqlerrm;
end $$;
