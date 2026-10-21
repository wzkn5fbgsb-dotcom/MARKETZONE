// Tipos compartidos de la API de MARKETZONE (espejo de las respuestas JSON de las funciones SQL).

export type Condition = "new_with_tags" | "new_without_tags" | "used_excellent" | "used_good" | "used_flawed";
export type ListingStatus = "draft" | "active" | "paused" | "removed";
export type OfferStatus = "pending" | "countered" | "accepted" | "declined" | "expired" | "cancelled" | "completed";
export type OrderStatus = "pending_payment" | "paid" | "cancelled" | "expired" | "refunded" | "partially_refunded";
export type SellerOrderStatus = "pending_payment" | "paid" | "preparing" | "shipped" | "delivered" | "cancelled" | "refunded";
export type CampaignKind = "home_store" | "promoted_product" | "category_spotlight" | "temporary_promo" | "featured_offer";
export type CampaignStatus = "draft" | "pending_review" | "pending_payment" | "active" | "paused" | "finished" | "rejected";

export interface UserRef { id: string; username: string; display_name?: string }
export interface StoreRef { id?: string; slug: string; name: string }

export interface ProductCard {
  id: string;
  title: string;
  brand: string | null;
  price_cents: number;
  compare_at_cents: number | null;
  condition: Condition;
  category_id: string;
  status: ListingStatus;
  is_demo: boolean;
  image_url: string | null;
  sizes: { size: string | null; color: string | null; available: number }[];
  available: number;
  seller: UserRef;
  store: StoreRef;
  is_favorite: boolean;
  sponsored: boolean;
  campaign_id?: string;
  published_at: string | null;
  created_at: string;
}

export interface StoreStats {
  followers: number;
  active_listings: number;
  verified_sales: number;
  test_sales: number;
  rating_avg: number | null;
  rating_count: number;
}

export interface StoreCard {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  cover_url: string | null;
  bio: string | null;
  accent: "crimson" | "ember" | "steel" | "ivory";
  categories: string[];
  is_demo: boolean;
  owner: UserRef;
  stats: StoreStats;
  preview_images: string[];
  sponsored?: boolean;
  campaign_id?: string;
  status?: string;
  social_links?: Record<string, string>;
  business_info?: Record<string, string>;
  created_at?: string;
}

export interface BusinessCard {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  cover_url: string | null;
  description: string;
  category: string;
  location: string | null;
  is_demo: boolean;
  store_slug: string | null;
  sponsored?: boolean;
  campaign_id?: string | null;
}

export interface Business {
  id: string;
  owner_id: string;
  store_id: string | null;
  slug: string;
  name: string;
  logo_url: string | null;
  cover_url: string | null;
  description: string;
  category: string;
  location: string | null;
  contact: { email?: string; phone?: string; whatsapp?: string; website?: string };
  hours: Record<string, string>;
  social_links: Record<string, string>;
  customer_info: string | null;
  status: string;
  is_demo: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  sort: number;
  size_system: "apparel" | "shoes" | "numeric" | "one_size" | "none";
  required_fields: string[];
  active_count: number;
}

export interface PublicSettings {
  commission_bps: number;
  shipping_flat_cents: number;
  checkout_hold_minutes: number;
  offer_response_minutes: number;
  offer_payment_minutes: number;
  min_offer_percent: number;
  min_campaign_cents: number;
  test_mode: boolean;
  real_payments_ready: boolean;
}

export interface HomeFeed {
  promoted: ProductCard[];
  featured: ProductCard[];
  recent: ProductCard[];
  deals: ProductCard[];
  stores: StoreCard[];
  businesses: BusinessCard[];
  sponsored_stores: StoreCard[];
  promos: { campaign_id: string; kind: CampaignKind; headline: string; body: string | null; ends_at: string; is_test: boolean;
            business: BusinessCard | null; store: StoreRef | null }[];
}

export interface SearchParams {
  q?: string;
  category?: string;
  sizes?: string[];
  conditions?: Condition[];
  min_price_cents?: number;
  max_price_cents?: number;
  brand?: string;
  store_slug?: string;
  only_available?: boolean;
  only_deals?: boolean;
  sort?: "recent" | "price_asc" | "price_desc" | "popular";
  limit?: number;
  offset?: number;
}

export interface SearchResult { items: ProductCard[]; total: number; spotlight: ProductCard[]; limit: number; offset: number }

export interface Variant {
  id: string;
  size: string | null;
  color: string | null;
  sku?: string | null;
  price_cents: number;
  available: number;
  stock_on_hand?: number | null;
  stock_reserved?: number | null;
}

