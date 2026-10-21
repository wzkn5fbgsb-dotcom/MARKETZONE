// API tipada de MARKETZONE. Cada método llama a una función del servidor con los mismos
// nombres de parámetros en Supabase y en el motor de demostración.
import type { Backend } from "./backend";
import type * as T from "./types";

export class MarketApi {
  constructor(readonly backend: Backend) {}
  private call<R>(fn: string, args: Record<string, unknown> = {}) { return this.backend.rpc<R>(fn, args); }

  // Público
  settings() { return this.call<T.PublicSettings>("public_settings"); }
  categories() { return this.call<T.Category[]>("list_categories"); }
  home() { return this.call<T.HomeFeed>("home_feed"); }
  search(p: T.SearchParams) { return this.call<T.SearchResult>("search_products", { p }); }
  product(id: string) { return this.call<T.ProductDetail>("get_product", { p_id: id }); }
  store(slug: string) { return this.call<T.StorePage>("get_store", { p_slug: slug }); }
  business(slug: string) { return this.call<T.BusinessPage>("get_business", { p_slug: slug }); }
  businesses(p: { category?: string; q?: string } = {}) { return this.call<T.BusinessCard[]>("list_businesses", { p }); }
  track(p: { kind: string; product_id?: string; store_id?: string; business_id?: string; campaign_id?: string; session_id?: string }) {
    return this.call<void>("track_event", { p });
  }
  expireStale() { return this.call<unknown>("expire_stale"); }

  // Cuenta
  account() { return this.call<T.Account>("my_account"); }
  updateProfile(p: Partial<{ username: string; display_name: string; bio: string; avatar_url: string; preferences: Record<string, unknown> }>) {
    return this.call<T.Account>("update_profile", { p });
  }
  saveAddress(p: Partial<T.Address>) { return this.call<T.Address>("save_address", { p }); }
  deleteAddress(id: string) { return this.call<void>("delete_address", { p_id: id }); }
  saveStore(p: Record<string, unknown>) { return this.call<T.StoreCard>("save_store", { p }); }
  toggleFollow(storeId: string) { return this.call<{ following: boolean; followers: number }>("toggle_follow", { p_store_id: storeId }); }
  toggleFavorite(productId: string) { return this.call<{ favorite: boolean }>("toggle_favorite", { p_product_id: productId }); }
  favorites() { return this.call<T.ProductCard[]>("my_favorites"); }
  notifications() { return this.call<T.Notification[]>("my_notifications"); }
  markNotificationsRead(ids: string[] | null = null) { return this.call<void>("mark_notifications_read", { p_ids: ids }); }

  // Publicaciones
  saveListing(p: T.ListingInput) { return this.call<{ id: string; status: T.ListingStatus }>("save_listing", { p }); }
  setListingStatus(ids: string[], status: T.ListingStatus) { return this.call<{ updated: number }>("set_listing_status", { p_ids: ids, p_status: status }); }
  quickStock(variantId: string, qty: number) {
    return this.call<{ id: string; stock_on_hand: number; stock_reserved: number; available: number }>("quick_update_variant", { p_variant_id: variantId, p_stock_on_hand: qty });
  }
  quickPrice(productId: string, cents: number) { return this.call<{ id: string; price_cents: number; compare_at_cents: number | null }>("quick_update_price", { p_product_id: productId, p_price_cents: cents }); }
  bulkPrice(ids: string[], percent: number) { return this.call<{ updated: number }>("bulk_adjust_price", { p_ids: ids, p_percent: percent }); }
  listingForEdit(id: string) { return this.call<T.ListingInput & { id: string; status: T.ListingStatus; moderation_status: string; variants: (T.ListingInput["variants"][number] & { stock_reserved: number })[] }>("get_listing_for_edit", { p_id: id }); }
  catalog(p: Record<string, unknown> = {}) { return this.call<T.CatalogResult>("seller_catalog", { p }); }
  inventoryHistory(productId: string) { return this.call<T.InventoryMovement[]>("inventory_history", { p_product_id: productId }); }
  dashboard() { return this.call<T.SellerDashboard>("seller_dashboard"); }

