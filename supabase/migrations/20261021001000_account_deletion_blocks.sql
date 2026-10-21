-- =====================================================================
-- MARKETZONE · 1000 · Eliminar cuenta y bloquear usuarios
-- Requisitos de App Store y Google Play para apps con cuentas y contenido
-- publicado por usuarios.
--
-- Eliminar cuenta: se borran los datos personales (perfil, direcciones,
-- favoritos, carrito, notificaciones, bloqueos) y se cierra el acceso.
-- Si la cuenta nunca compró ni vendió, se borra por completo. Si tiene
-- pedidos, estos se conservan anónimos porque son registros contables de
-- la otra parte; el perfil queda como "Cuenta eliminada".
-- =====================================================================

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check check (status in ('active', 'suspended', 'deleted'));
alter table public.profiles add column if not exists deleted_at timestamptz;

create table if not exists public.user_blocks (
  blocker_id  uuid not null references public.profiles(id) on delete cascade,
  blocked_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);
alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from anon, authenticated;
-- Sin políticas: solo se accede mediante las funciones de abajo.

-- ¿Hay un bloqueo entre estas dos personas, en cualquier sentido?
create or replace function public.mz_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_blocks
                 where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

-- Cuentas eliminadas no pueden usar la API aunque conserven un token vigente.
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
  if v_status is null or v_status = 'deleted' then
    perform public.mz_fail('account_deleted', 'Esta cuenta fue eliminada.');
  end if;
  if v_status = 'suspended' then
    perform public.mz_fail('account_suspended', 'Tu cuenta está suspendida. Contacta con soporte.');
  end if;
  return v_uid;
end $$;

-- El catálogo público oculta a quien bloqueaste y a quien te bloqueó.
create or replace function public.mz_public_products() returns setof public.products
language sql stable as $$
  select p.*
  from public.products p
  join public.stores s on s.id = p.store_id and s.status = 'active'
  join public.profiles pr on pr.id = p.seller_id and pr.status = 'active'
  where p.status = 'active' and p.moderation_status = 'ok'
    and (auth.uid() is null or not public.mz_blocked_between(auth.uid(), p.seller_id));
$$;

-- Bloqueo aplicado en la base de datos: ni ofertas, ni carrito, ni pedidos entre personas bloqueadas.
create or replace function public.tg_enforce_blocks() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_buyer uuid; v_seller uuid;
begin
  if tg_table_name = 'offers' then
    v_buyer := new.buyer_id; v_seller := new.seller_id;
  elsif tg_table_name = 'cart_items' then
    v_buyer := new.user_id;
    select p.seller_id into v_seller from public.product_variants v join public.products p on p.id = v.product_id where v.id = new.variant_id;
  elsif tg_table_name = 'seller_orders' then
    v_seller := new.seller_id;
    select o.buyer_id into v_buyer from public.orders o where o.id = new.order_id;
  end if;
  if v_buyer is not null and v_seller is not null and public.mz_blocked_between(v_buyer, v_seller) then
    perform public.mz_fail('blocked', 'No puedes comprar ni hacer ofertas a esta persona.');
  end if;
  return new;
end $$;

drop trigger if exists enforce_blocks on public.offers;
create trigger enforce_blocks before insert on public.offers for each row execute function public.tg_enforce_blocks();
drop trigger if exists enforce_blocks on public.cart_items;
create trigger enforce_blocks before insert on public.cart_items for each row execute function public.tg_enforce_blocks();
drop trigger if exists enforce_blocks on public.seller_orders;
create trigger enforce_blocks before insert on public.seller_orders for each row execute function public.tg_enforce_blocks();

create or replace function public.toggle_block(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user();
begin
  if p_user_id = v_uid then perform public.mz_fail('validation', 'No puedes bloquearte a ti mismo.'); end if;
  if not exists (select 1 from public.profiles where id = p_user_id and status <> 'deleted') then
    perform public.mz_fail('not_found', 'Ese usuario no existe.');
  end if;
  perform public.mz_rate_limit('block:' || v_uid, 30, interval '1 hour');
  if exists (select 1 from public.user_blocks where blocker_id = v_uid and blocked_id = p_user_id) then
    delete from public.user_blocks where blocker_id = v_uid and blocked_id = p_user_id;
    return jsonb_build_object('blocked', false);
  end if;
  insert into public.user_blocks (blocker_id, blocked_id) values (v_uid, p_user_id);
  -- Lo pendiente entre ambos se cancela: ofertas abiertas y artículos suyos en tu carrito (y viceversa).
  update public.offers set status = 'cancelled', awaiting = 'none'
   where status in ('pending', 'countered')
     and ((buyer_id = v_uid and seller_id = p_user_id) or (buyer_id = p_user_id and seller_id = v_uid));
  delete from public.cart_items c using public.product_variants v, public.products p
   where c.variant_id = v.id and v.product_id = p.id
     and ((c.user_id = v_uid and p.seller_id = p_user_id) or (c.user_id = p_user_id and p.seller_id = v_uid));
  return jsonb_build_object('blocked', true);
end $$;

create or replace function public.my_blocks() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'username', pr.username, 'display_name', pr.display_name,
                                               'avatar_url', pr.avatar_url, 'blocked_at', b.created_at) order by b.created_at desc), '[]'::jsonb)
  from public.user_blocks b join public.profiles pr on pr.id = b.blocked_id
  where b.blocker_id = public.mz_require_user();