export interface ProductDetail {
  product: {
    id: string; seller_id: string; store_id: string; category_id: string; title: string; description: string;
    brand: string | null; condition: Condition; flaws: string | null; color: string | null; material: string | null;
    fit: string | null; price_cents: number; compare_at_cents: number | null; tags: string[];
    attributes: Record<string, string>; weight_grams: number | null; length_cm: number | null; width_cm: number | null;
    height_cm: number | null; offers_enabled: boolean; status: ListingStatus; moderation_status: "ok" | "blocked";
    ai_assisted: boolean; is_demo: boolean; published_at: string | null; created_at: string; updated_at: string;
  };
  images: { id: string; url: string; storage_path: string | null }[];
  variants: Variant[];
  seller: UserRef & { avatar_url: string | null };
  store: StoreRef & { id: string; logo_url: string | null; is_demo: boolean; stats: StoreStats };
  category: { id: string; name: string; parent_id: string | null; size_system: string };
  is_owner: boolean;
  is_visible: boolean;
  is_favorite: boolean;
  favorites_count: number;
  offer_rules: { enabled: boolean; min_percent: number; min_cents: number };
  my_open_offer: { id: string; status: OfferStatus; amount_cents: number; awaiting: string; expires_at: string } | null;
  sponsored: boolean;
  similar: ProductCard[];
  fees: { commission_bps: number; shipping_flat_cents: number; test_mode: boolean };
}

export interface ListingInput {
  id?: string;
  store_id?: string | null;
  category_id: string;
  title: string;
  description: string;
  brand?: string | null;
  condition: Condition;
  flaws?: string | null;
  color?: string | null;
  material?: string | null;
  fit?: string | null;
  price_cents: number;
  tags: string[];
  attributes?: Record<string, string>;
  weight_grams?: number | null;
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
  offers_enabled: boolean;
  status: "draft" | "active";
  ai_assisted?: boolean;
  images: { url: string; storage_path?: string | null }[];
  variants: { id?: string; size: string | null; color: string | null; sku?: string | null; price_cents?: number | null; stock_on_hand: number }[];
}

export interface CatalogItem {
  id: string; title: string; brand: string | null; status: ListingStatus; moderation_status: string;
  price_cents: number; compare_at_cents: number | null; category_id: string; condition: Condition; is_demo: boolean;
  published_at: string | null; updated_at: string; created_at: string; on_hand: number; reserved: number; available: number;
  image_url: string | null; offers_pending: number;
  variants: { id: string; size: string | null; color: string | null; sku: string | null; stock_on_hand: number; stock_reserved: number; available: number }[];
}

export interface CatalogResult {
  total: number;
  counts: { all: number; active: number; draft: number; paused: number; sold_out: number };
  items: CatalogItem[];
}

export interface CartLine {
  id: string; variant_id: string; product_id: string; title: string; size: string | null; color: string | null;
  quantity: number; unit_price_cents: number; line_total_cents: number; available: number;
  issue: null | "unavailable" | "own_item" | "demo_item" | "sold_out" | "insufficient_stock";
  is_demo: boolean; image_url: string | null; seller: { id: string; username: string }; store: StoreRef;
}

export interface Cart {
  lines: CartLine[]; subtotal_cents: number; shipping_cents: number; tax_cents: number; total_cents: number;
  sellers: number; has_issues: boolean; test_mode: boolean; shipping_flat_cents: number; hold_minutes: number;
}

export interface Address {
  id: string; full_name: string; line1: string; line2: string | null; city: string; region: string;
  postal_code: string; country: string; phone: string | null; is_default: boolean;
}

export interface OrderItem {
  id: string; product_id: string | null; variant_id: string | null; title: string; size: string | null; color: string | null;
  image_url: string | null; unit_price_cents: number; quantity: number; line_total_cents: number;
}

export interface SellerOrder {
  id: string; order_id: string; seller_id: string; status: SellerOrderStatus; subtotal_cents: number; shipping_cents: number;
  commission_bps: number; commission_cents: number; seller_net_cents: number;
  payout_status: "not_applicable" | "pending" | "paid_out" | "reversed";
  carrier: string | null; tracking_number: string | null; shipped_at: string | null; delivered_at: string | null; created_at: string;
  seller: { username: string; display_name: string }; store: StoreRef | null; items: OrderItem[];
  review: { id: string; rating: number; body: string | null } | null;
  // Campos añadidos en la vista del vendedor
  order_number?: number; order_status?: OrderStatus; is_test?: boolean; payment_due_at?: string;
  shipping_address?: Record<string, string> | null; buyer?: { username: string };
}