  // Carrito y pedidos
  cart() { return this.call<T.Cart>("get_cart"); }
  cartAdd(variantId: string, qty = 1) { return this.call<T.Cart>("cart_add", { p_variant_id: variantId, p_quantity: qty }); }
  cartUpdate(itemId: string, qty: number) { return this.call<T.Cart>("cart_update", { p_item_id: itemId, p_quantity: qty }); }
  cartRemove(itemId: string) { return this.call<T.Cart>("cart_remove", { p_item_id: itemId }); }
  checkout(addressId: string) {
    return this.call<{ order_id: string; number: number; total_cents: number; payment_due_at: string; is_test: boolean }>("checkout", { p_address_id: addressId });
  }
  payTest(orderId: string) { return this.call<{ order_id: string; status: string; is_test?: boolean }>("pay_order_test", { p_order_id: orderId }); }
  cancelOrder(orderId: string) { return this.call<{ order_id: string; status: string }>("cancel_order", { p_order_id: orderId }); }
  setOrderAddress(orderId: string, addressId: string) { return this.call<T.Order>("set_order_address", { p_order_id: orderId, p_address_id: addressId }); }
  order(id: string) { return this.call<T.Order>("get_order", { p_order_id: id }); }
  orders() { return this.call<T.OrderSummary[]>("my_orders"); }
  sellerOrders(status: string | null = null) { return this.call<T.SellerOrder[]>("seller_orders_list", { p_status: status }); }
  fulfill(sellerOrderId: string, status: "preparing" | "shipped" | "delivered", carrier?: string, tracking?: string) {
    return this.call<T.SellerOrder>("seller_update_fulfillment", { p_seller_order_id: sellerOrderId, p_status: status, p_carrier: carrier ?? null, p_tracking: tracking ?? null });
  }
  reportProblem(sellerOrderId: string, reason: string) { return this.call<{ dispute_status: string }>("report_order_problem", { p_seller_order_id: sellerOrderId, p_reason: reason }); }
  confirmDelivery(sellerOrderId: string) { return this.call<T.Order>("buyer_confirm_delivery", { p_seller_order_id: sellerOrderId }); }
  refund(sellerOrderId: string, reason: string, restock = true) {
    return this.call<T.Order>("refund_seller_order", { p_seller_order_id: sellerOrderId, p_reason: reason, p_restock: restock });
  }

  // Ofertas
  makeOffer(variantId: string, amountCents: number, qty = 1, addressId?: string | null) { return this.call<T.Offer>("make_offer", { p_variant_id: variantId, p_amount_cents: amountCents, p_quantity: qty, p_address_id: addressId ?? null }); }
  respondOffer(offerId: string, action: "accept" | "decline" | "counter" | "cancel", amountCents?: number) {
    return this.call<T.Offer>("respond_offer", { p_offer_id: offerId, p_action: action, p_amount_cents: amountCents ?? null });
  }
  offers(role: "buyer" | "seller") { return this.call<T.Offer[]>("my_offers", { p_role: role }); }

  // Negocios y campañas
  saveBusiness(p: Record<string, unknown>) { return this.call<T.Business>("save_business", { p }); }
  saveCampaign(p: Record<string, unknown>) { return this.call<T.Campaign>("save_campaign", { p }); }
  submitCampaign(id: string) { return this.call<T.Campaign>("submit_campaign", { p_id: id }); }
  payCampaignTest(id: string) { return this.call<T.Campaign>("pay_campaign_test", { p_id: id }); }
  pauseCampaign(id: string, paused: boolean) { return this.call<T.Campaign>("set_campaign_paused", { p_id: id, p_paused: paused }); }
  deleteCampaign(id: string) { return this.call<void>("delete_campaign", { p_id: id }); }
  campaigns() { return this.call<T.Campaign[]>("my_campaigns"); }
  campaignStats(id: string) { return this.call<T.CampaignStats>("campaign_stats", { p_id: id }); }

  // Confianza
  review(sellerOrderId: string, rating: number, body?: string) { return this.call<unknown>("create_review", { p_seller_order_id: sellerOrderId, p_rating: rating, p_body: body ?? null }); }
  deleteAccount(confirm: string) { return this.call<{ deleted: boolean; kept_order_history: boolean }>("delete_my_account", { p_confirm: confirm }); }
  toggleBlock(userId: string) { return this.call<{ blocked: boolean }>("toggle_block", { p_user_id: userId }); }
  blocks() { return this.call<T.BlockedUser[]>("my_blocks"); }
  report(targetType: string, targetId: string, reason: string, details?: string) {
    return this.call<{ id: string; status: string }>("create_report", { p_target_type: targetType, p_target_id: targetId, p_reason: reason, p_details: details ?? null });
  }

  // Administración
  adminOverview() { return this.call<T.AdminOverview>("admin_overview"); }
  adminList<R = any>(entity: string, p: Record<string, unknown> = {}) { return this.call<{ items: R[] }>("admin_list", { p_entity: entity, p }); }
  adminSettings(p: Record<string, unknown>) { return this.call<unknown>("admin_update_settings", { p }); }
  adminModerate(entity: string, id: string, action: string, note?: string) {
    return this.call<{ ok: boolean }>("admin_moderate", { p_entity: entity, p_id: id, p_action: action, p_note: note ?? null });
  }
}
