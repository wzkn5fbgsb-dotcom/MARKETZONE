// Modelo de datos del motor de demostración. Las filas usan los mismos nombres de columna que Postgres.

export interface SettingsRow {
  commission_bps: number; shipping_flat_cents: number; checkout_hold_minutes: number; offer_response_minutes: number;
  offer_payment_minutes: number; min_offer_percent: number; min_campaign_cents: number; test_mode: boolean;
  real_payments_ready: boolean; updated_at: string; updated_by: string | null;
}
export interface CredentialRow { user_id: string; email: string; salt: string; hash: string }
export interface ProfileRow {
  id: string; username: string; display_name: string; avatar_url: string | null; bio: string | null; role: "user" | "admin";
  status: "active" | "suspended"; preferences: Record<string, unknown>; created_at: string; updated_at: string;
}
export interface AddressRow {
  id: string; user_id: string; full_name: string; line1: string; line2: string | null; city: string; region: string;
  postal_code: string; country: string; phone: string | null; is_default: boolean; created_at: string;
}
export interface StoreRow {
  id: string; owner_id: string; slug: string; name: string; logo_url: string | null; cover_url: string | null; bio: string | null;
  accent: "crimson" | "ember" | "steel" | "ivory"; categories: string[]; social_links: Record<string, string>;
  business_info: Record<string, string>; status: "active" | "suspended"; is_demo: boolean; created_at: string; updated_at: string;
}
export interface BusinessRow {
  id: string; owner_id: string; store_id: string | null; slug: string; name: string; logo_url: string | null; cover_url: string | null;
  description: string; category: string; location: string | null; contact: Record<string, string>; hours: Record<string, string>;
  social_links: Record<string, string>; customer_info: string | null; status: "active" | "suspended"; is_demo: boolean;
  created_at: string; updated_at: string;
}
export interface CategoryRow {
  id: string; parent_id: string | null; name: string; sort: number; size_system: "apparel" | "shoes" | "numeric" | "one_size" | "none";
  required_fields: string[]; is_active: boolean;
}
export interface ProductRow {
  id: string; seller_id: string; store_id: string; category_id: string; title: string; description: string; brand: string | null;
  condition: string; flaws: string | null; color: string | null; material: string | null; fit: string | null; price_cents: number;
  compare_at_cents: number | null; tags: string[]; attributes: Record<string, string>; weight_grams: number | null;
  length_cm: number | null; width_cm: number | null; height_cm: number | null; offers_enabled: boolean;
  status: "draft" | "active" | "paused" | "removed"; moderation_status: "ok" | "blocked"; moderation_note: string | null;
  ai_assisted: boolean; is_demo: boolean; search_text: string; published_at: string | null; created_at: string; updated_at: string;
}
export interface ImageRow { id: string; product_id: string; url: string; storage_path: string | null; position: number; created_at: string }
export interface VariantRow {
  id: string; product_id: string; size: string | null; color: string | null; sku: string | null; price_cents: number | null;
  stock_on_hand: number; stock_reserved: number; is_active: boolean; position: number; created_at: string; updated_at: string;
}
export interface OfferRow {
  id: string; product_id: string; variant_id: string; buyer_id: string; seller_id: string; quantity: number; list_price_cents: number;
  offer_cents: number; amount_cents: number; status: string; awaiting: "seller" | "buyer" | "none"; expires_at: string;
  order_id: string | null; created_at: string; updated_at: string;
}
export interface OfferEventRow { id: number; offer_id: string; actor_id: string | null; actor_role: string; kind: string; amount_cents: number | null; note: string | null; created_at: string }
export interface OrderRow {
  id: string; number: number; buyer_id: string; source: "cart" | "offer"; offer_id: string | null; status: string; is_test: boolean;
  currency: string; subtotal_cents: number; shipping_cents: number; tax_cents: number; total_cents: number;
  shipping_address: Record<string, string | null>; payment_due_at: string; paid_at: string | null; cancelled_at: string | null;
  created_at: string; updated_at: string;
}
export interface SellerOrderRow {
  id: string; order_id: string; seller_id: string; store_id: string | null; status: string; subtotal_cents: number; shipping_cents: number;
  commission_bps: number; commission_cents: number; seller_net_cents: number; payout_status: string; carrier: string | null;
  tracking_number: string | null; shipped_at: string | null; delivered_at: string | null; created_at: string; updated_at: string;
}
export interface OrderItemRow {
  id: string; order_id: string; seller_order_id: string; product_id: string | null; variant_id: string | null; title: string;
  size: string | null; color: string | null; image_url: string | null; unit_price_cents: number; quantity: number; line_total_cents: number;
}
export interface ReservationRow {
  id: string; variant_id: string; order_id: string; buyer_id: string; quantity: number; status: string; expires_at: string;
  created_at: string; resolved_at: string | null;
}
export interface MovementRow {
  id: number; variant_id: string; product_id: string; kind: string; on_hand_delta: number; reserved_delta: number;
  on_hand_after: number; reserved_after: number; order_id: string | null; reservation_id: string | null; actor_id: string | null;
  note: string | null; created_at: string;
}
export interface PaymentRow {
  id: string; order_id: string | null; campaign_id: string | null; payer_id: string | null; provider: string; provider_ref: string | null;
  amount_cents: number; currency: string; status: string; is_test: boolean; created_at: string;
}
export interface RefundRow {
  id: string; order_id: string; seller_order_id: string | null; amount_cents: number; reason: string; status: string; is_test: boolean;
  restocked: boolean; created_by: string | null; created_at: string;
}
export interface CampaignRow {
  id: string; owner_id: string; business_id: string | null; store_id: string | null; product_id: string | null; kind: string;
  category_id: string | null; headline: string; body: string | null; budget_cents: number; duration_days: number;
  starts_at: string | null; ends_at: string | null; status: string; is_test: boolean; is_demo: boolean; review_note: string | null;
  reviewed_by: string | null; reviewed_at: string | null; created_at: string; updated_at: string;
}
export interface AnalyticsRow { id: number; kind: string; product_id: string | null; store_id: string | null; business_id: string | null; campaign_id: string | null; user_id: string | null; session_id: string | null; created_at: string }
export interface ReviewRow { id: string; seller_order_id: string; reviewer_id: string; seller_id: string; store_id: string | null; rating: number; body: string | null; status: string; is_test: boolean; created_at: string }
export interface ReportRow { id: string; reporter_id: string; target_type: string; target_id: string; reason: string; details: string | null; status: string; resolution_note: string | null; resolved_by: string | null; created_at: string; resolved_at: string | null }
export interface NotificationRow { id: string; user_id: string; kind: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }
export interface AuditRow { id: number; actor_id: string | null; action: string; target_type: string | null; target_id: string | null; details: Record<string, unknown>; created_at: string }

