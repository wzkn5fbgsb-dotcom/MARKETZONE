// Motor de demostración: implementa en el navegador las mismas funciones que el servidor
// (mismos nombres, parámetros, reglas y respuestas). Cada llamada es atómica: si falla,
// el estado vuelve exactamente a como estaba.
import { ApiError } from "../backend";
import { uuid, type CampaignRow, type DemoDB, type OfferRow, type OrderRow, type ProductRow, type SellerOrderRow, type StoreRow, type BusinessRow, type VariantRow } from "./db";

type Args = Record<string, any>;
type Handler = (a: Args, uid: string | null) => unknown;

const fail = (code: string, message: string, detail: unknown = null): never => { throw new ApiError(code, message, detail, 400); };
const money = (c: number) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trimOrNull = (v: unknown) => { const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim(); return s === "" ? null : s; };
const lower = (v: string | null | undefined) => (v ?? "").toLowerCase();
const CONDITIONS = ["new_with_tags", "new_without_tags", "used_excellent", "used_good", "used_flawed"];
const byDesc = <T>(f: (x: T) => number | string | null) => (a: T, b: T) => {
  const x = f(a), y = f(b);
  if (x === y) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return x < y ? 1 : -1;
};
const byAsc = <T>(f: (x: T) => number | string | null) => (a: T, b: T) => -byDesc(f)(a, b);

export class DemoEngine {
  clockOffsetMs = 0;
  private handlers: Record<string, Handler>;

  constructor(public db: DemoDB, private onChange?: (db: DemoDB) => void) {
    this.handlers = this.buildHandlers();
  }

  now() { return new Date(Date.now() + this.clockOffsetMs); }
  iso(offsetMs = 0) { return new Date(this.now().getTime() + offsetMs).toISOString(); }
  private t(iso: string | null) { return iso ? new Date(iso).getTime() : 0; }

  has(name: string) { return name in this.handlers; }

  call<T = unknown>(name: string, args: Args = {}, uid: string | null = null): T {
    const fn = this.handlers[name];
    if (!fn) fail("not_found", `Función desconocida: ${name}`);
    const snapshot = structuredClone(this.db);
    try {
      this.expireDue();
      const result = fn(args ?? {}, uid);
      this.onChange?.(this.db);
      return (result === undefined ? null : structuredClone(result)) as T;
    } catch (e) {
      this.db = snapshot;
      throw e;
    }
  }

  /** Alta de usuario (equivale a Supabase Auth + disparador handle_new_user). */
  registerUser(input: { email: string; salt: string; hash: string; username?: string; display_name?: string; role?: "user" | "admin"; id?: string; created_at?: string }) {
    const email = input.email.trim().toLowerCase();
    if (this.db.credentials.some((c) => c.email === email)) fail("user_already_exists", "Ya existe una cuenta con ese correo.");
    const id = input.id ?? uuid();
    let base = lower(input.username || email.split("@")[0]).replace(/[^a-z0-9_.]/g, "");
    if (base.length < 3) base += "user";
    base = base.slice(0, 24);
    let username = base;
    for (let i = 0; this.db.profiles.some((p) => lower(p.username) === username) && i < 50; i++) username = base + (1000 + Math.floor(Math.random() * 9000));
    const created = input.created_at ?? this.iso();
    this.db.credentials.push({ user_id: id, email, salt: input.salt, hash: input.hash });
    this.db.profiles.push({ id, username, display_name: (input.display_name?.trim() || username).slice(0, 60), avatar_url: null, bio: null,
      role: input.role ?? "user", status: "active", preferences: {}, created_at: created, updated_at: created });
    this.onChange?.(this.db);
    return id;
  }

  setPasswordHash(userId: string, salt: string, hash: string) {
    const c = this.db.credentials.find((x) => x.user_id === userId);
    if (!c) fail("not_found", "La cuenta no existe.");
    c!.salt = salt; c!.hash = hash;
    this.onChange?.(this.db);
  }

