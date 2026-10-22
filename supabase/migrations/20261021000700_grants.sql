-- =====================================================================
-- MARKETXONE · 0700 · Permisos de ejecución de funciones
-- Supabase concede EXECUTE por defecto a anon/authenticated sobre funciones
-- nuevas: aquí se revoca todo y se concede solo la API pública prevista.
-- IMPORTANTE: cualquier función nueva debe añadirse explícitamente aquí.
-- =====================================================================
revoke execute on all functions in schema public from public, anon, authenticated;

-- Usadas dentro de políticas RLS (se evalúan con el rol de quien consulta).
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_order_buyer(uuid) to anon, authenticated;
grant execute on function public.is_order_seller(uuid) to anon, authenticated;

-- Lectura pública (visitantes y usuarios).
grant execute on function
  public.public_settings(), public.list_categories(), public.home_feed(), public.search_products(jsonb),
  public.get_product(uuid), public.get_store(text), public.get_business(text), public.list_businesses(jsonb),
  public.track_event(jsonb), public.expire_stale()
to anon, authenticated;

-- Usuarios autenticados.
grant execute on function
  public.my_account(), public.update_profile(jsonb), public.save_address(jsonb), public.delete_address(uuid),
  public.save_store(jsonb), public.toggle_follow(uuid), public.toggle_favorite(uuid), public.my_favorites(),
  public.my_notifications(), public.mark_notifications_read(uuid[]),
  public.save_listing(jsonb), public.set_listing_status(uuid[], text), public.quick_update_variant(uuid, integer),
  public.quick_update_price(uuid, integer), public.bulk_adjust_price(uuid[], integer), public.get_listing_for_edit(uuid),
  public.seller_catalog(jsonb), public.inventory_history(uuid), public.seller_dashboard(),
  public.cart_add(uuid, integer), public.cart_update(uuid, integer), public.cart_remove(uuid), public.get_cart(),
  public.checkout(uuid), public.pay_order_test(uuid), public.cancel_order(uuid), public.set_order_address(uuid, uuid),
  public.get_order(uuid), public.my_orders(), public.seller_orders_list(text),
  public.seller_update_fulfillment(uuid, text, text, text), public.buyer_confirm_delivery(uuid),
  public.refund_seller_order(uuid, text, boolean),
  public.make_offer(uuid, integer, integer), public.respond_offer(uuid, text, integer), public.my_offers(text),
  public.save_business(jsonb), public.save_campaign(jsonb), public.submit_campaign(uuid), public.pay_campaign_test(uuid),
  public.set_campaign_paused(uuid, boolean), public.delete_campaign(uuid), public.my_campaigns(), public.campaign_stats(uuid),
  public.create_review(uuid, integer, text), public.create_report(text, uuid, text, text),
  public.admin_overview(), public.admin_list(text, jsonb), public.admin_update_settings(jsonb),
  public.admin_moderate(text, uuid, text, text)
to authenticated;

-- Solo servidor (webhooks del proveedor de pagos, tareas programadas).
grant execute on function
  public.mark_order_paid(uuid, text, text, integer), public.mark_campaign_paid(uuid, text, text, integer),
  public.mz_expire_due(), public.expire_stale()
to service_role;