export interface DemoDB {
  version: number;
  seq: { order: number; movement: number; event: number; analytics: number; audit: number };
  settings: SettingsRow;
  credentials: CredentialRow[];
  profiles: ProfileRow[];
  addresses: AddressRow[];
  stores: StoreRow[];
  follows: { user_id: string; store_id: string; created_at: string }[];
  businesses: BusinessRow[];
  categories: CategoryRow[];
  products: ProductRow[];
  price_history: { product_id: string; old_cents: number; new_cents: number; changed_by: string | null; created_at: string }[];
  images: ImageRow[];
  variants: VariantRow[];
  favorites: { user_id: string; product_id: string; created_at: string }[];
  cart: { id: string; user_id: string; variant_id: string; quantity: number; created_at: string }[];
  offers: OfferRow[];
  offer_events: OfferEventRow[];
  orders: OrderRow[];
  seller_orders: SellerOrderRow[];
  order_items: OrderItemRow[];
  reservations: ReservationRow[];
  movements: MovementRow[];
  payments: PaymentRow[];
  refunds: RefundRow[];
  campaigns: CampaignRow[];
  analytics: AnalyticsRow[];
  reviews: ReviewRow[];
  reports: ReportRow[];
  notifications: NotificationRow[];
  audit: AuditRow[];
}