  // ------------------------------------------------------------------ utilidades
  private profile(id: string | null) { return this.db.profiles.find((p) => p.id === id) ?? null; }
  private requireUser(uid: string | null): string {
    if (!uid) fail("auth_required", "Inicia sesión para continuar.");
    const p = this.profile(uid);
    if (!p) fail("profile_missing", "No encontramos tu perfil. Cierra sesión y vuelve a entrar.");
    if (p!.status === "suspended") fail("account_suspended", "Tu cuenta está suspendida. Contacta con soporte.");
    return uid!;
  }
  private isAdmin(uid: string | null) { const p = this.profile(uid); return !!p && p.role === "admin" && p.status === "active"; }
  private requireAdmin(uid: string | null) {
    const u = this.requireUser(uid);
    if (!this.isAdmin(u)) fail("forbidden", "Esta acción requiere permisos de administración.");
    return u;
  }
  private notify(user: string, kind: string, title: string, body: string | null, link: string | null) {
    this.db.notifications.push({ id: uuid(), user_id: user, kind, title, body, link, read_at: null, created_at: this.iso() });
  }
  private audit(actor: string | null, action: string, targetType: string, targetId: string, details: Record<string, unknown>) {
    this.db.audit.push({ id: ++this.db.seq.audit, actor_id: actor, action, target_type: targetType, target_id: targetId, details, created_at: this.iso() });
  }
  private store(id: string | null) { return this.db.stores.find((s) => s.id === id) ?? null; }
  private product(id: string | null) { return this.db.products.find((p) => p.id === id) ?? null; }
  private variant(id: string | null) { return this.db.variants.find((v) => v.id === id) ?? null; }
  private variantsOf(pid: string, activeOnly = true) {
    return this.db.variants.filter((v) => v.product_id === pid && (!activeOnly || v.is_active)).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
  }
  private avail(v: VariantRow) { return v.stock_on_hand - v.stock_reserved; }
  private isPublic(p: ProductRow | null) {
    if (!p || p.status !== "active" || p.moderation_status !== "ok") return false;
    const s = this.store(p.store_id);
    const pr = this.profile(p.seller_id);
    return !!s && s.status === "active" && !!pr && pr.status === "active";
  }
  private publicProducts() { return this.db.products.filter((p) => this.isPublic(p)); }
  private firstImage(pid: string) {
    return this.db.images.filter((i) => i.product_id === pid).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))[0]?.url ?? null;
  }
  private favCount(pid: string) { return this.db.favorites.filter((f) => f.product_id === pid).length; }
  private settings() { return this.db.settings; }
  private searchText(p: Partial<ProductRow>) {
    return lower([p.title, p.brand, p.color, p.material, (p.tags ?? []).join(" "), p.category_id, (p.description ?? "").slice(0, 500)].map((x) => x ?? "").join(" "));
  }

  card(p: ProductRow, uid: string | null) {
    const vs = this.variantsOf(p.id);
    const s = this.store(p.store_id);
    const pr = this.profile(p.seller_id);
    return {
      id: p.id, title: p.title, brand: p.brand, price_cents: p.price_cents, compare_at_cents: p.compare_at_cents,
      condition: p.condition, category_id: p.category_id, status: p.status, is_demo: p.is_demo,
      image_url: this.firstImage(p.id),
      sizes: vs.map((v) => ({ size: v.size, color: v.color, available: this.avail(v) })),
      available: vs.reduce((n, v) => n + this.avail(v), 0),
      seller: pr ? { id: pr.id, username: pr.username, display_name: pr.display_name } : null,
      store: s ? { id: s.id, slug: s.slug, name: s.name } : null,
      is_favorite: !!uid && this.db.favorites.some((f) => f.product_id === p.id && f.user_id === uid),
      sponsored: false, published_at: p.published_at, created_at: p.created_at,
    };
  }

  private storeStats(storeId: string) {
    const sales = (test: boolean) => this.db.seller_orders.filter((so) => so.store_id === storeId && ["paid", "preparing", "shipped", "delivered"].includes(so.status)
      && this.db.orders.find((o) => o.id === so.order_id)?.is_test === test).length;
    const reviews = this.db.reviews.filter((r) => r.store_id === storeId && r.status === "visible");
    return {
      followers: this.db.follows.filter((f) => f.store_id === storeId).length,
      active_listings: this.publicProducts().filter((p) => p.store_id === storeId).length,
      verified_sales: sales(false),
      test_sales: sales(true),
      rating_avg: reviews.length ? Math.round((reviews.reduce((n, r) => n + r.rating, 0) / reviews.length) * 100) / 100 : null,
      rating_count: reviews.length,
    };
  }

  private storeCard(s: StoreRow) {
    const owner = this.profile(s.owner_id);
    const previews = this.publicProducts().filter((p) => p.store_id === s.id).sort(byDesc((p) => p.published_at)).slice(0, 3)
      .map((p) => this.firstImage(p.id)).filter(Boolean);
    return {
      id: s.id, slug: s.slug, name: s.name, logo_url: s.logo_url, cover_url: s.cover_url, bio: s.bio, accent: s.accent,
      categories: s.categories, is_demo: s.is_demo,
      owner: owner ? { id: owner.id, username: owner.username, display_name: owner.display_name } : null,
      stats: this.storeStats(s.id), preview_images: previews,
    };
  }

  private businessCard(b: BusinessRow) {
    const s = this.store(b.store_id);
    return {
      id: b.id, slug: b.slug, name: b.name, logo_url: b.logo_url, cover_url: b.cover_url, description: b.description.slice(0, 240),
      category: b.category, location: b.location, is_demo: b.is_demo, store_slug: s && s.status === "active" ? s.slug : null,
    };
  }

  private publicSettings() {
    const s = this.settings();
    return {
      commission_bps: s.commission_bps, shipping_flat_cents: s.shipping_flat_cents, checkout_hold_minutes: s.checkout_hold_minutes,
      offer_response_minutes: s.offer_response_minutes, offer_payment_minutes: s.offer_payment_minutes,
      min_offer_percent: s.min_offer_percent, min_campaign_cents: s.min_campaign_cents, test_mode: s.test_mode,
      real_payments_ready: s.real_payments_ready,
    };
  }

  // ------------------------------------------------------------------ inventario
  private logMovement(v: VariantRow, kind: string, dOnHand: number, dRes: number, orderId: string | null, resId: string | null, actor: string | null, note: string) {
    this.db.movements.push({
      id: ++this.db.seq.movement, variant_id: v.id, product_id: v.product_id, kind, on_hand_delta: dOnHand, reserved_delta: dRes,
      on_hand_after: v.stock_on_hand, reserved_after: v.stock_reserved, order_id: orderId, reservation_id: resId, actor_id: actor,
      note, created_at: this.iso(),
    });
  }
  private reserve(variantId: string, qty: number, orderId: string, buyer: string, expires: string) {
    const v = this.variant(variantId);
    if (!v || !v.is_active || this.avail(v) < qty) fail("out_of_stock", "No quedan suficientes unidades disponibles.", { variant_id: variantId });
    v!.stock_reserved += qty;
    v!.updated_at = this.iso();
    const id = uuid();
    this.db.reservations.push({ id, variant_id: variantId, order_id: orderId, buyer_id: buyer, quantity: qty, status: "active", expires_at: expires, created_at: this.iso(), resolved_at: null });
    this.logMovement(v!, "reserve", 0, qty, orderId, id, buyer, "Reserva temporal");
  }
  private releaseOrder(orderId: string, status: "released" | "expired", actor: string | null) {
    for (const r of this.db.reservations.filter((x) => x.order_id === orderId && x.status === "active").sort((a, b) => a.variant_id.localeCompare(b.variant_id))) {
      const v = this.variant(r.variant_id)!;
      v.stock_reserved -= r.quantity;
      r.status = status;
      r.resolved_at = this.iso();
      this.logMovement(v, status === "expired" ? "expire" : "release", 0, -r.quantity, orderId, r.id, actor, status === "expired" ? "Reserva vencida" : "Reserva liberada");
    }
  }
  private convertOrder(orderId: string, actor: string | null) {
    for (const r of this.db.reservations.filter((x) => x.order_id === orderId && x.status === "active").sort((a, b) => a.variant_id.localeCompare(b.variant_id))) {
      const v = this.variant(r.variant_id)!;
      v.stock_on_hand -= r.quantity;
      v.stock_reserved -= r.quantity;
      r.status = "converted";
      r.resolved_at = this.iso();
      this.logMovement(v, "sale", -r.quantity, -r.quantity, orderId, r.id, actor, "Venta confirmada");
    }
  }
  private offerEvent(offerId: string, actor: string | null, role: string, kind: string, amount: number | null = null, note: string | null = null) {
    this.db.offer_events.push({ id: ++this.db.seq.event, offer_id: offerId, actor_id: actor, actor_role: role, kind, amount_cents: amount, note, created_at: this.iso() });
  }
  private expireOrder(orderId: string) {
    const o = this.db.orders.find((x) => x.id === orderId);
    if (!o || o.status !== "pending_payment") return;
    this.releaseOrder(o.id, "expired", null);
    o.status = "expired"; o.cancelled_at = this.iso(); o.updated_at = this.iso();
    for (const so of this.db.seller_orders.filter((x) => x.order_id === o.id)) { so.status = "cancelled"; so.updated_at = this.iso(); }
    if (o.offer_id) {
      const of = this.db.offers.find((x) => x.id === o.offer_id);
      if (of && of.status === "accepted") { of.status = "expired"; of.awaiting = "none"; of.updated_at = this.iso(); }
      this.offerEvent(o.offer_id, null, "system", "expire", null, "El plazo de pago terminó y se liberó la reserva.");
      if (of) this.notify(of.seller_id, "offer_expired", "Oferta aceptada sin pagar", "El comprador no pagó a tiempo. La unidad vuelve a estar disponible.", "/ofertas");
    }
    this.notify(o.buyer_id, "order_expired", `Pedido #${o.number} vencido`, "No se completó el pago dentro del plazo y se liberaron los artículos reservados.", `/pedido/${o.id}`);
  }
  /** Equivalente a mz_expire_due(): se ejecuta antes de cada operación. */
  expireDue() {
    const now = this.now().getTime();
    for (const o of this.db.orders.filter((x) => x.status === "pending_payment" && this.t(x.payment_due_at) <= now)) this.expireOrder(o.id);
    for (const of of this.db.offers.filter((x) => (x.status === "pending" || x.status === "countered") && this.t(x.expires_at) <= now)) {
      of.status = "expired"; of.awaiting = "none"; of.updated_at = this.iso();
      this.offerEvent(of.id, null, "system", "expire", null, "La oferta venció sin respuesta.");
      this.notify(of.buyer_id, "offer_expired", "Tu oferta venció", "No hubo respuesta dentro del plazo.", "/ofertas");
    }
    for (const c of this.db.campaigns.filter((x) => (x.status === "active" || x.status === "paused") && x.ends_at && this.t(x.ends_at) <= now)) {
      c.status = "finished"; c.updated_at = this.iso();
    }
  }

  private defaultStore(uid: string) {
    const own = this.db.stores.filter((s) => s.owner_id === uid).sort(byAsc((s) => s.created_at));
    if (own[0]) return own[0].id;
    const p = this.profile(uid)!;
    const base = p.username.toLowerCase().replace(/[^a-z0-9-]/g, "-").padEnd(3, "-shop".slice(0, 3)).slice(0, 36);
    let slug = base.length < 3 ? base + "-shop" : base;
    let n = 1;
    while (this.db.stores.some((s) => lower(s.slug) === slug)) { n++; slug = `${base.slice(0, 34)}-${n}`; }
    const s: StoreRow = { id: uuid(), owner_id: uid, slug, name: p.display_name.slice(0, 60), logo_url: null, cover_url: null, bio: null,
      accent: "crimson", categories: [], social_links: {}, business_info: {}, status: "active", is_demo: false, created_at: this.iso(), updated_at: this.iso() };
    this.db.stores.push(s);
    return s.id;
  }

  private applyPrice(p: ProductRow, newPrice: number, actor: string) {
    if (newPrice === p.price_cents) return p.compare_at_cents;
    let compare: number | null;
    if (p.status === "active" && p.published_at && newPrice < p.price_cents) compare = Math.max(p.price_cents, p.compare_at_cents ?? 0);
    else if (p.compare_at_cents !== null && newPrice < p.compare_at_cents) compare = p.compare_at_cents;
    else compare = null;
    this.db.price_history.push({ product_id: p.id, old_cents: p.price_cents, new_cents: newPrice, changed_by: actor, created_at: this.iso() });
    return compare;
  }

  // ------------------------------------------------------------------ JSON compuestos
  private sellerOrderJson(so: SellerOrderRow) {
    const pr = this.profile(so.seller_id);
    const s = this.store(so.store_id);
    const review = this.db.reviews.find((r) => r.seller_order_id === so.id);
    return {
      id: so.id, order_id: so.order_id, seller_id: so.seller_id, status: so.status, subtotal_cents: so.subtotal_cents,
      shipping_cents: so.shipping_cents, commission_bps: so.commission_bps, commission_cents: so.commission_cents,
      seller_net_cents: so.seller_net_cents, payout_status: so.payout_status, carrier: so.carrier, tracking_number: so.tracking_number,
      shipped_at: so.shipped_at, delivered_at: so.delivered_at, created_at: so.created_at,
      seller: pr ? { username: pr.username, display_name: pr.display_name } : null,
      store: s ? { slug: s.slug, name: s.name } : null,
      items: this.db.order_items.filter((i) => i.seller_order_id === so.id).map((i) => ({
        id: i.id, product_id: i.product_id, variant_id: i.variant_id, title: i.title, size: i.size, color: i.color, image_url: i.image_url,
        unit_price_cents: i.unit_price_cents, quantity: i.quantity, line_total_cents: i.line_total_cents })),
      review: review ? { id: review.id, rating: review.rating, body: review.body } : null,
    };
  }

  private orderJson(o: OrderRow, uid: string) {
    const isBuyer = o.buyer_id === uid;
    const admin = this.isAdmin(uid);
    const full = isBuyer || admin;
    const buyer = this.profile(o.buyer_id)!;
    const mySoIds = this.db.seller_orders.filter((so) => so.seller_id === uid).map((so) => so.id);
    return {
      id: o.id, number: o.number, status: o.status, source: o.source, offer_id: o.offer_id, is_test: o.is_test, currency: o.currency,
      subtotal_cents: full ? o.subtotal_cents : null, shipping_cents: full ? o.shipping_cents : null, tax_cents: full ? o.tax_cents : null,
      total_cents: full ? o.total_cents : null, shipping_address: o.shipping_address, payment_due_at: o.payment_due_at, paid_at: o.paid_at,
      cancelled_at: o.cancelled_at, created_at: o.created_at,
      viewer_role: isBuyer ? "buyer" : admin ? "admin" : "seller",
      buyer: { username: buyer.username, display_name: buyer.display_name },
      seller_orders: this.db.seller_orders.filter((so) => so.order_id === o.id && (full || so.seller_id === uid))
        .sort(byAsc((so) => so.created_at)).map((so) => this.sellerOrderJson(so)),
      payments: full ? this.db.payments.filter((p) => p.order_id === o.id).map((p) => ({ provider: p.provider, status: p.status, amount_cents: p.amount_cents, is_test: p.is_test, created_at: p.created_at })) : [],
      refunds: this.db.refunds.filter((r) => r.order_id === o.id && (full || (r.seller_order_id && mySoIds.includes(r.seller_order_id))))
        .map((r) => ({ amount_cents: r.amount_cents, status: r.status, reason: r.reason, is_test: r.is_test, seller_order_id: r.seller_order_id, created_at: r.created_at })),
    };
  }

  private offerJson(o: OfferRow, uid: string | null) {
    const p = this.product(o.product_id);
    const v = this.variant(o.variant_id);
    const b = this.profile(o.buyer_id)!;
    const s = this.profile(o.seller_id)!;
    const od = o.order_id ? this.db.orders.find((x) => x.id === o.order_id) : null;
    return {
      id: o.id, status: o.status, awaiting: o.awaiting, quantity: o.quantity, list_price_cents: o.list_price_cents, offer_cents: o.offer_cents,
      amount_cents: o.amount_cents, expires_at: o.expires_at, order_id: o.order_id, created_at: o.created_at, updated_at: o.updated_at,
      viewer_role: o.buyer_id === uid ? "buyer" : o.seller_id === uid ? "seller" : "admin",
      product: p ? this.card(p, uid) : null,
      variant: v ? { id: v.id, size: v.size, color: v.color } : null,
      buyer: { id: b.id, username: b.username }, seller: { id: s.id, username: s.username },
      order: od ? { id: od.id, number: od.number, status: od.status, total_cents: od.total_cents, payment_due_at: od.payment_due_at } : null,
      events: this.db.offer_events.filter((e) => e.offer_id === o.id).sort((a, b2) => a.id - b2.id)
        .map((e) => ({ kind: e.kind, actor_role: e.actor_role, amount_cents: e.amount_cents, note: e.note, created_at: e.created_at })),
    };
  }

  private campaignJson(c: CampaignRow, uid: string | null) {
    const b = this.db.businesses.find((x) => x.id === c.business_id);
    const s = this.store(c.store_id);
    const p = this.product(c.product_id);
    const ev = this.db.analytics.filter((e) => e.campaign_id === c.id);
    return {
      ...c,
      business: b ? { id: b.id, slug: b.slug, name: b.name } : null,
      store: s ? { id: s.id, slug: s.slug, name: s.name } : null,
      product: p ? this.card(p, uid) : null,
      stats: { impressions: ev.filter((e) => e.kind === "impression").length, clicks: ev.filter((e) => e.kind === "click").length },
    };
  }

  private moneyBlock(seller: string, test: boolean) {
    const rows = this.db.seller_orders.filter((so) => so.seller_id === seller && this.db.orders.find((o) => o.id === so.order_id)?.is_test === test);
    const sum = (f: (so: SellerOrderRow) => boolean, k: (so: SellerOrderRow) => number) => rows.filter(f).reduce((n, so) => n + k(so), 0);
    const live = ["paid", "preparing", "shipped", "delivered"];
    return {
      gross_cents: sum((so) => [...live, "refunded"].includes(so.status), (so) => so.subtotal_cents),
      refunds_cents: sum((so) => so.status === "refunded", (so) => so.subtotal_cents),
      commission_cents: sum((so) => live.includes(so.status), (so) => so.commission_cents),
      net_estimated_cents: sum((so) => live.includes(so.status), (so) => so.seller_net_cents),
      pending_settlement_cents: sum((so) => so.payout_status === "pending" && so.status !== "refunded", (so) => so.seller_net_cents),
      paid_out_cents: sum((so) => so.payout_status === "paid_out", (so) => so.seller_net_cents),
      pending_payment_cents: sum((so) => so.status === "pending_payment", (so) => so.subtotal_cents),
    };
  }

  private finalizePaid(o: OrderRow, actor: string) {
    o.status = "paid"; o.paid_at = this.iso(); o.updated_at = this.iso();
    for (const so of this.db.seller_orders.filter((x) => x.order_id === o.id)) {
      so.status = "paid"; so.payout_status = "pending"; so.updated_at = this.iso();
      this.notify(so.seller_id, "new_sale", `Nueva venta · pedido #${o.number}`,
        o.is_test ? "Pedido de prueba pagado (sin dinero real). Prepara el envío." : "Pago confirmado. Prepara el envío.", "/panel/pedidos");
      this.db.analytics.push({ id: ++this.db.seq.analytics, kind: "purchase", product_id: null, store_id: so.store_id, business_id: null, campaign_id: null, user_id: o.buyer_id, session_id: null, created_at: this.iso() });
    }
    if (o.offer_id) {
      const of = this.db.offers.find((x) => x.id === o.offer_id)!;
      of.status = "completed"; of.awaiting = "none"; of.updated_at = this.iso();
      this.offerEvent(of.id, actor, "buyer", "complete", o.subtotal_cents, "Pago confirmado por el importe acordado.");
    }
    this.notify(o.buyer_id, "order_paid", `Pedido #${o.number} confirmado`,
      o.is_test ? "Pago de prueba registrado. No se cobró dinero real." : "Recibimos tu pago.", `/pedido/${o.id}`);
  }

  private addressSnapshot(a: { full_name: string; line1: string; line2: string | null; city: string; region: string; postal_code: string; country: string; phone: string | null }) {
    return { full_name: a.full_name, line1: a.line1, line2: a.line2, city: a.city, region: a.region, postal_code: a.postal_code, country: a.country, phone: a.phone };
  }

  private validateSlug(slug: string, msg: string) {
    if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) fail("validation", msg, { field: "slug" });
  }

  // ------------------------------------------------------------------ funciones públicas (RPC)
  private buildHandlers(): Record<string, Handler> {
    const H: Record<string, Handler> = {};
    const db = () => this.db;

    // ---- públicas
    H.public_settings = () => this.publicSettings();
    H.expire_stale = () => ({ ok: true });
    H.list_categories = () => {
      const pub = this.publicProducts();
      return db().categories.filter((c) => c.is_active)
        .sort((a, b) => (a.parent_id === null ? 0 : 1) - (b.parent_id === null ? 0 : 1) || lower(a.parent_id).localeCompare(lower(b.parent_id)) || a.sort - b.sort)
        .map((c) => ({ id: c.id, parent_id: c.parent_id, name: c.name, sort: c.sort, size_system: c.size_system, required_fields: c.required_fields,
          active_count: pub.filter((p) => p.category_id === c.id || db().categories.some((ch) => ch.parent_id === c.id && ch.id === p.category_id)).length }));
    };

    H.home_feed = (_a, uid) => {
      const now = this.now().getTime();
      const pub = this.publicProducts();
      const activeCamp = (kinds: string[]) => db().campaigns.filter((c) => kinds.includes(c.kind) && c.status === "active" && this.t(c.ends_at) > now);
      const latestPerProduct = new Map<string, CampaignRow>();
      for (const c of activeCamp(["promoted_product", "featured_offer"]).filter((c) => c.product_id).sort(byDesc((c) => c.starts_at))) {
        if (!latestPerProduct.has(c.product_id!)) latestPerProduct.set(c.product_id!, c);
      }
      const promoted = [...latestPerProduct.values()].sort(byDesc((c) => c.starts_at))
        .map((c) => ({ c, p: pub.find((p) => p.id === c.product_id) })).filter((x) => x.p).slice(0, 8)
        .map(({ c, p }) => ({ ...this.card(p!, uid), sponsored: true, campaign_id: c.id }));
      const withStock = (p: ProductRow) => this.variantsOf(p.id).some((v) => this.avail(v) > 0);
      const featured = pub.filter((p) => this.firstImage(p.id) && withStock(p))
        .sort((a, b) => this.favCount(b.id) - this.favCount(a.id) || byDesc<ProductRow>((p) => p.published_at)(a, b)).slice(0, 8).map((p) => this.card(p, uid));
      const recent = [...pub].sort(byDesc((p) => p.published_at)).slice(0, 12).map((p) => this.card(p, uid));
      const deals = pub.filter((p) => p.compare_at_cents !== null)
        .sort(byDesc((p) => (p.compare_at_cents! - p.price_cents) / p.compare_at_cents!)).slice(0, 8).map((p) => this.card(p, uid));
      const lastPub = (s: StoreRow) => db().products.filter((p) => p.store_id === s.id).map((p) => p.published_at ?? "").sort().pop() ?? "";
      const stores = db().stores.filter((s) => s.status === "active" && pub.some((p) => p.store_id === s.id))
        .sort((a, b) => db().follows.filter((f) => f.store_id === b.id).length - db().follows.filter((f) => f.store_id === a.id).length || lastPub(b).localeCompare(lastPub(a)))
        .slice(0, 8).map((s) => this.storeCard(s));
      const homeCamps = activeCamp(["home_store"]);
      const businesses = db().businesses.filter((b) => b.status === "active")
        .map((b) => ({ b, c: homeCamps.filter((c) => c.business_id === b.id).sort(byDesc((c) => c.starts_at))[0] ?? null }))
        .sort((x, y) => Number(!!y.c) - Number(!!x.c) || y.b.created_at.localeCompare(x.b.created_at)).slice(0, 6)
        .map(({ b, c }) => ({ ...this.businessCard(b), sponsored: !!c, campaign_id: c?.id ?? null }));
      const sponsored_stores = homeCamps.filter((c) => c.store_id && !c.business_id)
        .map((c) => ({ c, s: this.store(c.store_id) })).filter((x) => x.s && x.s.status === "active")
        .map(({ c, s }) => ({ ...this.storeCard(s!), sponsored: true, campaign_id: c.id }));
      const promos = activeCamp(["temporary_promo"]).sort(byDesc((c) => c.starts_at)).map((c) => {
        const b = db().businesses.find((x) => x.id === c.business_id && x.status === "active");
        const s = this.store(c.store_id);
        return { campaign_id: c.id, kind: c.kind, headline: c.headline, body: c.body, ends_at: c.ends_at, is_test: c.is_test,
          business: b ? this.businessCard(b) : null, store: s && s.status === "active" ? { slug: s.slug, name: s.name } : null };
      });
      return { promoted, featured, recent, deals, stores, businesses, sponsored_stores, promos };
    };

    H.search_products = (a, uid) => {
      const p = a.p ?? {};
      const words = lower(String(p.q ?? "")).replace(/[%_\\]/g, "").split(" ").filter(Boolean);
      const cat = p.category || null;
      const sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes.map((s: string) => lower(s)) : null;
      const conds = Array.isArray(p.conditions) && p.conditions.length ? p.conditions : null;
      const min = p.min_price_cents ?? null, max = p.max_price_cents ?? null;
      const brand = trimOrNull(p.brand) ? lower(p.brand.trim()) : null;
      const storeSlug = p.store_slug ? lower(p.store_slug) : null;
      const limit = Math.min(Math.max(Number(p.limit ?? 24), 1), 60);
      const offset = Math.max(Number(p.offset ?? 0), 0);
      const sort = p.sort || "recent";
      const childOf = (id: string) => db().categories.filter((c) => c.parent_id === id).map((c) => c.id);
      const base = this.publicProducts().filter((x) =>
        (!cat || x.category_id === cat || childOf(cat).includes(x.category_id))
        && words.every((w) => x.search_text.includes(w))
        && (!conds || conds.includes(x.condition))
        && (min === null || x.price_cents >= min) && (max === null || x.price_cents <= max)
        && (!brand || lower(x.brand) === brand)
        && (!p.only_deals || x.compare_at_cents !== null)
        && (!storeSlug || lower(this.store(x.store_id)?.slug) === storeSlug)
        && (!sizes || this.variantsOf(x.id).some((v) => sizes.includes(lower(v.size)) && this.avail(v) > 0))
        && (!p.only_available || this.variantsOf(x.id).some((v) => this.avail(v) > 0)));
      const sorted = [...base].sort((x, y) => {
        if (sort === "price_asc" && x.price_cents !== y.price_cents) return x.price_cents - y.price_cents;
        if (sort === "price_desc" && x.price_cents !== y.price_cents) return y.price_cents - x.price_cents;
        if (sort === "popular") { const d = this.favCount(y.id) - this.favCount(x.id); if (d) return d; }
        return byDesc<ProductRow>((q) => q.published_at)(x, y);
      });
      let spotlight: unknown[] = [];
      if (cat && offset === 0) {
        const parentOfCat = db().categories.find((c) => c.id === cat)?.parent_id;
        spotlight = db().campaigns.filter((c) => c.kind === "category_spotlight" && c.status === "active" && this.t(c.ends_at) > this.now().getTime()
          && (c.category_id === cat || (parentOfCat && c.category_id === parentOfCat)))
          .map((c) => ({ c, pp: this.product(c.product_id) })).filter((x) => this.isPublic(x.pp ?? null))
          .map(({ c, pp }) => ({ ...this.card(pp!, uid), sponsored: true, campaign_id: c.id }));
      }
      return { items: sorted.slice(offset, offset + limit).map((x) => this.card(x, uid)), total: base.length, spotlight, limit, offset };
    };

    H.get_product = (a, uid) => {
      const p = this.product(a.p_id);
      if (!p) fail("not_found", "Este producto no existe o ya no está disponible.");
      const isOwner = !!uid && p!.seller_id === uid;
      const visible = this.isPublic(p!);
      const admin = this.isAdmin(uid);
      if (!visible && !isOwner && !admin) fail("not_found", "Este producto no existe o ya no está disponible.");
      const s = this.settings();
      const store = this.store(p!.store_id)!;
      const seller = this.profile(p!.seller_id)!;
      const cat = db().categories.find((c) => c.id === p!.category_id)!;
      const { search_text: _st, ...prod } = p!;
      const product: Record<string, unknown> = { ...prod };
      if (!(isOwner || admin)) delete product.moderation_note;
      const myOffer = uid ? db().offers.filter((o) => o.product_id === p!.id && o.buyer_id === uid && ["pending", "countered", "accepted"].includes(o.status))
        .sort(byDesc((o) => o.created_at))[0] : null;
      return {
        product,
        images: db().images.filter((i) => i.product_id === p!.id).sort((x, y) => x.position - y.position).map((i) => ({ id: i.id, url: i.url, storage_path: i.storage_path })),
        variants: this.variantsOf(p!.id).map((v) => ({
          id: v.id, size: v.size, color: v.color, sku: isOwner ? v.sku : null, price_cents: v.price_cents ?? p!.price_cents,
          available: this.avail(v), stock_on_hand: isOwner ? v.stock_on_hand : null, stock_reserved: isOwner ? v.stock_reserved : null })),
        seller: { id: seller.id, username: seller.username, display_name: seller.display_name, avatar_url: seller.avatar_url },
        store: { id: store.id, slug: store.slug, name: store.name, logo_url: store.logo_url, is_demo: store.is_demo, stats: this.storeStats(store.id) },
        category: { id: cat.id, name: cat.name, parent_id: cat.parent_id, size_system: cat.size_system },
        is_owner: isOwner, is_visible: visible,
        is_favorite: !!uid && db().favorites.some((f) => f.product_id === p!.id && f.user_id === uid),
        favorites_count: this.favCount(p!.id),
        offer_rules: { enabled: p!.offers_enabled && !isOwner && visible, min_percent: s.min_offer_percent, min_cents: Math.ceil(p!.price_cents * s.min_offer_percent / 100) },
        my_open_offer: myOffer ? { id: myOffer.id, status: myOffer.status, amount_cents: myOffer.amount_cents, awaiting: myOffer.awaiting, expires_at: myOffer.expires_at } : null,
        sponsored: db().campaigns.some((c) => c.product_id === p!.id && c.status === "active" && this.t(c.ends_at) > this.now().getTime()),
        similar: this.publicProducts().filter((x) => x.category_id === p!.category_id && x.id !== p!.id).sort(byDesc((x) => x.published_at)).slice(0, 8).map((x) => this.card(x, uid)),
        fees: { commission_bps: s.commission_bps, shipping_flat_cents: s.shipping_flat_cents, test_mode: s.test_mode },
      };
    };

    H.get_store = (a, uid) => {
      const s = db().stores.find((x) => lower(x.slug) === lower(a.p_slug));
      if (!s || (s.status !== "active" && s.owner_id !== uid && !this.isAdmin(uid))) fail("not_found", "Esta tienda no existe.");
      const b = db().businesses.find((x) => x.store_id === s!.id && x.status === "active");
      return {
        store: { ...this.storeCard(s!), status: s!.status, social_links: s!.social_links, business_info: s!.business_info, created_at: s!.created_at },
        is_owner: s!.owner_id === uid,
        is_following: !!uid && db().follows.some((f) => f.store_id === s!.id && f.user_id === uid),
        products: this.publicProducts().filter((p) => p.store_id === s!.id).sort(byDesc((p) => p.published_at)).slice(0, 120).map((p) => this.card(p, uid)),
        reviews: db().reviews.filter((r) => r.store_id === s!.id && r.status === "visible").sort(byDesc((r) => r.created_at)).slice(0, 20).map((r) => {
          const rv = this.profile(r.reviewer_id)!;
          return { id: r.id, rating: r.rating, body: r.body, created_at: r.created_at, is_test: r.is_test, reviewer: { username: rv.username, display_name: rv.display_name } };
        }),
        business: b ? this.businessCard(b) : null,
      };
    };

    H.get_business = (a, uid) => {
      const b = db().businesses.find((x) => lower(x.slug) === lower(a.p_slug));
      if (!b || (b.status !== "active" && b.owner_id !== uid && !this.isAdmin(uid))) fail("not_found", "Este negocio no existe.");
      const s = this.store(b!.store_id);
      return {
        business: { ...b! },
        is_owner: b!.owner_id === uid,
        store: s && s.status === "active" ? this.storeCard(s) : null,
        products: b!.store_id ? this.publicProducts().filter((p) => p.store_id === b!.store_id).sort(byDesc((p) => p.published_at)).slice(0, 24).map((p) => this.card(p, uid)) : [],
        promotions: db().campaigns.filter((c) => c.business_id === b!.id && c.status === "active" && this.t(c.ends_at) > this.now().getTime())
          .sort(byDesc((c) => c.starts_at)).map((c) => ({ id: c.id, kind: c.kind, headline: c.headline, body: c.body, ends_at: c.ends_at, is_test: c.is_test })),
      };
    };

    H.list_businesses = (a) => {
      const p = a.p ?? {};
      const q = lower(String(p.q ?? "").trim());
      const now = this.now().getTime();
      return db().businesses.filter((b) => b.status === "active" && (!p.category || b.category === p.category) && (!q || lower(b.name + " " + b.description).includes(q)))
        .map((b) => ({ b, c: db().campaigns.filter((c) => c.business_id === b.id && c.status === "active" && this.t(c.ends_at) > now).sort(byDesc((c) => c.starts_at))[0] ?? null }))
        .sort((x, y) => Number(!!y.c) - Number(!!x.c) || y.b.created_at.localeCompare(x.b.created_at)).slice(0, 100)
        .map(({ b, c }) => ({ ...this.businessCard(b), sponsored: !!c, campaign_id: c?.id ?? null }));
    };

    H.track_event = (a, uid) => {
      const p = a.p ?? {};
      if (!["impression", "click", "product_view", "store_view", "business_view"].includes(p.kind)) return null;
      const session = String(p.session_id || "anon").slice(0, 64);
      let campaign = p.campaign_id || null;
      if (campaign && !db().campaigns.some((c) => c.id === campaign && c.status === "active")) {
        campaign = null;
        if (p.kind === "impression" || p.kind === "click") return null;
      }
      if (p.kind === "impression" && db().analytics.some((e) => e.kind === "impression" && e.campaign_id === campaign && e.session_id === session
        && this.t(e.created_at) > this.now().getTime() - 30 * 60000)) return null;
      db().analytics.push({ id: ++db().seq.analytics, kind: p.kind, product_id: p.product_id || null, store_id: p.store_id || null,
        business_id: p.business_id || null, campaign_id: campaign, user_id: uid, session_id: session, created_at: this.iso() });
      return null;
    };

    // ---- cuenta
    H.my_account = (_a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const p = this.profile(uid)!;
      return {
        profile: { id: p.id, username: p.username, display_name: p.display_name, avatar_url: p.avatar_url, bio: p.bio, role: p.role, preferences: p.preferences, created_at: p.created_at },
        email: db().credentials.find((c) => c.user_id === uid)?.email ?? "",
        is_admin: p.role === "admin",
        addresses: db().addresses.filter((x) => x.user_id === uid).sort((x, y) => Number(y.is_default) - Number(x.is_default) || x.created_at.localeCompare(y.created_at)),
        stores: db().stores.filter((s) => s.owner_id === uid).sort(byAsc((s) => s.created_at)).map((s) => ({ ...this.storeCard(s), status: s.status, social_links: s.social_links, business_info: s.business_info })),
        businesses: db().businesses.filter((b) => b.owner_id === uid).sort(byAsc((b) => b.created_at)),
        unread_notifications: db().notifications.filter((n) => n.user_id === uid && !n.read_at).length,
        cart_count: db().cart.filter((c) => c.user_id === uid).reduce((n, c) => n + c.quantity, 0),
      };
    };

    H.update_profile = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const p = a.p ?? {};
      const prof = this.profile(uid)!;
      if ("username" in p) {
        const u = lower(String(p.username ?? "").trim());
        if (!/^[a-z0-9_.]{3,30}$/.test(u)) fail("validation", "El nombre de usuario debe tener 3–30 caracteres: letras minúsculas, números, punto o guion bajo.", { field: "username" });
        if (db().profiles.some((x) => lower(x.username) === u && x.id !== uid)) fail("username_taken", "Ese nombre de usuario ya está en uso.", { field: "username" });
        prof.username = u;
      }
      if ("display_name" in p) {
        const d = String(p.display_name ?? "").trim();
        if (d.length < 1 || d.length > 60) fail("validation", "El nombre visible debe tener entre 1 y 60 caracteres.", { field: "display_name" });
        prof.display_name = d;
      }
      if ("bio" in p) {
        if (String(p.bio ?? "").length > 500) fail("validation", "La biografía admite hasta 500 caracteres.", { field: "bio" });
        prof.bio = trimOrNull(p.bio) as string | null;
      }
      if ("avatar_url" in p) prof.avatar_url = p.avatar_url || null;
      if (p.preferences && typeof p.preferences === "object" && !Array.isArray(p.preferences)) prof.preferences = { ...prof.preferences, ...p.preferences };
      prof.updated_at = this.iso();
      return H.my_account({}, uid);
    };

    H.save_address = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const p = a.p ?? {};
      const mine = db().addresses.filter((x) => x.user_id === uid);
      if (!p.id && mine.length >= 10) fail("limit_reached", "Puedes guardar hasta 10 direcciones.");
      const full_name = String(p.full_name ?? "").trim(), line1 = String(p.line1 ?? "").trim(), city = String(p.city ?? "").trim();
      const region = String(p.region ?? "").trim(), postal = String(p.postal_code ?? "").trim();
      const country = (trimOrNull(p.country) as string | null)?.toUpperCase() ?? "US";
      if (full_name.length < 2 || full_name.length > 80 || line1.length < 3 || line1.length > 120 || city.length < 2 || region.length < 2
          || postal.length < 3 || postal.length > 12 || !/^[A-Z]{2}$/.test(country)) {
        fail("validation", "Revisa la dirección: nombre, calle, ciudad, estado/región y código postal son obligatorios.");
      }
      let isDefault = !!p.is_default;
      if (!mine.length) isDefault = true;
      if (isDefault) mine.forEach((x) => (x.is_default = false));
      if (!p.id) {
        const row = { id: uuid(), user_id: uid, full_name, line1, line2: trimOrNull(p.line2) as string | null, city, region, postal_code: postal,
          country, phone: trimOrNull(p.phone) as string | null, is_default: isDefault, created_at: this.iso() };
        db().addresses.push(row);
        return row;
      }
      const row = mine.find((x) => x.id === p.id);
      if (!row) fail("not_found", "La dirección no existe.");
      Object.assign(row!, { full_name, line1, line2: trimOrNull(p.line2), city, region, postal_code: postal, country, phone: trimOrNull(p.phone), is_default: isDefault || row!.is_default });
      return row;
    };

    H.delete_address = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      db().addresses = db().addresses.filter((x) => !(x.id === a.p_id && x.user_id === uid));
      const mine = db().addresses.filter((x) => x.user_id === uid);
      if (mine.length && !mine.some((x) => x.is_default)) mine.sort(byAsc((x) => x.created_at))[0].is_default = true;
      return null;
    };

    H.save_store = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const p = a.p ?? {};
      const slug = lower(String(p.slug ?? "").trim());
      this.validateSlug(slug, "La dirección de la tienda debe tener 3–40 caracteres: minúsculas, números y guiones.");
      if (db().stores.some((s) => lower(s.slug) === slug && s.id !== p.id)) fail("slug_taken", "Esa dirección de tienda ya está en uso.", { field: "slug" });
      if (!p.id && db().stores.filter((s) => s.owner_id === uid).length >= 5) fail("limit_reached", "Puedes tener hasta 5 tiendas por cuenta.");
      const name = String(p.name ?? "").trim();
      if (name.length < 2 || name.length > 60) fail("validation", "Revisa los datos de la tienda: el nombre debe tener entre 2 y 60 caracteres.");
      const accent = ["crimson", "ember", "steel", "ivory"].includes(p.accent) ? p.accent : "crimson";
      let s: StoreRow;
      if (!p.id) {
        s = { id: uuid(), owner_id: uid, slug, name, logo_url: p.logo_url || null, cover_url: p.cover_url || null, bio: trimOrNull(p.bio) as string | null,
          accent, categories: Array.isArray(p.categories) ? p.categories : [], social_links: p.social_links ?? {}, business_info: p.business_info ?? {},
          status: "active", is_demo: false, created_at: this.iso(), updated_at: this.iso() };
        db().stores.push(s);
      } else {
        const found = db().stores.find((x) => x.id === p.id && x.owner_id === uid);
        if (!found) fail("forbidden", "No puedes modificar tiendas de otros usuarios.");
        s = found!;
        Object.assign(s, { slug, name, logo_url: p.logo_url || null, cover_url: p.cover_url || null, bio: trimOrNull(p.bio), accent,
          categories: Array.isArray(p.categories) ? p.categories : s.categories, social_links: p.social_links ?? s.social_links,
          business_info: p.business_info ?? s.business_info, updated_at: this.iso() });
      }
      return { ...this.storeCard(s), status: s.status, social_links: s.social_links, business_info: s.business_info };
    };

    H.toggle_follow = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const s = db().stores.find((x) => x.id === a.p_store_id && x.status === "active");
      if (!s) fail("not_found", "La tienda no existe.");
      if (s!.owner_id === uid) fail("own_store", "No puedes seguir tu propia tienda.");
      const i = db().follows.findIndex((f) => f.user_id === uid && f.store_id === s!.id);
      if (i >= 0) db().follows.splice(i, 1);
      else {
        db().follows.push({ user_id: uid, store_id: s!.id, created_at: this.iso() });
        db().analytics.push({ id: ++db().seq.analytics, kind: "follow", product_id: null, store_id: s!.id, business_id: null, campaign_id: null, user_id: uid, session_id: null, created_at: this.iso() });
      }
      return { following: i < 0, followers: db().follows.filter((f) => f.store_id === s!.id).length };
    };

    H.toggle_favorite = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      if (!this.isPublic(this.product(a.p_product_id))) fail("not_found", "El producto no está disponible.");
      const i = db().favorites.findIndex((f) => f.user_id === uid && f.product_id === a.p_product_id);
      if (i >= 0) { db().favorites.splice(i, 1); return { favorite: false }; }
      db().favorites.push({ user_id: uid, product_id: a.p_product_id, created_at: this.iso() });
      return { favorite: true };
    };

    H.my_favorites = (_a, uidIn) => {
      const uid = this.requireUser(uidIn);
      return db().favorites.filter((f) => f.user_id === uid).sort(byDesc((f) => f.created_at))
        .map((f) => this.product(f.product_id)).filter((p) => this.isPublic(p)).map((p) => this.card(p!, uid));
    };

    H.my_notifications = (_a, uidIn) => {
      const uid = this.requireUser(uidIn);
      return db().notifications.filter((n) => n.user_id === uid).sort(byDesc((n) => n.created_at)).slice(0, 60)
        .map(({ user_id: _u, ...n }) => n);
    };
    H.mark_notifications_read = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      for (const n of db().notifications) if (n.user_id === uid && !n.read_at && (!a.p_ids || a.p_ids.includes(n.id))) n.read_at = this.iso();
      return null;
    };

    // ---- publicaciones
    H.save_listing = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const p = a.p ?? {};
      const status = p.status || "draft";
      if (!["draft", "active"].includes(status)) fail("validation", "Estado de publicación no válido.", { field: "status" });
      let old: ProductRow | null = null;
      if (p.id) {
        old = this.product(p.id);
        if (!old) fail("not_found", "La publicación no existe.");
        if (old!.seller_id !== uid) fail("forbidden", "No puedes modificar publicaciones de otros usuarios.");
        if (old!.status === "removed") fail("listing_removed", "Esta publicación fue eliminada y no se puede editar.");
        if (old!.moderation_status === "blocked" && status === "active") fail("listing_blocked", "Esta publicación fue bloqueada por moderación y no puede publicarse.");
      }
      const title = String(p.title ?? "").trim();
      if (title.length < 3 || title.length > 120) fail("validation", "El título debe tener entre 3 y 120 caracteres.", { field: "title" });
      const price = Math.round(Number(p.price_cents));
      if (!Number.isFinite(price) || price < 100 || price > 10000000) fail("validation", "El precio debe estar entre $1 y $100,000.", { field: "price_cents" });
      if (!CONDITIONS.includes(p.condition)) fail("validation", "Selecciona el estado del artículo.", { field: "condition" });
      const flaws = trimOrNull(p.flaws) as string | null;
      if (p.condition === "used_flawed" && (flaws ?? "").length < 5) fail("validation", "Describe los defectos del artículo (mínimo 5 caracteres).", { field: "flaws" });
      const cat = db().categories.find((c) => c.id === p.category_id && c.is_active);
      if (!cat) fail("validation", "Selecciona una categoría válida.", { field: "category_id" });
      if (String(p.description ?? "").length > 5000) fail("validation", "La descripción admite hasta 5.000 caracteres.", { field: "description" });
      const tags = [...new Set((Array.isArray(p.tags) ? p.tags : []).map((t: string) => lower(String(t).trim())).filter((t: string) => t.length >= 1 && t.length <= 30))] as string[];
      if (tags.length > 15) fail("validation", "Puedes añadir hasta 15 etiquetas.", { field: "tags" });
      const variants: any[] = Array.isArray(p.variants) ? p.variants : [];
      if (!variants.length) fail("validation", "Añade al menos una variante con su cantidad (por ejemplo, talla única con 1 unidad).", { field: "variants" });
      if (variants.length > 100) fail("validation", "Máximo 100 variantes por publicación.", { field: "variants" });
      const combos = variants.map((v) => `${lower(trimOrNull(v.size) as string)}|${lower(trimOrNull(v.color) as string)}`);
      if (new Set(combos).size !== combos.length) fail("validation", "Hay variantes repetidas (misma talla y color).", { field: "variants" });
      const images: any[] = Array.isArray(p.images) ? p.images : [];
      if (images.length > 12) fail("validation", "Puedes subir hasta 12 fotografías.", { field: "images" });
      if (images.some((i) => !/^(https?:|mzimg:|art:|data:image\/)/.test(String(i?.url ?? "")))) fail("validation", "Las fotografías deben subirse al almacenamiento de MARKETZONE.", { field: "images" });
      const brand = trimOrNull(p.brand) as string | null;
      if (status === "active") {
        if (!images.length) fail("validation", "Añade al menos una fotografía para publicar.", { field: "images" });
        if (cat!.required_fields.includes("brand") && !brand) fail("validation", `La marca es obligatoria en ${cat!.name}.`, { field: "brand" });
        if (cat!.required_fields.includes("size") && variants.some((v) => !trimOrNull(v.size))) fail("validation", `Indica la talla de cada variante en ${cat!.name}.`, { field: "variants" });
      }
      let storeId: string;
      if (p.store_id) {
        const s = db().stores.find((x) => x.id === p.store_id && x.owner_id === uid);
        if (!s) fail("forbidden", "La tienda seleccionada no te pertenece.");
        storeId = s!.id;
      } else storeId = old ? old.store_id : this.defaultStore(uid);
      const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
      const fields = {
        store_id: storeId, category_id: cat!.id, title, description: String(p.description ?? ""), brand, condition: p.condition,
        flaws: p.condition === "used_flawed" ? flaws : null, color: trimOrNull(p.color) as string | null, material: trimOrNull(p.material) as string | null,
        fit: trimOrNull(p.fit) as string | null, price_cents: price, tags,
        attributes: p.attributes && typeof p.attributes === "object" ? p.attributes : (old?.attributes ?? {}),
        weight_grams: num(p.weight_grams) === null ? null : Math.round(num(p.weight_grams)!), length_cm: num(p.length_cm), width_cm: num(p.width_cm), height_cm: num(p.height_cm),
        offers_enabled: p.offers_enabled ?? old?.offers_enabled ?? true,
      };
      let product: ProductRow;
      if (!old) {
        product = { id: uuid(), seller_id: uid, ...fields, compare_at_cents: null, status, moderation_status: "ok", moderation_note: null,
          ai_assisted: !!p.ai_assisted, is_demo: false, search_text: "", published_at: status === "active" ? this.iso() : null,
          created_at: this.iso(), updated_at: this.iso() } as ProductRow;
        db().products.push(product);
      } else {
        const compare = this.applyPrice(old, price, uid);
        Object.assign(old, fields, {
          compare_at_cents: compare,
          status: status === "active" ? "active" : old.status === "active" ? "active" : status,
          ai_assisted: old.ai_assisted || !!p.ai_assisted,
          published_at: status === "active" ? old.published_at ?? this.iso() : old.published_at, updated_at: this.iso(),
        });
        product = old;
      }
      product.search_text = this.searchText(product);
      const keep: string[] = [];
      variants.forEach((v, i) => {
        const size = trimOrNull(v.size) as string | null, color = trimOrNull(v.color) as string | null;
        const qty = Number(v.stock_on_hand);
        const vprice = v.price_cents === null || v.price_cents === undefined || v.price_cents === "" ? null : Math.round(Number(v.price_cents));
        if (!Number.isInteger(qty) || qty < 0 || qty > 100000) fail("validation", "Cada variante necesita una cantidad entre 0 y 100.000.", { field: "variants" });
        if (vprice !== null && (vprice < 100 || vprice > 10000000)) fail("validation", "El precio de la variante debe estar entre $1 y $100,000.", { field: "variants" });
        const existing = db().variants.filter((x) => x.product_id === product.id)
          .find((x) => (v.id && x.id === v.id)) ?? db().variants.find((x) => x.product_id === product.id && lower(x.size) === lower(size) && lower(x.color) === lower(color));
        if (existing) {
          if (qty < existing.stock_reserved) fail("stock_below_reserved", `No puedes dejar ${size ?? "la variante"} en ${qty} unidades: hay ${existing.stock_reserved} reservadas en pedidos pendientes.`, { field: "variants", variant_id: existing.id, reserved: existing.stock_reserved });
          const delta = qty - existing.stock_on_hand;
          Object.assign(existing, { size, color, sku: trimOrNull(v.sku), price_cents: vprice, stock_on_hand: qty, is_active: true, position: i + 1, updated_at: this.iso() });
          if (delta) this.logMovement(existing, "adjustment", delta, 0, null, null, uid, "Edición de publicación");
          keep.push(existing.id);
        } else {
          const row: VariantRow = { id: uuid(), product_id: product.id, size, color, sku: trimOrNull(v.sku) as string | null, price_cents: vprice,
            stock_on_hand: qty, stock_reserved: 0, is_active: true, position: i + 1, created_at: this.iso(), updated_at: this.iso() };
          db().variants.push(row);
          this.logMovement(row, "initial", qty, 0, null, null, uid, "Alta de variante");
          keep.push(row.id);
        }
      });
      const dropped = db().variants.filter((x) => x.product_id === product.id && x.is_active && !keep.includes(x.id));
      if (dropped.some((x) => x.stock_reserved > 0)) fail("variant_has_reservations", "No puedes quitar una variante con unidades reservadas en pedidos pendientes.", { field: "variants" });
      dropped.forEach((x) => (x.is_active = false));
      db().images = db().images.filter((x) => x.product_id !== product.id);
      images.forEach((img, i) => db().images.push({ id: uuid(), product_id: product.id, url: img.url, storage_path: img.storage_path ?? null, position: i, created_at: this.iso() }));
      return { id: product.id, status: product.status };
    };

    H.set_listing_status = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const st = a.p_status;
      if (!["active", "paused", "draft", "removed"].includes(st)) fail("validation", "Acción no válida.");
      const ids: string[] = a.p_ids ?? [];
      if (!ids.length || ids.length > 200) fail("validation", "Selecciona entre 1 y 200 publicaciones.");
      let count = 0;
      for (const p of db().products.filter((x) => ids.includes(x.id)).sort((x, y) => x.id.localeCompare(y.id))) {
        if (p.seller_id !== uid) fail("forbidden", "No puedes modificar publicaciones de otros usuarios.");
        if (p.status === "removed") continue;
        if (st === "active") {
          if (p.moderation_status === "blocked") fail("listing_blocked", `"${p.title}" fue bloqueada por moderación.`);
          if (!this.firstImage(p.id)) fail("validation", `"${p.title}" necesita al menos una fotografía para publicarse.`);
        }
        if (st === "removed" && db().variants.some((v) => v.product_id === p.id && v.stock_reserved > 0)) {
          fail("has_reservations", `"${p.title}" tiene unidades reservadas en pedidos pendientes. Pausa la publicación en su lugar.`);
        }
        p.status = st; p.updated_at = this.iso();
        if (st === "active") p.published_at = p.published_at ?? this.iso();
        count++;
      }
      return { updated: count };
    };

    H.quick_update_variant = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const v = this.variant(a.p_variant_id);
      if (!v) fail("not_found", "La variante no existe.");
      if (this.product(v!.product_id)!.seller_id !== uid) fail("forbidden", "No puedes modificar el inventario de otros vendedores.");
      const qty = a.p_stock_on_hand;
      if (!Number.isInteger(qty) || qty < 0 || qty > 100000) fail("validation", "La cantidad debe estar entre 0 y 100.000.");
      if (qty < v!.stock_reserved) fail("stock_below_reserved", `Hay ${v!.stock_reserved} unidades reservadas en pedidos pendientes; la cantidad no puede ser menor.`);
      const delta = qty - v!.stock_on_hand;
      v!.stock_on_hand = qty; v!.updated_at = this.iso();
      if (delta) this.logMovement(v!, "adjustment", delta, 0, null, null, uid, "Edición rápida");
      return { id: v!.id, stock_on_hand: qty, stock_reserved: v!.stock_reserved, available: qty - v!.stock_reserved };
    };

    H.quick_update_price = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const p = this.product(a.p_product_id);
      if (!p) fail("not_found", "La publicación no existe.");
      if (p!.seller_id !== uid) fail("forbidden", "No puedes modificar publicaciones de otros usuarios.");
      const price = a.p_price_cents;
      if (!Number.isInteger(price) || price < 100 || price > 10000000) fail("validation", "El precio debe estar entre $1 y $100,000.");
      const compare = this.applyPrice(p!, price, uid);
      p!.price_cents = price; p!.compare_at_cents = compare; p!.updated_at = this.iso();
      return { id: p!.id, price_cents: price, compare_at_cents: compare };
    };

    H.bulk_adjust_price = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const pct = a.p_percent;
      if (!Number.isInteger(pct) || pct < -90 || pct > 200 || pct === 0) fail("validation", "El ajuste debe estar entre -90 % y +200 %.");
      let count = 0;
      for (const p of db().products.filter((x) => (a.p_ids ?? []).includes(x.id)).sort((x, y) => x.id.localeCompare(y.id))) {
        if (p.seller_id !== uid) fail("forbidden", "No puedes modificar publicaciones de otros usuarios.");
        if (p.status === "removed") continue;
        const np = Math.max(100, Math.min(10000000, Math.round(p.price_cents * (100 + pct) / 100)));
        const compare = this.applyPrice(p, np, uid);
        p.price_cents = np; p.compare_at_cents = compare; p.updated_at = this.iso();
        count++;
      }
      return { updated: count };
    };

    H.get_listing_for_edit = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const p = this.product(a.p_id);
      if (!p || p.seller_id !== uid) fail("not_found", "La publicación no existe.");
      const { search_text: _s, ...rest } = p!;
      return {
        ...rest,
        images: db().images.filter((i) => i.product_id === p!.id).sort((x, y) => x.position - y.position).map((i) => ({ url: i.url, storage_path: i.storage_path })),
        variants: this.variantsOf(p!.id).map((v) => ({ id: v.id, size: v.size, color: v.color, sku: v.sku, price_cents: v.price_cents, stock_on_hand: v.stock_on_hand, stock_reserved: v.stock_reserved })),
      };
    };

    H.seller_catalog = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const p = a.p ?? {};
      const q = lower(String(p.q ?? "").trim());
      const status = p.status || "all";
      const cat = p.category || null;
      const size = trimOrNull(p.size) ? lower(p.size.trim()) : null;
      const min = p.min_price_cents ?? null, max = p.max_price_cents ?? null;
      const from = p.date_from ? new Date(p.date_from).getTime() : null;
      const to = p.date_to ? new Date(p.date_to).getTime() : null;
      const availability = p.availability || "any";
      const sort = p.sort || "updated";
      const limit = Math.min(Math.max(Number(p.limit ?? 50), 1), 200);
      const offset = Math.max(Number(p.offset ?? 0), 0);
      const childOf = (id: string) => db().categories.filter((c) => c.parent_id === id).map((c) => c.id);
      const rows = db().products.filter((x) => x.seller_id === uid && x.status !== "removed").map((x) => {
        const vs = this.variantsOf(x.id);
        const on_hand = vs.reduce((n, v) => n + v.stock_on_hand, 0), reserved = vs.reduce((n, v) => n + v.stock_reserved, 0);
        return { x, vs, on_hand, reserved, available: on_hand - reserved };
      });
      const filtered = rows.filter(({ x, vs, available }) =>
        (!q || x.search_text.includes(q)) && (!cat || x.category_id === cat || childOf(cat).includes(x.category_id))
        && (min === null || x.price_cents >= min) && (max === null || x.price_cents <= max)
        && (from === null || this.t(x.published_at ?? x.created_at) >= from) && (to === null || this.t(x.published_at ?? x.created_at) <= to)
        && (!size || vs.some((v) => lower(v.size) === size))
        && (availability === "any" || (availability === "in_stock" && available > 0) || (availability === "sold_out" && available <= 0)));
      const scoped = filtered.filter((r) => status === "all" || (status === "sold_out" ? r.x.status === "active" && r.available <= 0 : r.x.status === status));
      scoped.sort((r1, r2) => {
        if (sort === "price_asc" && r1.x.price_cents !== r2.x.price_cents) return r1.x.price_cents - r2.x.price_cents;
        if (sort === "price_desc" && r1.x.price_cents !== r2.x.price_cents) return r2.x.price_cents - r1.x.price_cents;
        if (sort === "stock_asc" && r1.available !== r2.available) return r1.available - r2.available;
        if (sort === "published") { const d = byDesc<ProductRow>((x) => x.published_at)(r1.x, r2.x); if (d) return d; }
        return r2.x.updated_at.localeCompare(r1.x.updated_at);
      });
      return {
        total: scoped.length,
        counts: {
          all: filtered.length, active: filtered.filter((r) => r.x.status === "active").length, draft: filtered.filter((r) => r.x.status === "draft").length,
          paused: filtered.filter((r) => r.x.status === "paused").length, sold_out: filtered.filter((r) => r.x.status === "active" && r.available <= 0).length,
        },
        items: scoped.slice(offset, offset + limit).map(({ x, vs, on_hand, reserved, available }) => ({
          id: x.id, title: x.title, brand: x.brand, status: x.status, moderation_status: x.moderation_status, price_cents: x.price_cents,
          compare_at_cents: x.compare_at_cents, category_id: x.category_id, condition: x.condition, is_demo: x.is_demo, published_at: x.published_at,
          updated_at: x.updated_at, created_at: x.created_at, on_hand, reserved, available, image_url: this.firstImage(x.id),
          variants: vs.map((v) => ({ id: v.id, size: v.size, color: v.color, sku: v.sku, stock_on_hand: v.stock_on_hand, stock_reserved: v.stock_reserved, available: this.avail(v) })),
          offers_pending: db().offers.filter((o) => o.product_id === x.id && o.status === "pending").length,
        })),
      };
    };

    H.inventory_history = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const p = this.product(a.p_product_id);
      if (!p || (p.seller_id !== uid && !this.isAdmin(uid))) fail("not_found", "La publicación no existe.");
      return db().movements.filter((m) => m.product_id === p!.id).sort((x, y) => y.id - x.id).slice(0, 200).map((m) => {
        const v = this.variant(m.variant_id);
        return { id: m.id, kind: m.kind, on_hand_delta: m.on_hand_delta, reserved_delta: m.reserved_delta, on_hand_after: m.on_hand_after,
          reserved_after: m.reserved_after, note: m.note, created_at: m.created_at, order_id: m.order_id, size: v?.size ?? null, color: v?.color ?? null };
      });
    };

    H.seller_dashboard = (_a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const mine = db().products.filter((p) => p.seller_id === uid && p.status !== "removed");
      const availOf = (p: ProductRow) => this.variantsOf(p.id).reduce((n, v) => n + this.avail(v), 0);
      const sos = db().seller_orders.filter((so) => so.seller_id === uid);
      const offers = db().offers.filter((o) => o.seller_id === uid);
      const camps = db().campaigns.filter((c) => c.owner_id === uid);
      const myIds = mine.map((p) => p.id);
      return {
        listings: {
          active: mine.filter((p) => p.status === "active").length, draft: mine.filter((p) => p.status === "draft").length,
          paused: mine.filter((p) => p.status === "paused").length, sold_out: mine.filter((p) => p.status === "active" && availOf(p) <= 0).length,
          blocked: mine.filter((p) => p.moderation_status === "blocked").length,
          units_available: mine.filter((p) => p.status === "active").reduce((n, p) => n + availOf(p), 0),
          units_reserved: mine.reduce((n, p) => n + this.variantsOf(p.id).reduce((m, v) => m + v.stock_reserved, 0), 0),
        },
        orders: {
          pending_payment: sos.filter((s) => s.status === "pending_payment").length, to_ship: sos.filter((s) => s.status === "paid" || s.status === "preparing").length,
          shipped: sos.filter((s) => s.status === "shipped").length, completed: sos.filter((s) => s.status === "delivered").length,
          cancelled: sos.filter((s) => s.status === "cancelled").length, refunded: sos.filter((s) => s.status === "refunded").length,
        },
        money_real: this.moneyBlock(uid, false),
        money_test: this.moneyBlock(uid, true),
        offers: { awaiting_you: offers.filter((o) => o.status === "pending").length, awaiting_buyer: offers.filter((o) => o.status === "countered").length,
          accepted_unpaid: offers.filter((o) => o.status === "accepted").length },
        campaigns: { active: camps.filter((c) => c.status === "active").length, pending: camps.filter((c) => c.status === "pending_review" || c.status === "pending_payment").length },
        views_30d: db().analytics.filter((e) => e.kind === "product_view" && e.product_id && myIds.includes(e.product_id) && this.t(e.created_at) > this.now().getTime() - 30 * 864e5).length,
        settings: this.publicSettings(),
        stores: db().stores.filter((s) => s.owner_id === uid).sort(byAsc((s) => s.created_at)).map((s) => ({ id: s.id, slug: s.slug, name: s.name })),
      };
    };

    // ---- carrito
    H.get_cart = (_a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const s = this.settings();
      const lines = db().cart.filter((c) => c.user_id === uid).sort(byAsc((c) => c.created_at)).map((c) => {
        const v = this.variant(c.variant_id)!;
        const p = this.product(v.product_id)!;
        const available = Math.max(this.avail(v), 0);
        const purchasable = v.is_active && this.isPublic(p);
        const issue = !purchasable ? "unavailable" : p.seller_id === uid ? "own_item" : p.is_demo && !s.test_mode ? "demo_item"
          : available === 0 ? "sold_out" : c.quantity > available ? "insufficient_stock" : null;
        const unit = v.price_cents ?? p.price_cents;
        const seller = this.profile(p.seller_id)!;
        const st = this.store(p.store_id)!;
        return { id: c.id, variant_id: v.id, product_id: p.id, title: p.title, size: v.size, color: v.color, quantity: c.quantity,
          unit_price_cents: unit, line_total_cents: unit * c.quantity, available, issue, is_demo: p.is_demo, image_url: this.firstImage(p.id),
          seller: { id: seller.id, username: seller.username }, store: { slug: st.slug, name: st.name }, _seller: p.seller_id };
      });
      const ok = lines.filter((l) => !l.issue);
      const subtotal = ok.reduce((n, l) => n + l.line_total_cents, 0);
      const okSellers = new Set(ok.map((l) => l._seller)).size;
      return {
        lines: lines.map(({ _seller, ...l }) => l),
        subtotal_cents: subtotal, shipping_cents: okSellers * s.shipping_flat_cents, tax_cents: 0,
        total_cents: subtotal + okSellers * s.shipping_flat_cents, sellers: new Set(lines.map((l) => l._seller)).size,
        has_issues: lines.some((l) => l.issue), test_mode: s.test_mode, shipping_flat_cents: s.shipping_flat_cents, hold_minutes: s.checkout_hold_minutes,
      };
    };

    H.cart_add = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const qty = a.p_quantity ?? 1;
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) fail("validation", "La cantidad debe estar entre 1 y 99.");
      const v = this.variant(a.p_variant_id);
      if (!v || !v.is_active) fail("not_found", "Esta talla o variante ya no existe.");
      const p = this.product(v!.product_id)!;
      if (!this.isPublic(p)) fail("unavailable", "Este producto ya no está disponible.");
      if (p.seller_id === uid) fail("own_item", "No puedes comprar tus propios productos.");
      if (p.is_demo && !this.settings().test_mode) fail("demo_item", "Este es un producto de ejemplo y no se puede comprar.");
      const line = db().cart.find((c) => c.user_id === uid && c.variant_id === v!.id);
      const av = Math.max(this.avail(v!), 0);
      if ((line?.quantity ?? 0) + qty > av) fail("insufficient_stock", `Solo hay ${av} unidad(es) disponible(s) de esta variante.`, { available: av });
      if (line) line.quantity += qty;
      else db().cart.push({ id: uuid(), user_id: uid, variant_id: v!.id, quantity: qty, created_at: this.iso() });
      db().analytics.push({ id: ++db().seq.analytics, kind: "add_to_cart", product_id: p.id, store_id: p.store_id, business_id: null, campaign_id: null, user_id: uid, session_id: null, created_at: this.iso() });
      return H.get_cart({}, uid);
    };

    H.cart_update = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const qty = a.p_quantity;
      if (!Number.isInteger(qty) || qty < 0 || qty > 99) fail("validation", "La cantidad debe estar entre 0 y 99.");
      if (qty === 0) db().cart = db().cart.filter((c) => !(c.id === a.p_item_id && c.user_id === uid));
      else { const l = db().cart.find((c) => c.id === a.p_item_id && c.user_id === uid); if (l) l.quantity = qty; }
      return H.get_cart({}, uid);
    };

    H.cart_remove = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      db().cart = db().cart.filter((c) => !(c.id === a.p_item_id && c.user_id === uid));
      return H.get_cart({}, uid);
    };

    H.checkout = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const s = this.settings();
      const addr = db().addresses.find((x) => x.id === a.p_address_id && x.user_id === uid);
      if (!addr) fail("address_required", "Selecciona una dirección de envío.");
      const lines = db().cart.filter((c) => c.user_id === uid);
      if (!lines.length) fail("cart_empty", "Tu carrito está vacío.");
      const issues: unknown[] = [];
      const rows = lines.map((c) => {
        const v = this.variant(c.variant_id)!;
        const p = this.product(v.product_id)!;
        return { c, v, p, unit: v.price_cents ?? p.price_cents };
      });
      for (const { c, v, p } of rows) {
        if (!(this.isPublic(p) && v.is_active)) issues.push({ item_id: c.id, title: p.title, issue: "unavailable" });
        else if (p.seller_id === uid) issues.push({ item_id: c.id, title: p.title, issue: "own_item" });
        else if (p.is_demo && !s.test_mode) issues.push({ item_id: c.id, title: p.title, issue: "demo_item" });
        else if (this.avail(v) < c.quantity) issues.push({ item_id: c.id, title: p.title, issue: this.avail(v) <= 0 ? "sold_out" : "insufficient_stock", available: Math.max(this.avail(v), 0) });
      }
      if (issues.length) fail("cart_conflict", "Algunos artículos cambiaron de disponibilidad. Revisa tu carrito antes de continuar.", { issues });
      const subtotal = rows.reduce((n, r) => n + r.unit * r.c.quantity, 0);
      const sellers = [...new Set(rows.map((r) => r.p.seller_id))];
      const due = this.iso(s.checkout_hold_minutes * 60000);
      const order: OrderRow = { id: uuid(), number: ++db().seq.order, buyer_id: uid, source: "cart", offer_id: null, status: "pending_payment",
        is_test: s.test_mode, currency: "USD", subtotal_cents: subtotal, shipping_cents: sellers.length * s.shipping_flat_cents, tax_cents: 0,
        total_cents: subtotal + sellers.length * s.shipping_flat_cents, shipping_address: this.addressSnapshot(addr!), payment_due_at: due,
        paid_at: null, cancelled_at: null, created_at: this.iso(), updated_at: this.iso() };
      db().orders.push(order);
      for (const sellerId of sellers) {
        const mine = rows.filter((r) => r.p.seller_id === sellerId);
        const sub = mine.reduce((n, r) => n + r.unit * r.c.quantity, 0);
        const commission = Math.round(sub * s.commission_bps / 10000);
        db().seller_orders.push({ id: uuid(), order_id: order.id, seller_id: sellerId, store_id: mine[0].p.store_id, status: "pending_payment",
          subtotal_cents: sub, shipping_cents: s.shipping_flat_cents, commission_bps: s.commission_bps, commission_cents: commission,
          seller_net_cents: sub - commission, payout_status: "not_applicable", carrier: null, tracking_number: null, shipped_at: null,
          delivered_at: null, created_at: this.iso(), updated_at: this.iso() });
      }
      for (const r of [...rows].sort((x, y) => x.v.id.localeCompare(y.v.id))) {
        const so = db().seller_orders.find((x) => x.order_id === order.id && x.seller_id === r.p.seller_id)!;
        db().order_items.push({ id: uuid(), order_id: order.id, seller_order_id: so.id, product_id: r.p.id, variant_id: r.v.id, title: r.p.title,
          size: r.v.size, color: r.v.color, image_url: this.firstImage(r.p.id), unit_price_cents: r.unit, quantity: r.c.quantity, line_total_cents: r.unit * r.c.quantity });
        this.reserve(r.v.id, r.c.quantity, order.id, uid, due);
      }
      db().cart = db().cart.filter((c) => c.user_id !== uid);
      return { order_id: order.id, number: order.number, total_cents: order.total_cents, payment_due_at: order.payment_due_at, is_test: order.is_test };
    };

    H.pay_order_test = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const o = db().orders.find((x) => x.id === a.p_order_id);
      if (!o || o.buyer_id !== uid) fail("not_found", "El pedido no existe.");
      if (o!.status === "paid") return { order_id: o!.id, status: "paid", already_paid: true };
      if (!o!.is_test) fail("real_payment_required", "Este pedido requiere un pago real a través del proveedor de pagos.");
      if (!this.settings().test_mode) fail("test_mode_disabled", "Los pagos de prueba están desactivados.");
      if (o!.status !== "pending_payment") fail("order_not_payable", "Este pedido ya no se puede pagar.", { status: o!.status });
      if (this.t(o!.payment_due_at) <= this.now().getTime()) { this.expireOrder(o!.id); return { order_id: o!.id, status: "expired" }; }
      if (!o!.shipping_address?.line1) fail("address_required", "Añade una dirección de envío antes de pagar.");
      this.convertOrder(o!.id, uid);
      db().payments.push({ id: uuid(), order_id: o!.id, campaign_id: null, payer_id: uid, provider: "test", provider_ref: "test_" + uuid().replace(/-/g, ""),
        amount_cents: o!.total_cents, currency: "USD", status: "succeeded", is_test: true, created_at: this.iso() });
      this.finalizePaid(o!, uid);
      return { order_id: o!.id, status: "paid", is_test: true };
    };

    H.cancel_order = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const o = db().orders.find((x) => x.id === a.p_order_id);
      if (!o || o.buyer_id !== uid) fail("not_found", "El pedido no existe.");
      if (o!.status !== "pending_payment") fail("order_not_cancellable", "Solo puedes cancelar pedidos pendientes de pago.");
      this.releaseOrder(o!.id, "released", uid);
      o!.status = "cancelled"; o!.cancelled_at = this.iso(); o!.updated_at = this.iso();
      db().seller_orders.filter((so) => so.order_id === o!.id).forEach((so) => (so.status = "cancelled"));
      if (o!.offer_id) {
        const of = db().offers.find((x) => x.id === o!.offer_id)!;
        of.status = "cancelled"; of.awaiting = "none"; of.updated_at = this.iso();
        this.offerEvent(of.id, uid, "buyer", "cancel", null, "El comprador canceló la compra antes de pagar.");
        this.notify(of.seller_id, "offer_cancelled", "Compra cancelada", "El comprador canceló antes de pagar. La unidad vuelve a estar disponible.", "/ofertas");
      }
      return { order_id: o!.id, status: "cancelled" };
    };

    H.set_order_address = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const addr = db().addresses.find((x) => x.id === a.p_address_id && x.user_id === uid);
      if (!addr) fail("not_found", "La dirección no existe.");
      const o = db().orders.find((x) => x.id === a.p_order_id && x.buyer_id === uid && x.status === "pending_payment");
      if (!o) fail("order_not_editable", "Solo puedes cambiar la dirección de pedidos pendientes de pago.");
      o!.shipping_address = this.addressSnapshot(addr!);
      return H.get_order({ p_order_id: o!.id }, uid);
    };

    H.get_order = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const o = db().orders.find((x) => x.id === a.p_order_id);
      if (!o) fail("not_found", "El pedido no existe.");
      if (o!.buyer_id !== uid && !this.isAdmin(uid) && !db().seller_orders.some((so) => so.order_id === o!.id && so.seller_id === uid)) fail("not_found", "El pedido no existe.");
      return this.orderJson(o!, uid);
    };

    H.my_orders = (_a, uidIn) => {
      const uid = this.requireUser(uidIn);
      return db().orders.filter((o) => o.buyer_id === uid).sort(byDesc((o) => o.created_at)).map((o) => {
        const items = db().order_items.filter((i) => i.order_id === o.id);
        return { id: o.id, number: o.number, status: o.status, is_test: o.is_test, source: o.source, total_cents: o.total_cents,
          payment_due_at: o.payment_due_at, created_at: o.created_at, items_count: items.reduce((n, i) => n + i.quantity, 0),
          preview: items.slice(0, 3).map((i) => i.image_url), fulfillment: db().seller_orders.filter((so) => so.order_id === o.id).map((so) => so.status) };
      });
    };

    H.seller_orders_list = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      return db().seller_orders.filter((so) => so.seller_id === uid && (!a.p_status || so.status === a.p_status)).sort(byDesc((so) => so.created_at)).map((so) => {
        const o = db().orders.find((x) => x.id === so.order_id)!;
        return { ...this.sellerOrderJson(so), order_number: o.number, order_status: o.status, is_test: o.is_test, payment_due_at: o.payment_due_at,
          shipping_address: ["paid", "preparing", "shipped", "delivered"].includes(so.status) ? o.shipping_address : null,
          buyer: { username: this.profile(o.buyer_id)!.username } };
      });
    };

    H.seller_update_fulfillment = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const so = db().seller_orders.find((x) => x.id === a.p_seller_order_id);
      if (!so || so.seller_id !== uid) fail("not_found", "El pedido no existe.");
      const to = a.p_status;
      const ok = (so!.status === "paid" && (to === "preparing" || to === "shipped")) || (so!.status === "preparing" && to === "shipped") || (so!.status === "shipped" && to === "delivered");
      if (!ok) fail("invalid_transition", "Ese cambio de estado no es válido para este pedido.", { from: so!.status, to });
      so!.status = to; so!.updated_at = this.iso();
      if (to === "shipped") { so!.carrier = trimOrNull(a.p_carrier) as string | null; so!.tracking_number = trimOrNull(a.p_tracking) as string | null; so!.shipped_at = this.iso(); }
      if (to === "delivered") so!.delivered_at = this.iso();
      const o = db().orders.find((x) => x.id === so!.order_id)!;
      const label = to === "preparing" ? "en preparación" : to === "shipped" ? "enviado" : "entregado";
      this.notify(o.buyer_id, `order_${to}`, `Pedido #${o.number}: ${label}`,
        to === "shipped" && trimOrNull(a.p_tracking) ? `Seguimiento: ${a.p_carrier ?? ""} ${a.p_tracking}` : null, `/pedido/${o.id}`);
      return this.sellerOrderJson(so!);
    };

    H.buyer_confirm_delivery = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const so = db().seller_orders.find((x) => x.id === a.p_seller_order_id);
      const o = so ? db().orders.find((x) => x.id === so.order_id) : null;
      if (!so || !o || o.buyer_id !== uid) fail("not_found", "El pedido no existe.");
      if (so!.status !== "shipped") fail("invalid_transition", "Solo puedes confirmar la entrega de pedidos enviados.");
      so!.status = "delivered"; so!.delivered_at = this.iso();
      this.notify(so!.seller_id, "order_delivered", "Entrega confirmada por el comprador", null, "/panel/pedidos");
      return this.orderJson(o!, uid);
    };

    H.refund_seller_order = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const admin = this.isAdmin(uid);
      const so = db().seller_orders.find((x) => x.id === a.p_seller_order_id);
      if (!so || (so.seller_id !== uid && !admin)) fail("not_found", "El pedido no existe.");
      const o = db().orders.find((x) => x.id === so!.order_id)!;
      if (String(a.p_reason ?? "").trim().length < 3) fail("validation", "Indica el motivo del reembolso.");
      if (!admin && !["paid", "preparing"].includes(so!.status)) fail("invalid_transition", "Solo puedes reembolsar pedidos pagados que aún no se han enviado. Contacta con soporte para otros casos.");
      if (admin && !["paid", "preparing", "shipped", "delivered"].includes(so!.status)) fail("invalid_transition", "Este pedido no admite reembolso.");
      if (!o.is_test) fail("provider_required", "Los reembolsos de pagos reales se tramitarán por el proveedor de pagos (pendiente de integración).");
      const amount = so!.subtotal_cents + so!.shipping_cents;
      const restock = a.p_restock ?? true;
      db().refunds.push({ id: uuid(), order_id: o.id, seller_order_id: so!.id, amount_cents: amount, reason: String(a.p_reason).trim(), status: "succeeded",
        is_test: true, restocked: !!restock, created_by: uid, created_at: this.iso() });
      so!.status = "refunded"; so!.payout_status = "reversed";
      if (restock) {
        for (const it of db().order_items.filter((i) => i.seller_order_id === so!.id && i.variant_id)) {
          const v = this.variant(it.variant_id)!;
          v.stock_on_hand += it.quantity;
          this.logMovement(v, "restock", it.quantity, 0, o.id, null, uid, "Reposición por reembolso");
        }
      }
      o.status = db().seller_orders.filter((x) => x.order_id === o.id).every((x) => x.status === "refunded" || x.status === "cancelled") ? "refunded" : "partially_refunded";
      this.notify(o.buyer_id, "order_refunded", `Reembolso del pedido #${o.number}`, `Reembolso de prueba por ${money(amount)} (sin dinero real).`, `/pedido/${o.id}`);
      if (admin) this.audit(uid, "refund_seller_order", "seller_order", so!.id, { amount });
      return this.orderJson(o, uid);
    };

    // ---- ofertas
    H.make_offer = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const s = this.settings();
      const v = this.variant(a.p_variant_id);
      if (!v || !v.is_active) fail("not_found", "Esta variante ya no existe.");
      const p = this.product(v!.product_id)!;
      if (!this.isPublic(p)) fail("unavailable", "Este producto ya no está disponible.");
      if (p.seller_id === uid) fail("own_item", "No puedes hacer ofertas a tus propios productos.");
      if (!p.offers_enabled) fail("offers_disabled", "El vendedor no acepta ofertas en este artículo.");
      if (p.is_demo && !s.test_mode) fail("demo_item", "Este es un producto de ejemplo.");
      const qty = a.p_quantity ?? 1;
      if (!Number.isInteger(qty) || qty < 1 || qty > 10) fail("validation", "La cantidad de la oferta debe estar entre 1 y 10.");
      const list = v!.price_cents ?? p.price_cents;
      const min = Math.ceil(list * s.min_offer_percent / 100);
      const amount = a.p_amount_cents;
      if (amount === null || amount === undefined || amount >= list) fail("offer_too_high", "Tu oferta debe ser menor que el precio publicado. Para pagar el precio completo, añade el artículo al carrito.");
      if (amount < min) fail("offer_too_low", `La oferta mínima para este artículo es ${money(min)}.`, { min_cents: min });
      if (this.avail(v!) < qty) fail("out_of_stock", "No hay unidades disponibles de esta variante en este momento.");
      if (db().offers.some((o) => o.buyer_id === uid && o.variant_id === v!.id && (o.status === "pending" || o.status === "countered"))) {
        fail("offer_exists", "Ya tienes una oferta abierta para esta variante. Espera la respuesta del vendedor.");
      }
      const offer: OfferRow = { id: uuid(), product_id: p.id, variant_id: v!.id, buyer_id: uid, seller_id: p.seller_id, quantity: qty, list_price_cents: list,
        offer_cents: amount, amount_cents: amount, status: "pending", awaiting: "seller", expires_at: this.iso(s.offer_response_minutes * 60000),
        order_id: null, created_at: this.iso(), updated_at: this.iso() };
      db().offers.push(offer);
      this.offerEvent(offer.id, uid, "buyer", "offer", amount);
      this.notify(p.seller_id, "offer_received", `Nueva oferta: ${money(amount)}`, `Por "${p.title}" (precio publicado ${money(list)}).`, "/ofertas");
      return this.offerJson(offer, uid);
    };

    H.respond_offer = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const s = this.settings();
      const o = db().offers.find((x) => x.id === a.p_offer_id);
      if (!o || (o.buyer_id !== uid && o.seller_id !== uid)) fail("not_found", "La oferta no existe.");
      const role = o!.seller_id === uid ? "seller" : "buyer";
      const other = role === "seller" ? o!.buyer_id : o!.seller_id;
      const action = a.p_action;
      if (action === "cancel") {
        if (role !== "buyer" || !["pending", "countered"].includes(o!.status)) fail("invalid_action", "No puedes retirar esta oferta.");
        o!.status = "cancelled"; o!.awaiting = "none"; o!.updated_at = this.iso();
        this.offerEvent(o!.id, uid, "buyer", "cancel");
        return this.offerJson(o!, uid);
      }
      if (!["pending", "countered"].includes(o!.status) || o!.awaiting !== role) fail("not_your_turn", "Esta oferta no está esperando tu respuesta.");
      if (action === "decline") {
        o!.status = "declined"; o!.awaiting = "none"; o!.updated_at = this.iso();
        this.offerEvent(o!.id, uid, role, "decline");
        this.notify(other, "offer_declined", role === "seller" ? "El vendedor rechazó tu oferta" : "El comprador rechazó tu contraoferta", null, "/ofertas");
        return this.offerJson(o!, uid);
      }
      if (action === "counter") {
        if (role !== "seller" || o!.status !== "pending") fail("invalid_action", "Solo el vendedor puede contraofertar una oferta pendiente.");
        const amt = a.p_amount_cents;
        if (amt === null || amt === undefined || amt <= o!.amount_cents || amt >= o!.list_price_cents) {
          fail("validation", `La contraoferta debe estar entre ${money(o!.amount_cents + 1)} y ${money(o!.list_price_cents - 1)}.`);
        }
        Object.assign(o!, { status: "countered", awaiting: "buyer", amount_cents: amt, expires_at: this.iso(s.offer_response_minutes * 60000), updated_at: this.iso() });
        this.offerEvent(o!.id, uid, "seller", "counter", amt);
        this.notify(o!.buyer_id, "offer_countered", `Contraoferta recibida: ${money(amt)}`, "Acéptala o recházala antes de que venza.", "/ofertas");
        return this.offerJson(o!, uid);
      }
      if (action !== "accept") fail("invalid_action", "Acción no válida.");
      const v = this.variant(o!.variant_id)!;
      const p = this.product(o!.product_id)!;
      if (!(v.is_active && this.isPublic(p)) || this.avail(v) < o!.quantity) {
        Object.assign(o!, { status: "cancelled", awaiting: "none", updated_at: this.iso() });
        this.offerEvent(o!.id, uid, role, "conflict", null, "El artículo ya no tiene unidades disponibles; la oferta se canceló sin cargos.");
        this.notify(o!.buyer_id, "offer_conflict", "Oferta cancelada por falta de stock", `"${p.title}" se agotó antes de completar la operación. No se realizó ningún cargo.`, "/ofertas");
        this.notify(o!.seller_id, "offer_conflict", "Oferta cancelada por falta de stock", `"${p.title}" no tenía unidades disponibles al aceptar.`, "/ofertas");
        return { ...this.offerJson(o!, uid), conflict: true };
      }
      const addr = db().addresses.filter((x) => x.user_id === o!.buyer_id).sort((x, y) => Number(y.is_default) - Number(x.is_default) || x.created_at.localeCompare(y.created_at))[0];
      const due = this.iso(s.offer_payment_minutes * 60000);
      const subtotal = o!.amount_cents * o!.quantity;
      const order: OrderRow = { id: uuid(), number: ++db().seq.order, buyer_id: o!.buyer_id, source: "offer", offer_id: o!.id, status: "pending_payment",
        is_test: s.test_mode, currency: "USD", subtotal_cents: subtotal, shipping_cents: s.shipping_flat_cents, tax_cents: 0,
        total_cents: subtotal + s.shipping_flat_cents, shipping_address: addr ? this.addressSnapshot(addr) : {}, payment_due_at: due,
        paid_at: null, cancelled_at: null, created_at: this.iso(), updated_at: this.iso() };
      db().orders.push(order);
      const commission = Math.round(subtotal * s.commission_bps / 10000);
      const so: SellerOrderRow = { id: uuid(), order_id: order.id, seller_id: o!.seller_id, store_id: p.store_id, status: "pending_payment", subtotal_cents: subtotal,
        shipping_cents: s.shipping_flat_cents, commission_bps: s.commission_bps, commission_cents: commission, seller_net_cents: subtotal - commission,
        payout_status: "not_applicable", carrier: null, tracking_number: null, shipped_at: null, delivered_at: null, created_at: this.iso(), updated_at: this.iso() };
      db().seller_orders.push(so);
      db().order_items.push({ id: uuid(), order_id: order.id, seller_order_id: so.id, product_id: p.id, variant_id: v.id, title: p.title, size: v.size, color: v.color,
        image_url: this.firstImage(p.id), unit_price_cents: o!.amount_cents, quantity: o!.quantity, line_total_cents: subtotal });
      this.reserve(v.id, o!.quantity, order.id, o!.buyer_id, due);
      Object.assign(o!, { status: "accepted", awaiting: "buyer", order_id: order.id, expires_at: due, updated_at: this.iso() });
      this.offerEvent(o!.id, uid, role, "accept", o!.amount_cents, "Compra pendiente de pago por el importe acordado.");
      this.notify(o!.buyer_id, "offer_accepted", `Oferta aceptada: ${money(o!.amount_cents)}`, `Completa el pago antes de ${new Date(due).toLocaleString("es")} para asegurar el artículo.`, `/pedido/${order.id}`);
      if (role === "buyer") this.notify(o!.seller_id, "offer_accepted", "El comprador aceptó tu contraoferta", "La unidad queda reservada hasta que se complete el pago.", "/ofertas");
      return this.offerJson(o!, uid);
    };

    H.my_offers = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      return db().offers.filter((o) => (a.p_role === "seller" ? o.seller_id === uid : o.buyer_id === uid)).sort(byDesc((o) => o.updated_at)).map((o) => this.offerJson(o, uid));
    };

    // ---- negocios y campañas
    H.save_business = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const p = a.p ?? {};
      const slug = lower(String(p.slug ?? "").trim());
      this.validateSlug(slug, "La dirección del negocio debe tener 3–40 caracteres: minúsculas, números y guiones.");
      if (db().businesses.some((b) => lower(b.slug) === slug && b.id !== p.id)) fail("slug_taken", "Esa dirección ya está en uso.", { field: "slug" });
      if (p.store_id && !db().stores.some((s) => s.id === p.store_id && s.owner_id === uid)) fail("forbidden", "Solo puedes vincular tus propias tiendas.", { field: "store_id" });
      if (!p.id && db().businesses.filter((b) => b.owner_id === uid).length >= 5) fail("limit_reached", "Puedes registrar hasta 5 negocios por cuenta.");
      const name = String(p.name ?? "").trim();
      const category = p.category || "otro";
      if (name.length < 2 || name.length > 80 || String(p.description ?? "").length > 2000 || !["moda", "sneakers", "belleza", "accesorios", "reventa", "servicios", "otro"].includes(category)) {
        fail("validation", "Revisa los datos del negocio: nombre (2–80 caracteres), categoría y descripción (máx. 2.000).");
      }
      const fields = { store_id: p.store_id || null, slug, name, logo_url: p.logo_url || null, cover_url: p.cover_url || null, description: String(p.description ?? ""),
        category, location: trimOrNull(p.location) as string | null, contact: p.contact ?? {}, hours: p.hours ?? {}, social_links: p.social_links ?? {},
        customer_info: trimOrNull(p.customer_info) as string | null, updated_at: this.iso() };
      if (!p.id) {
        const b: BusinessRow = { id: uuid(), owner_id: uid, ...fields, status: "active", is_demo: false, created_at: this.iso() };
        db().businesses.push(b);
        return b;
      }
      const b = db().businesses.find((x) => x.id === p.id && x.owner_id === uid);
      if (!b) fail("forbidden", "No puedes modificar negocios de otros usuarios.");
      Object.assign(b!, fields);
      return b;
    };

    H.save_campaign = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const s = this.settings();
      const p = a.p ?? {};
      let old: CampaignRow | null = null;
      if (p.id) {
        old = db().campaigns.find((c) => c.id === p.id) ?? null;
        if (!old || old.owner_id !== uid) fail("not_found", "La campaña no existe.");
        if (!["draft", "rejected"].includes(old!.status)) fail("not_editable", "Solo puedes editar campañas en borrador o rechazadas.");
      }
      const kind = p.kind;
      if (!["home_store", "promoted_product", "category_spotlight", "temporary_promo", "featured_offer"].includes(kind)) fail("validation", "Selecciona el tipo de promoción.", { field: "kind" });
      const business = p.business_id || null, store = p.store_id || null, product = p.product_id || null;
      if (business && !db().businesses.some((b) => b.id === business && b.owner_id === uid)) fail("forbidden", "Solo puedes promocionar tus propios negocios.", { field: "business_id" });
      if (store && !db().stores.some((x) => x.id === store && x.owner_id === uid)) fail("forbidden", "Solo puedes promocionar tus propias tiendas.", { field: "store_id" });
      if (product && !db().products.some((x) => x.id === product && x.seller_id === uid && x.status !== "removed")) fail("forbidden", "Solo puedes promocionar tus propios productos.", { field: "product_id" });
      if (["promoted_product", "featured_offer", "category_spotlight"].includes(kind) && !product) fail("validation", "Elige el producto que quieres promocionar.", { field: "product_id" });
      let category = p.category_id || null;
      if (kind === "category_spotlight") category = category ?? this.product(product)!.category_id;
      if (["home_store", "temporary_promo"].includes(kind) && !business && !store) fail("validation", "Elige el negocio o la tienda que quieres promocionar.", { field: "business_id" });
      const budget = Math.round(Number(p.budget_cents));
      if (!Number.isFinite(budget) || budget < s.min_campaign_cents || budget > 100000000) fail("validation", `El presupuesto mínimo es ${money(s.min_campaign_cents)}.`, { field: "budget_cents" });
      const days = Number(p.duration_days);
      if (!Number.isInteger(days) || days < 1 || days > 90) fail("validation", "La duración debe estar entre 1 y 90 días.", { field: "duration_days" });
      const headline = String(p.headline ?? "").trim();
      if (headline.length < 3 || headline.length > 80) fail("validation", "El titular debe tener entre 3 y 80 caracteres.", { field: "headline" });
      if (String(p.body ?? "").length > 300) fail("validation", "El texto admite hasta 300 caracteres.", { field: "body" });
      const fields = { business_id: business, store_id: store, product_id: product, kind, category_id: category, headline, body: trimOrNull(p.body) as string | null,
        budget_cents: budget, duration_days: days, updated_at: this.iso() };
      let row: CampaignRow;
      if (!old) {
        row = { id: uuid(), owner_id: uid, ...fields, starts_at: null, ends_at: null, status: "draft", is_test: false, is_demo: false, review_note: null,
          reviewed_by: null, reviewed_at: null, created_at: this.iso() };
        db().campaigns.push(row);
      } else { Object.assign(old, fields, { status: "draft", review_note: null }); row = old; }
      return this.campaignJson(row, uid);
    };

    H.submit_campaign = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const c = db().campaigns.find((x) => x.id === a.p_id && x.owner_id === uid && x.status === "draft");
      if (!c) fail("invalid_transition", "Solo puedes enviar a revisión campañas en borrador.");
      c!.status = "pending_review"; c!.updated_at = this.iso();
      for (const adm of db().profiles.filter((x) => x.role === "admin" && x.status === "active")) this.notify(adm.id, "campaign_review", "Campaña pendiente de revisión", c!.headline, "/admin");
      return this.campaignJson(c!, uid);
    };

    H.pay_campaign_test = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const c = db().campaigns.find((x) => x.id === a.p_id);
      if (!c || c.owner_id !== uid) fail("not_found", "La campaña no existe.");
      if (c!.status !== "pending_payment") fail("invalid_transition", "La campaña debe estar aprobada y pendiente de pago.");
      if (!this.settings().test_mode) fail("test_mode_disabled", "Los pagos de prueba están desactivados; el pago real requiere el proveedor de pagos.");
      db().payments.push({ id: uuid(), order_id: null, campaign_id: c!.id, payer_id: uid, provider: "test", provider_ref: "test_" + uuid().replace(/-/g, ""),
        amount_cents: c!.budget_cents, currency: "USD", status: "succeeded", is_test: true, created_at: this.iso() });
      Object.assign(c!, { status: "active", is_test: true, starts_at: this.iso(), ends_at: this.iso(c!.duration_days * 864e5), updated_at: this.iso() });
      return this.campaignJson(c!, uid);
    };

    H.set_campaign_paused = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const from = a.p_paused ? "active" : "paused";
      const c = db().campaigns.find((x) => x.id === a.p_id && x.owner_id === uid && x.status === from && this.t(x.ends_at) > this.now().getTime());
      if (!c) fail("invalid_transition", "No se puede cambiar el estado de esta campaña.");
      c!.status = a.p_paused ? "paused" : "active"; c!.updated_at = this.iso();
      return this.campaignJson(c!, uid);
    };

    H.delete_campaign = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const i = db().campaigns.findIndex((x) => x.id === a.p_id && x.owner_id === uid && ["draft", "rejected"].includes(x.status));
      if (i < 0) fail("invalid_transition", "Solo puedes eliminar campañas en borrador o rechazadas.");
      db().campaigns.splice(i, 1);
      return null;
    };

    H.my_campaigns = (_a, uidIn) => {
      const uid = this.requireUser(uidIn);
      return db().campaigns.filter((c) => c.owner_id === uid).sort(byDesc((c) => c.created_at)).map((c) => this.campaignJson(c, uid));
    };

    H.campaign_stats = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const c = db().campaigns.find((x) => x.id === a.p_id);
      if (!c || (c.owner_id !== uid && !this.isAdmin(uid))) fail("not_found", "La campaña no existe.");
      const ev = db().analytics.filter((e) => e.campaign_id === c!.id);
      const imp = ev.filter((e) => e.kind === "impression").length, clk = ev.filter((e) => e.kind === "click").length;
      const days = new Map<string, { impressions: number; clicks: number }>();
      for (const e of ev) {
        const d = e.created_at.slice(0, 10);
        const row = days.get(d) ?? { impressions: 0, clicks: 0 };
        if (e.kind === "impression") row.impressions++;
        if (e.kind === "click") row.clicks++;
        days.set(d, row);
      }
      return {
        campaign: this.campaignJson(c!, uid), impressions: imp, clicks: clk, ctr: imp ? Math.round((clk * 10000) / imp) / 100 : null,
        product_views: ev.filter((e) => ["product_view", "store_view", "business_view"].includes(e.kind)).length,
        new_followers: c!.store_id && c!.starts_at ? db().follows.filter((f) => f.store_id === c!.store_id && f.created_at >= c!.starts_at!).length : 0,
        attributed_sales: null,
        attribution_note: "Las ventas atribuidas se mostrarán cuando exista un sistema de atribución fiable. Las impresiones no equivalen a ventas.",
        daily: [...days.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([day, v]) => ({ day, ...v })),
      };
    };

    // ---- confianza
    H.create_review = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      const so = db().seller_orders.find((x) => x.id === a.p_seller_order_id);
      if (!so) fail("not_found", "El pedido no existe.");
      const o = db().orders.find((x) => x.id === so!.order_id)!;
      if (o.buyer_id !== uid) fail("forbidden", "Solo quien compró puede calificar este pedido.");
      if (so!.status !== "delivered") fail("not_delivered", "Podrás calificar la compra cuando se haya entregado.");
      const rating = a.p_rating;
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail("validation", "La calificación debe estar entre 1 y 5.");
      if (String(a.p_body ?? "").length > 1000) fail("validation", "La reseña admite hasta 1.000 caracteres.");
      if (db().reviews.some((r) => r.seller_order_id === so!.id)) fail("already_reviewed", "Ya calificaste esta compra.");
      const row = { id: uuid(), seller_order_id: so!.id, reviewer_id: uid, seller_id: so!.seller_id, store_id: so!.store_id, rating,
        body: trimOrNull(a.p_body) as string | null, status: "visible", is_test: o.is_test, created_at: this.iso() };
      db().reviews.push(row);
      this.notify(so!.seller_id, "review", `Nueva reseña: ${rating}/5`, String(a.p_body ?? "").slice(0, 120), "/panel");
      return row;
    };

    H.create_report = (a, uidIn) => {
      const uid = this.requireUser(uidIn);
      if (!["product", "store", "business", "user", "review", "campaign"].includes(a.p_target_type)) fail("validation", "Tipo de reporte no válido.");
      if (!["prohibited", "counterfeit", "scam", "offensive", "spam", "other"].includes(a.p_reason)) fail("validation", "Selecciona un motivo.");
      if (String(a.p_details ?? "").length > 1000) fail("validation", "Los detalles admiten hasta 1.000 caracteres.");
      if (db().reports.some((r) => r.reporter_id === uid && r.target_type === a.p_target_type && r.target_id === a.p_target_id && ["open", "reviewing"].includes(r.status))) {
        fail("already_reported", "Ya enviaste un reporte sobre esto. Lo estamos revisando.");
      }
      const today = db().reports.filter((r) => r.reporter_id === uid && this.t(r.created_at) > this.now().getTime() - 864e5).length;
      if (today >= 10) fail("rate_limited", "Has hecho demasiadas solicitudes seguidas. Espera unos minutos e inténtalo de nuevo.");
      const row = { id: uuid(), reporter_id: uid, target_type: a.p_target_type, target_id: a.p_target_id, reason: a.p_reason, details: trimOrNull(a.p_details) as string | null,
        status: "open", resolution_note: null, resolved_by: null, created_at: this.iso(), resolved_at: null };
      db().reports.push(row);
      return { id: row.id, status: row.status };
    };

    // ---- administración
    H.admin_overview = (_a, uidIn) => {
      this.requireAdmin(uidIn);
      const countBy = <T>(rows: T[], k: (r: T) => string) => { const m: Record<string, number> = {}; rows.forEach((r) => (m[k(r)] = (m[k(r)] ?? 0) + 1)); return Object.keys(m).length ? m : null; };
      const live = ["paid", "preparing", "shipped", "delivered"];
      const comm = (test: boolean) => db().seller_orders.filter((so) => live.includes(so.status) && db().orders.find((o) => o.id === so.order_id)?.is_test === test).reduce((n, so) => n + so.commission_cents, 0);
      const gmv = (test: boolean) => db().orders.filter((o) => o.is_test === test && ["paid", "partially_refunded"].includes(o.status)).reduce((n, o) => n + o.subtotal_cents, 0);
      return {
        users: db().profiles.length, suspended_users: db().profiles.filter((p) => p.status === "suspended").length,
        sellers: new Set(db().products.filter((p) => p.status !== "removed").map((p) => p.seller_id)).size,
        stores: db().stores.length, businesses: db().businesses.length, products: countBy(db().products, (p) => p.status),
        blocked_products: db().products.filter((p) => p.moderation_status === "blocked").length,
        orders_real: countBy(db().orders.filter((o) => !o.is_test), (o) => o.status), orders_test: countBy(db().orders.filter((o) => o.is_test), (o) => o.status),
        gmv_real_cents: gmv(false), gmv_test_cents: gmv(true), commission_real_cents: comm(false), commission_test_cents: comm(true),
        open_offers: db().offers.filter((o) => ["pending", "countered", "accepted"].includes(o.status)).length,
        open_reports: db().reports.filter((r) => ["open", "reviewing"].includes(r.status)).length,
        campaigns_pending_review: db().campaigns.filter((c) => c.status === "pending_review").length,
        campaigns_active: db().campaigns.filter((c) => c.status === "active").length,
        refunds_pending: db().refunds.filter((r) => r.status === "pending").length,
        settings: { id: 1, ...this.settings() },
      };
    };

    H.admin_list = (a, uidIn) => {
      this.requireAdmin(uidIn);
      const p = a.p ?? {};
      const q = lower(String(p.q ?? "").trim());
      const st = p.status || null;
      const limit = Math.min(Math.max(Number(p.limit ?? 50), 1), 200), offset = Math.max(Number(p.offset ?? 0), 0);
      const page = <T>(rows: T[]) => rows.slice(offset, offset + limit);
      let items: unknown[];
      switch (a.p_entity) {
        case "users":
          items = page(db().profiles.filter((x) => (!q || lower(x.username + " " + x.display_name).includes(q)) && (!st || x.status === st)).sort(byDesc((x) => x.created_at)))
            .map((x) => ({ id: x.id, username: x.username, display_name: x.display_name, role: x.role, status: x.status, created_at: x.created_at,
              email: db().credentials.find((c) => c.user_id === x.id)?.email ?? null, products: db().products.filter((pp) => pp.seller_id === x.id && pp.status !== "removed").length }));
          break;
        case "stores":
          items = page(db().stores.filter((x) => (!q || lower(x.name + " " + x.slug).includes(q)) && (!st || x.status === st)).sort(byDesc((x) => x.created_at)))
            .map((x) => ({ ...this.storeCard(x), status: x.status, created_at: x.created_at }));
          break;
        case "businesses":
          items = page(db().businesses.filter((x) => (!q || lower(x.name + " " + x.slug).includes(q)) && (!st || x.status === st)).sort(byDesc((x) => x.created_at)));
          break;
        case "products":
          items = page(db().products.filter((x) => (!q || x.search_text.includes(q)) && (!st || x.status === st || (st === "blocked" && x.moderation_status === "blocked"))).sort(byDesc((x) => x.created_at)))
            .map((x) => ({ ...this.card(x, uidIn), moderation_status: x.moderation_status, moderation_note: x.moderation_note }));
          break;
        case "orders":
          items = page(db().orders.filter((o) => (!st || o.status === st) && (!q || String(o.number).startsWith(q))).sort(byDesc((o) => o.created_at))).map((o) => ({
            id: o.id, number: o.number, status: o.status, is_test: o.is_test, total_cents: o.total_cents, source: o.source, created_at: o.created_at,
            buyer: this.profile(o.buyer_id)?.username, sellers: db().seller_orders.filter((so) => so.order_id === o.id)
              .map((so) => ({ username: this.profile(so.seller_id)?.username, status: so.status, commission_cents: so.commission_cents })) }));
          break;
        case "offers":
          items = page(db().offers.filter((o) => !st || o.status === st).sort(byDesc((o) => o.updated_at))).map((o) => this.offerJson(o, uidIn));
          break;
        case "campaigns":
          items = page(db().campaigns.filter((c) => !st || c.status === st)
            .sort((x, y) => Number(y.status === "pending_review") - Number(x.status === "pending_review") || y.created_at.localeCompare(x.created_at)))
            .map((c) => ({ ...this.campaignJson(c, uidIn), owner: this.profile(c.owner_id)?.username }));
          break;
        case "reports":
          items = page(db().reports.filter((r) => !st || r.status === st)
            .sort((x, y) => Number(["open", "reviewing"].includes(y.status)) - Number(["open", "reviewing"].includes(x.status)) || y.created_at.localeCompare(x.created_at)))
            .map((r) => ({ ...r, reporter: this.profile(r.reporter_id)?.username }));
          break;
        case "payments":
          items = page(db().payments.filter((x) => !st || x.status === st).sort(byDesc((x) => x.created_at)))
            .map((x) => ({ ...x, order_number: db().orders.find((o) => o.id === x.order_id)?.number ?? null }));
          break;
        case "audit":
          items = page([...db().audit].sort((x, y) => y.id - x.id)).map((x) => ({ ...x, actor: this.profile(x.actor_id)?.username }));
          break;
        default:
          fail("validation", "Entidad no válida.");
          items = [];
      }
      return { items };
    };

    H.admin_update_settings = (a, uidIn) => {
      const uid = this.requireAdmin(uidIn);
      const p = a.p ?? {};
      const s = this.settings();
      if ("test_mode" in p && !p.test_mode && !s.real_payments_ready) fail("payments_not_ready", "No puedes desactivar el modo de prueba hasta integrar y verificar el proveedor de pagos.");
      const ranges: Record<string, [number, number]> = { commission_bps: [0, 5000], shipping_flat_cents: [0, 100000], checkout_hold_minutes: [1, 1440],
        offer_response_minutes: [5, 20160], offer_payment_minutes: [1, 10080], min_offer_percent: [1, 99], min_campaign_cents: [100, 10000000] };
      const next = { ...s };
      for (const [k, [lo, hi]] of Object.entries(ranges)) {
        if (k in p && p[k] !== null && p[k] !== undefined) {
          const v = Number(p[k]);
          if (!Number.isInteger(v) || v < lo || v > hi) fail("validation", "Algún valor está fuera del rango permitido.");
          (next as any)[k] = v;
        }
      }
      if ("test_mode" in p) next.test_mode = !!p.test_mode;
      next.updated_at = this.iso(); next.updated_by = uid;
      db().settings = next;
      this.audit(uid, "update_settings", "platform_settings", "1", p);
      return { id: 1, ...next };
    };

    H.admin_moderate = (a, uidIn) => {
      const uid = this.requireAdmin(uidIn);
      const { p_entity: ent, p_id: id, p_action: act } = a;
      const note = trimOrNull(a.p_note) as string | null;
      let target: string | null = null;
      if (ent === "product" && (act === "block" || act === "unblock")) {
        const p = this.product(id);
        if (p) { p.moderation_status = act === "block" ? "blocked" : "ok"; p.moderation_note = note; target = p.seller_id;
          this.notify(p.seller_id, "moderation", act === "block" ? "Una publicación fue bloqueada" : "Una publicación fue desbloqueada", note, "/panel/catalogo"); }
      } else if ((ent === "store" || ent === "business") && (act === "suspend" || act === "activate")) {
        const row = ent === "store" ? this.store(id) : db().businesses.find((b) => b.id === id);
        if (row) { row.status = act === "suspend" ? "suspended" : "active"; target = row.owner_id; }
      } else if (ent === "user" && (act === "suspend" || act === "activate")) {
        if (id === uid) fail("validation", "No puedes suspender tu propia cuenta.");
        const pr = this.profile(id);
        if (pr) { pr.status = act === "suspend" ? "suspended" : "active"; target = pr.id; }
      } else if (ent === "user" && (act === "make_admin" || act === "remove_admin")) {
        if (id === uid) fail("validation", "No puedes cambiar tu propio rol.");
        const pr = this.profile(id);
        if (pr) { pr.role = act === "make_admin" ? "admin" : "user"; target = pr.id; }
      } else if (ent === "review" && (act === "hide" || act === "show")) {
        const r = db().reviews.find((x) => x.id === id);
        if (r) { r.status = act === "hide" ? "hidden" : "visible"; target = r.reviewer_id; }
      } else if (ent === "report" && ["reviewing", "resolved", "dismissed"].includes(act)) {
        const r = db().reports.find((x) => x.id === id);
        if (r) { Object.assign(r, { status: act, resolution_note: note, resolved_by: act !== "reviewing" ? uid : null, resolved_at: act !== "reviewing" ? this.iso() : null }); target = r.reporter_id; }
      } else if (ent === "campaign" && (act === "approve" || act === "reject")) {
        const c = db().campaigns.find((x) => x.id === id && x.status === "pending_review");
        if (!c) fail("invalid_transition", "La campaña no está pendiente de revisión.");
        Object.assign(c!, { status: act === "approve" ? "pending_payment" : "rejected", review_note: note, reviewed_by: uid, reviewed_at: this.iso() });
        target = c!.owner_id;
        this.notify(c!.owner_id, `campaign_${act}`, act === "approve" ? "Campaña aprobada: pendiente de pago" : "Campaña rechazada", note, "/promociona/campanas");
      } else if (ent === "campaign" && (act === "pause" || act === "finish")) {
        const c = db().campaigns.find((x) => x.id === id && ["active", "paused"].includes(x.status));
        if (c) { c.status = act === "pause" ? "paused" : "finished"; c.review_note = note ?? c.review_note; target = c.owner_id; }
      } else fail("validation", "Acción de moderación no válida.");
      if (!target) fail("not_found", "El elemento no existe.");
      this.audit(uid, `moderate_${ent}_${act}`, ent, id, { note });
      return { ok: true };
    };

    return H;
  }
}