$$;

create or replace function public.delete_my_account(p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  r record;
  v_has_history boolean;
begin
  if upper(trim(coalesce(p_confirm, ''))) <> 'ELIMINAR' then
    perform public.mz_fail('validation', 'Escribe ELIMINAR para confirmar.', '{"field":"confirm"}');
  end if;
  if exists (select 1 from public.seller_orders where seller_id = v_uid and status in ('paid', 'preparing', 'shipped')) then
    perform public.mz_fail('pending_sales', 'Tienes ventas pagadas sin entregar. Envíalas o reembólsalas antes de eliminar tu cuenta.');
  end if;
  if exists (select 1 from public.seller_orders so join public.orders o on o.id = so.order_id
             where o.buyer_id = v_uid and so.status in ('paid', 'preparing', 'shipped')) then
    perform public.mz_fail('pending_purchases', 'Tienes compras pagadas que aún no llegan. Espera a recibirlas antes de eliminar tu cuenta.');
  end if;

  -- Pedidos sin pagar en los que participa (como comprador o vendedor): se cancelan y se libera el stock.
  for r in
    select distinct o.id, o.buyer_id, o.number, o.offer_id from public.orders o
    left join public.seller_orders so on so.order_id = o.id
    where o.status = 'pending_payment' and (o.buyer_id = v_uid or so.seller_id = v_uid)
  loop
    perform public.mz_release_order(r.id, 'released', v_uid);
    update public.orders set status = 'cancelled', cancelled_at = now() where id = r.id;
    update public.seller_orders set status = 'cancelled' where order_id = r.id;
    if r.offer_id is not null then
      update public.offers set status = 'cancelled', awaiting = 'none' where id = r.offer_id;
    end if;
    if r.buyer_id <> v_uid then
      perform public.mz_notify(r.buyer_id, 'order_cancelled', format('Pedido #%s cancelado', r.number),
        'El vendedor cerró su cuenta antes de que pagaras. No se cobró nada.', '/pedido/' || r.id);
    end if;
  end loop;

  update public.offers set status = 'cancelled', awaiting = 'none'
   where status in ('pending', 'countered') and (buyer_id = v_uid or seller_id = v_uid);
  update public.products set status = 'removed' where seller_id = v_uid and status <> 'removed';
  update public.stores set status = 'suspended' where owner_id = v_uid;
  update public.businesses set status = 'suspended' where owner_id = v_uid;
  update public.campaigns set status = 'finished' where owner_id = v_uid and status in ('draft', 'pending_review', 'pending_payment', 'active', 'paused');

  delete from public.addresses where user_id = v_uid;
  delete from public.cart_items where user_id = v_uid;
  delete from public.favorites where user_id = v_uid;
  delete from public.follows where user_id = v_uid;
  delete from public.notifications where user_id = v_uid;
  delete from public.user_blocks where blocker_id = v_uid or blocked_id = v_uid;

  v_has_history := exists (select 1 from public.orders where buyer_id = v_uid)
                or exists (select 1 from public.seller_orders where seller_id = v_uid)
                or exists (select 1 from public.payments where payer_id = v_uid);

  update public.profiles set
    username = 'eliminado_' || substr(replace(id::text, '-', ''), 1, 12),
    display_name = 'Cuenta eliminada', avatar_url = null, bio = null, preferences = '{}'::jsonb,
    status = 'deleted', deleted_at = now()
  where id = v_uid;
  update public.stores set name = 'Tienda cerrada', bio = null, logo_url = null, cover_url = null,
    social_links = '{}'::jsonb, business_info = '{}'::jsonb where owner_id = v_uid;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (null, 'account_deleted', 'profile', v_uid, jsonb_build_object('kept_order_history', v_has_history));

  -- Acceso: se borra el usuario de Auth (o, si tiene pedidos, se cierra y se libera su correo).
  -- Si el proyecto no permite tocar el esquema auth desde SQL, los datos personales ya quedaron
  -- borrados y la cuenta queda bloqueada por mz_require_user(); se deja registro para limpiarlo.
  begin
    if v_has_history then
      update auth.users set email = v_uid::text || '@eliminado.invalid', phone = null, encrypted_password = null,
        raw_user_meta_data = '{}'::jsonb, banned_until = 'infinity'::timestamptz where id = v_uid;
      delete from auth.identities where user_id = v_uid;
      delete from auth.sessions where user_id = v_uid;
    else
      delete from auth.users where id = v_uid; -- borra en cascada el perfil y todo lo suyo
    end if;
  exception when insufficient_privilege then
    insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
    values (null, 'auth_cleanup_pending', 'profile', v_uid, '{"motivo":"sin permiso sobre auth; borrar el usuario desde Authentication en el panel"}'::jsonb);
  end;
  return jsonb_build_object('deleted', true, 'kept_order_history', v_has_history);
end $$;

revoke execute on function public.toggle_block(uuid), public.my_blocks(), public.delete_my_account(text),
  public.mz_blocked_between(uuid, uuid), public.tg_enforce_blocks() from public, anon, authenticated;
grant execute on function public.toggle_block(uuid), public.my_blocks(), public.delete_my_account(text) to authenticated;