export const CATEGORIES: CategoryRow[] = [
  ["ropa", null, "Ropa", 10, "apparel", ["size"]],
  ["sneakers", null, "Sneakers", 20, "shoes", ["size", "brand"]],
  ["streetwear", null, "Streetwear", 30, "apparel", ["size"]],
  ["accesorios", null, "Accesorios", 40, "one_size", []],
  ["bolsos", null, "Bolsos", 50, "one_size", []],
  ["belleza", null, "Belleza", 60, "none", ["brand"]],
  ["ropa-camisetas", "ropa", "Camisetas", 1, "apparel", ["size"]],
  ["ropa-sudaderas", "ropa", "Sudaderas", 2, "apparel", ["size"]],
  ["ropa-chaquetas", "ropa", "Chaquetas", 3, "apparel", ["size"]],
  ["ropa-pantalones", "ropa", "Pantalones", 4, "apparel", ["size"]],
  ["ropa-vestidos", "ropa", "Vestidos", 5, "apparel", ["size"]],
  ["sneakers-lifestyle", "sneakers", "Lifestyle", 1, "shoes", ["size", "brand"]],
  ["sneakers-running", "sneakers", "Running", 2, "shoes", ["size", "brand"]],
  ["sneakers-basket", "sneakers", "Basketball", 3, "shoes", ["size", "brand"]],
  ["streetwear-hoodies", "streetwear", "Hoodies", 1, "apparel", ["size"]],
  ["streetwear-graficas", "streetwear", "Camisetas gráficas", 2, "apparel", ["size"]],
  ["streetwear-cargo", "streetwear", "Cargo y workwear", 3, "apparel", ["size"]],
  ["accesorios-gorras", "accesorios", "Gorras", 1, "one_size", []],
  ["accesorios-gafas", "accesorios", "Gafas", 2, "one_size", []],
  ["accesorios-joyeria", "accesorios", "Joyería", 3, "one_size", []],
  ["accesorios-relojes", "accesorios", "Relojes", 4, "one_size", ["brand"]],
  ["bolsos-tote", "bolsos", "Tote", 1, "one_size", []],
  ["bolsos-crossbody", "bolsos", "Crossbody", 2, "one_size", []],
  ["bolsos-mochilas", "bolsos", "Mochilas", 3, "one_size", []],
  ["belleza-skincare", "belleza", "Skincare", 1, "none", ["brand"]],
  ["belleza-fragancias", "belleza", "Fragancias", 2, "none", ["brand"]],
  ["belleza-maquillaje", "belleza", "Maquillaje", 3, "none", ["brand"]],
].map(([id, parent_id, name, sort, size_system, required_fields]) => ({
  id, parent_id, name, sort, size_system, required_fields, is_active: true,
})) as CategoryRow[];

export function emptyDB(nowIso: string): DemoDB {
  return {
    version: 1,
    seq: { order: 100000, movement: 0, event: 0, analytics: 0, audit: 0 },
    settings: {
      commission_bps: 1000, shipping_flat_cents: 799, checkout_hold_minutes: 15, offer_response_minutes: 2880,
      offer_payment_minutes: 1440, min_offer_percent: 50, min_campaign_cents: 500, test_mode: true, real_payments_ready: false,
      updated_at: nowIso, updated_by: null,
    },
    credentials: [], profiles: [], addresses: [], stores: [], follows: [], businesses: [], categories: CATEGORIES.map((c) => ({ ...c })),
    products: [], price_history: [], images: [], variants: [], favorites: [], cart: [], offers: [], offer_events: [], orders: [],
    seller_orders: [], order_items: [], reservations: [], movements: [], payments: [], refunds: [], campaigns: [], analytics: [],
    reviews: [], reports: [], notifications: [], audit: [],
  };
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