export interface Order {
  id: string; number: number; status: OrderStatus; source: "cart" | "offer"; offer_id: string | null; is_test: boolean;
  currency: string; subtotal_cents: number | null; shipping_cents: number | null; tax_cents: number | null; total_cents: number | null;
  shipping_address: Record<string, string>; payment_due_at: string; paid_at: string | null; cancelled_at: string | null;
  created_at: string; viewer_role: "buyer" | "seller" | "admin"; buyer: { username: string; display_name: string };
  seller_orders: SellerOrder[];
  payments: { provider: string; status: string; amount_cents: number; is_test: boolean; created_at: string }[];
  refunds: { amount_cents: number; status: string; reason: string; is_test: boolean; seller_order_id: string | null; created_at: string }[];
}

export interface OrderSummary {
  id: string; number: number; status: OrderStatus; is_test: boolean; source: string; total_cents: number;
  payment_due_at: string; created_at: string; items_count: number; preview: (string | null)[] | null; fulfillment: SellerOrderStatus[] | null;
}

export interface Offer {
  id: string; status: OfferStatus; awaiting: "seller" | "buyer" | "none"; quantity: number;
  list_price_cents: number; offer_cents: number; amount_cents: number; expires_at: string; order_id: string | null;
  created_at: string; updated_at: string; viewer_role: "buyer" | "seller" | "admin";
  product: ProductCard; variant: { id: string; size: string | null; color: string | null };
  buyer: UserRef; seller: UserRef;
  order: { id: string; number: number; status: OrderStatus; total_cents: number; payment_due_at: string } | null;
  events: { kind: string; actor_role: string; amount_cents: number | null; note: string | null; created_at: string }[];
  conflict?: boolean;
}

export interface MoneyBlock {
  gross_cents: number; refunds_cents: number; commission_cents: number; net_estimated_cents: number;
  pending_settlement_cents: number; paid_out_cents: number; pending_payment_cents: number;
}

export interface SellerDashboard {
  listings: { active: number; draft: number; paused: number; sold_out: number; blocked: number; units_available: number; units_reserved: number };
  orders: { pending_payment: number; to_ship: number; shipped: number; completed: number; cancelled: number; refunded: number };
  money_real: MoneyBlock;
  money_test: MoneyBlock;
  offers: { awaiting_you: number; awaiting_buyer: number; accepted_unpaid: number };
  campaigns: { active: number; pending: number };
  views_30d: number;
  settings: PublicSettings;
  stores: { id: string; slug: string; name: string }[];
}

export interface Campaign {
  id: string; owner_id: string; business_id: string | null; store_id: string | null; product_id: string | null;
  kind: CampaignKind; category_id: string | null; headline: string; body: string | null; budget_cents: number;
  duration_days: number; starts_at: string | null; ends_at: string | null; status: CampaignStatus; is_test: boolean;
  is_demo: boolean; review_note: string | null; created_at: string;
  business: { id: string; slug: string; name: string } | null; store: { id: string; slug: string; name: string } | null;
  product: ProductCard | null; stats: { impressions: number; clicks: number }; owner?: string;
}

export interface CampaignStats {
  campaign: Campaign; impressions: number; clicks: number; ctr: number | null; product_views: number;
  new_followers: number; attributed_sales: null | number; attribution_note: string;
  daily: { day: string; impressions: number; clicks: number }[];
}

export interface Account {
  profile: { id: string; username: string; display_name: string; avatar_url: string | null; bio: string | null; role: string;
             preferences: Record<string, unknown>; created_at: string };
  email: string;
  is_admin: boolean;
  addresses: Address[];
  stores: StoreCard[];
  businesses: Business[];
  unread_notifications: number;
  cart_count: number;
}

export interface Notification { id: string; kind: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }

export interface StorePage {
  store: StoreCard;
  is_owner: boolean;
  is_following: boolean;
  products: ProductCard[];
  reviews: { id: string; rating: number; body: string | null; created_at: string; is_test: boolean; reviewer: { username: string; display_name: string } }[];
  business: BusinessCard | null;
}

export interface BusinessPage {
  business: Business;
  is_owner: boolean;
  store: StoreCard | null;
  products: ProductCard[];
  promotions: { id: string; kind: CampaignKind; headline: string; body: string | null; ends_at: string; is_test: boolean }[];
}

export interface AdminOverview {
  users: number; suspended_users: number; sellers: number; stores: number; businesses: number;
  products: Record<string, number> | null; blocked_products: number;
  orders_real: Record<string, number> | null; orders_test: Record<string, number> | null;
  gmv_real_cents: number; gmv_test_cents: number; commission_real_cents: number; commission_test_cents: number;
  open_offers: number; open_reports: number; campaigns_pending_review: number; campaigns_active: number; refunds_pending: number;
  settings: PublicSettings & { updated_at: string };
}

export interface InventoryMovement {
  id: number; kind: string; on_hand_delta: number; reserved_delta: number; on_hand_after: number; reserved_after: number;
  note: string | null; created_at: string; order_id: string | null; size: string | null; color: string | null;
}
