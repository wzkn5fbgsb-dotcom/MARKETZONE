// Escenarios obligatorios (sección 24) + reglas críticas de negocio y seguridad.
// Se ejecutan contra cualquier backend que cumpla el contrato (Supabase local y motor demo).
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { addressFor, expectApiError, hoodieListing, uploadTestImage, type Harness, type TestUser } from "./harness";

export function defineContract(makeHarness: () => Promise<Harness>) {
  let h: Harness;
  let seller: TestUser;
  let buyer: TestUser;
  let buyer2: TestUser;
  let intruder: TestUser;
  let admin: TestUser;
  let images: { url: string; storage_path?: string | null }[];

  beforeAll(async () => {
    h = await makeHarness();
    seller = await h.newUser("seller");
    buyer = await h.newUser("buyer");
    buyer2 = await h.newUser("buyer2");
    intruder = await h.newUser("intruder");
    admin = await h.newUser("admin");
    await h.makeAdmin(admin.userId);
    const up = await uploadTestImage(seller);
    images = [{ url: up.url, storage_path: up.path }];
  });
  afterAll(async () => { await h?.close?.(); });

  const variantBySize = (detail: any, size: string) => detail.variants.find((v: any) => v.size === size);

  describe("Publicación", () => {
    test("un vendedor crea un producto con fotografías y lo publica", async () => {
      const res = await seller.api.saveListing(hoodieListing(images));
      expect(res.status).toBe("active");
      const detail = await buyer.api.product(res.id);
      expect(detail.product.title).toBe("Sudadera Adidas negra");
      expect(detail.images.length).toBe(1);
      expect(detail.is_visible).toBe(true);
      const found = await buyer.api.search({ q: "adidas negra" });
      expect(found.items.some((c) => c.id === res.id)).toBe(true);
    });

    test("los borradores no son visibles para otros usuarios", async () => {
      const draft = await seller.api.saveListing({ ...hoodieListing([]), title: "Borrador privado", status: "draft" });
      expect(draft.status).toBe("draft");
      await expectApiError(buyer.api.product(draft.id), "not_found");
      const own = await seller.api.product(draft.id);
      expect(own.is_owner).toBe(true);
    });

    test("publicar exige foto, talla y marca según la categoría", async () => {
      await expectApiError(seller.api.saveListing({ ...hoodieListing([]) }), "validation");
      await expectApiError(seller.api.saveListing({ ...hoodieListing(images), category_id: "sneakers-running", brand: "" }), "validation");
      const e = await expectApiError(
        seller.api.saveListing({ ...hoodieListing(images), variants: [{ size: null, color: null, stock_on_hand: 1 }] }), "validation");
      expect(String(e.message)).toContain("talla");
    });

    test("artículo único de segunda mano con defectos declarados", async () => {
      await expectApiError(seller.api.saveListing({ ...hoodieListing(images, { M: 1 }), condition: "used_flawed", flaws: "" }), "validation");
      const ok = await seller.api.saveListing({ ...hoodieListing(images, { M: 1 }), title: "Chaqueta vintage única", condition: "used_flawed", flaws: "Mancha pequeña en la manga izquierda" });
      const d = await buyer.api.product(ok.id);
      expect(d.product.flaws).toContain("Mancha");
      expect(d.variants.length).toBe(1);
    });
  });

  describe("Inventario por variante", () => {
    let productId: string;
    test("sudadera con S/M/L: el comprador ve la disponibilidad correcta de M", async () => {
      productId = (await seller.api.saveListing(hoodieListing(images, { S: 2, M: 3, L: 1, XL: 0 }))).id;
      const d = await buyer.api.product(productId);
      expect(variantBySize(d, "M").available).toBe(3);
      expect(variantBySize(d, "S").available).toBe(2);
      expect(variantBySize(d, "XL").available).toBe(0);
      expect(variantBySize(d, "M").stock_on_hand ?? null).toBeNull(); // el comprador no ve existencias internas
    });

    test("una compra confirmada descuenta la cantidad y registra el movimiento", async () => {
      const d = await buyer.api.product(productId);
      const m = variantBySize(d, "M");
      await buyer.api.cartAdd(m.id, 1);
      const addr = await addressFor(buyer);
      const co = await buyer.api.checkout(addr.id);
      const reserved = await buyer.api.product(productId);
      expect(variantBySize(reserved, "M").available).toBe(2); // reservado durante el checkout
      const paid = await buyer.api.payTest(co.order_id);
      expect(paid.status).toBe("paid");
      const after = await seller.api.product(productId);
      expect(variantBySize(after, "M").stock_on_hand).toBe(2);
      expect(variantBySize(after, "M").stock_reserved).toBe(0);
      const history = await seller.api.inventoryHistory(productId);
      expect(history.some((x) => x.kind === "sale" && x.on_hand_delta === -1 && x.size === "M")).toBe(true);
      expect(history.some((x) => x.kind === "reserve")).toBe(true);
    });

    test("no se puede comprar más de lo disponible ni bajar el stock por debajo de lo reservado", async () => {
      const d = await buyer2.api.product(productId);
      await expectApiError(buyer2.api.cartAdd(variantBySize(d, "L").id, 2), "insufficient_stock");
      await expectApiError(buyer2.api.cartAdd(variantBySize(d, "XL").id, 1), "insufficient_stock");
      // Reserva L con un checkout pendiente y prueba a dejar el stock en 0
      await buyer2.api.cartAdd(variantBySize(d, "L").id, 1);
      const addr = await addressFor(buyer2);
      const co = await buyer2.api.checkout(addr.id);
      await expectApiError(seller.api.quickStock(variantBySize(d, "L").id, 0), "stock_below_reserved");
      await buyer2.api.cancelOrder(co.order_id);
      const back = await buyer2.api.product(productId);
      expect(variantBySize(back, "L").available).toBe(1);
    });

    test("edición rápida de cantidades y precios con historial y descuento real", async () => {
      const d = await seller.api.product(productId);
      const s = variantBySize(d, "S");
      const q = await seller.api.quickStock(s.id, 5);
      expect(q.available).toBe(5);
      const p = await seller.api.quickPrice(productId, 3000);
      expect(p.compare_at_cents).toBe(3500); // precio anterior real
      const up = await seller.api.quickPrice(productId, 4000);
      expect(up.compare_at_cents).toBeNull(); // subir el precio elimina el "descuento"
      const cat = await seller.api.catalog({ q: "adidas" });
      expect(cat.items.find((i) => i.id === productId)?.variants.length).toBe(4);
    });
  });

  describe("Prevención de sobreventa", () => {
    test("dos compradores intentan comprar la última unidad: solo uno lo consigue", async () => {
      const id = (await seller.api.saveListing({ ...hoodieListing(images, { M: 1 }), title: "Última unidad test" })).id;
      const v = (await buyer.api.product(id)).variants[0];
      await buyer.api.cartAdd(v.id, 1);
      await buyer2.api.cartAdd(v.id, 1);
      const a1 = await addressFor(buyer);
      const a2 = await addressFor(buyer2);
      const results = await Promise.allSettled([buyer.api.checkout(a1.id), buyer2.api.checkout(a2.id)]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(ok.length).toBe(1);
      expect(failed.length).toBe(1);
      expect(failed[0].reason.code).toBe("cart_conflict");
      const after = await seller.api.product(id);
      expect(after.variants[0].stock_reserved).toBe(1);
      expect(after.variants[0].available).toBe(0);
      // Limpia el carrito del perdedor
      const loser = failed[0] === results[0] ? buyer : buyer2;
      for (const l of (await loser.api.cart()).lines) await loser.api.cartRemove(l.id);
    });

    test("el servidor ignora precios enviados por el navegador", async () => {
      const id = (await seller.api.saveListing({ ...hoodieListing(images, { S: 3 }), title: "Precio servidor" })).id;
      const v = (await buyer.api.product(id)).variants[0];
      const cart = await buyer.api.cartAdd(v.id, 1);
      const line = cart.lines.find((l) => l.variant_id === v.id)!;
      expect(line.unit_price_cents).toBe(3500);
      const addr = await addressFor(buyer);
      const co = await buyer.api.checkout(addr.id);
      expect(co.total_cents).toBe(3500 + 799);
      const order = await buyer.api.order(co.order_id);
      expect(order.subtotal_cents).toBe(3500);
      await buyer.api.cancelOrder(co.order_id);
    });
  });

  describe("Ofertas y contraofertas", () => {
    let productId: string;
    let variantId: string;
    beforeAll(async () => {
      productId = (await seller.api.saveListing({ ...hoodieListing(images, { M: 1 }), title: "Chaqueta oferta", price_cents: 5000 })).id;
      variantId = (await buyer.api.product(productId)).variants[0].id;
    });

    test("ofertas fuera de rango se rechazan", async () => {
      await expectApiError(buyer.api.makeOffer(variantId, 5000), "offer_too_high");
      await expectApiError(buyer.api.makeOffer(variantId, 1000), "offer_too_low");
      await expectApiError(seller.api.makeOffer(variantId, 4000), "own_item");
    });

    test("sin dirección de envío no se puede ofertar (la oferta se paga al enviarla)", async () => {
      const fresh = await h.newUser("sinDireccion");
      await expectApiError(fresh.api.makeOffer(variantId, 4000), "address_required");
    });

    test("comprador ofrece $40 y paga al ofertar; el vendedor acepta y el trato queda hecho", async () => {
      await addressFor(buyer);
      const offer = await buyer.api.makeOffer(variantId, 4000);
      expect(offer.status).toBe("pending");
      expect(offer.payment_status).toBe("held");
      expect(offer.held_cents).toBe(4000 + 799);
      await expectApiError(buyer.api.makeOffer(variantId, 4100), "offer_exists");
      await expectApiError(buyer.api.respondOffer(offer.id, "accept"), "not_your_turn");
      const accepted = await seller.api.respondOffer(offer.id, "accept");
      expect(accepted.status).toBe("completed");
      expect(accepted.payment_status).toBe("captured");
      expect(accepted.order?.status).toBe("paid");
      expect(accepted.order?.total_cents).toBe(4000 + 799);
      // La unidad ya está vendida: otro comprador no puede llevársela
      const after = await seller.api.product(productId);
      expect(after.variants[0].stock_on_hand).toBe(0);
      expect(after.variants[0].available).toBe(0);
      const order = await buyer.api.order(accepted.order!.id);
      expect(order.subtotal_cents).toBe(4000);
      expect(order.status).toBe("paid");
      // Comisión del 7 % sobre el importe acordado
      const sellerView = await seller.api.order(accepted.order!.id);
      expect(sellerView.seller_orders[0].commission_cents).toBe(280);
      expect(sellerView.seller_orders[0].seller_net_cents).toBe(3720);
    });

    test("si el vendedor rechaza, se libera el pago sin cargo", async () => {
      const id = (await seller.api.saveListing({ ...hoodieListing(images, { M: 1 }), title: "Rechazo libera", price_cents: 5000 })).id;
      const v = (await buyer.api.product(id)).variants[0];
      const offer = await buyer.api.makeOffer(v.id, 4000);
      const declined = await seller.api.respondOffer(offer.id, "decline");
      expect(declined.status).toBe("declined");
      expect(declined.payment_status).toBe("released");
      expect(declined.order).toBeNull();
      expect((await buyer2.api.product(id)).variants[0].available).toBe(1);
    });

    test("contraoferta: si el comprador la acepta, se cobra el importe contraofertado y queda cerrada", async () => {
      await addressFor(buyer2);
      const id = (await seller.api.saveListing({ ...hoodieListing(images, { L: 2 }), title: "Sneaker contraoferta", price_cents: 5000 })).id;
      const v = (await buyer2.api.product(id)).variants[0];
      const offer = await buyer2.api.makeOffer(v.id, 3500);
      await expectApiError(seller.api.respondOffer(offer.id, "counter", 3000), "validation");
      const countered = await seller.api.respondOffer(offer.id, "counter", 4500);
      expect(countered.status).toBe("countered");
      expect(countered.awaiting).toBe("buyer");
      expect(countered.payment_status).toBe("held");
      await expectApiError(seller.api.respondOffer(offer.id, "accept"), "not_your_turn");
      const accepted = await buyer2.api.respondOffer(offer.id, "accept");
      expect(accepted.status).toBe("completed");
      expect(accepted.order?.status).toBe("paid");
      expect(accepted.order?.total_cents).toBe(4500 + 799);
      expect(accepted.events.map((e) => e.kind)).toContain("accept");
    });

    test("conflicto de inventario al aceptar: la oferta se cancela y se libera el pago", async () => {
      const id = (await seller.api.saveListing({ ...hoodieListing(images, { S: 1 }), title: "Conflicto stock", price_cents: 5000 })).id;
      const v = (await buyer.api.product(id)).variants[0];
      const offer = await buyer.api.makeOffer(v.id, 4000);
      // Otro comprador paga el precio completo antes de que el vendedor responda
      await buyer2.api.cartAdd(v.id, 1);
      const co = await buyer2.api.checkout((await addressFor(buyer2)).id);
      await buyer2.api.payTest(co.order_id);
      const res = await seller.api.respondOffer(offer.id, "accept");
      expect(res.status).toBe("cancelled");
      expect(res.conflict).toBe(true);
      expect(res.payment_status).toBe("released");
      expect(res.order).toBeNull();
    });
  });

  describe("Expiración", () => {
    test("pagar después del plazo no confirma la compra (la reserva vence en el acto)", async () => {
      const id = (await seller.api.saveListing({ ...hoodieListing(images, { S: 1 }), title: "Expira checkout" })).id;
      const v = (await buyer.api.product(id)).variants[0];
      await buyer.api.cartAdd(v.id, 1);
      const co = await buyer.api.checkout((await addressFor(buyer)).id);
      await h.backdateOrder(co.order_id);
      // Dos resultados seguros posibles: la función vence el pedido y responde "expired", o la tarea
      // programada ya lo había vencido y el pago se rechaza con "order_not_payable".
      const outcome = await buyer.api.payTest(co.order_id).then((r) => r.status, (e) => e.code);
      expect(["expired", "order_not_payable"]).toContain(outcome);
      expect((await buyer.api.order(co.order_id)).status).toBe("expired");
      expect((await buyer2.api.product(id)).variants[0].available).toBe(1);
    });

    test("una oferta pagada sin respuesta vence y libera el pago", async () => {
      const id = (await seller.api.saveListing({ ...hoodieListing(images, { S: 1 }), title: "Oferta sin respuesta", price_cents: 5000 })).id;
      const v = (await buyer.api.product(id)).variants[0];
      const offer = await buyer.api.makeOffer(v.id, 4500);
      await h.backdateOffer(offer.id);
      await h.runExpiry();
      const o = (await seller.api.offers("seller")).find((x) => x.id === offer.id)!;
      expect(o.status).toBe("expired");
      expect(o.payment_status).toBe("released");
    });
  });

  describe("Pedidos, envío, reembolsos y reseñas", () => {
    test("flujo completo: pagado → enviado (sin inventar seguimiento) → entregado → reseña verificada", async () => {
      const id = (await seller.api.saveListing({ ...hoodieListing(images, { M: 2 }), title: "Pedido completo" })).id;
      const v = (await buyer.api.product(id)).variants[0];
      await buyer.api.cartAdd(v.id, 1);
      const co = await buyer.api.checkout((await addressFor(buyer)).id);
      const order0 = await buyer.api.order(co.order_id);
      await expectApiError(buyer.api.review(order0.seller_orders[0].id, 5), "not_delivered");
      await buyer.api.payTest(co.order_id);
      const so = (await seller.api.sellerOrders()).find((x) => x.order_id === co.order_id)!;
      expect(so.status).toBe("paid");
      expect(so.commission_cents).toBe(245); // 7 % de $35
      expect(so.seller_net_cents).toBe(3255);
      expect(so.shipping_address?.line1).toBe("123 Main St");
      const shipped = await seller.api.fulfill(so.id, "shipped", "USPS");
      expect(shipped.tracking_number).toBeNull();
      await expectApiError(intruder.api.fulfill(so.id, "delivered"), "not_found");
      // El vendedor no puede marcar su propio pedido como entregado (protección contra estafas)
      await expectApiError(seller.api.fulfill(so.id, "delivered"), "buyer_confirms_delivery");
      expect(shipped.auto_complete_at).not.toBeNull();
      await buyer.api.confirmDelivery(so.id);
      await buyer.api.review(so.id, 5, "Todo perfecto");
      await expectApiError(buyer.api.review(so.id, 4), "already_reviewed");
      const dash = await seller.api.dashboard();
      expect(dash.money_test.gross_cents).toBeGreaterThan(0);
      expect(dash.money_real.gross_cents).toBe(0); // nada de dinero real en modo de prueba
    });

    test("el comprador reporta un problema: se congela la confirmación automática y nadie es suspendido", async () => {
      const id = (await seller.api.saveListing({ ...hoodieListing(images, { M: 2 }), title: "Pedido con problema" })).id;
      const v = (await buyer.api.product(id)).variants[0];
      await buyer.api.cartAdd(v.id, 1);
      const co = await buyer.api.checkout((await addressFor(buyer)).id);
      await buyer.api.payTest(co.order_id);
      const so = (await seller.api.sellerOrders()).find((x) => x.order_id === co.order_id)!;
      await expectApiError(seller.api.fulfill(so.id, "shipped", "USPS", "123"), "validation");
      await seller.api.fulfill(so.id, "shipped", "USPS", "9400111899223");
      await expectApiError(buyer.api.reportProblem(so.id, "mal"), "validation");
      await expectApiError(intruder.api.reportProblem(so.id, "Nunca llegó el paquete a mi casa"), "not_found");
      const r = await buyer.api.reportProblem(so.id, "Nunca llegó el paquete a mi casa");
      expect(r.dispute_status).toBe("open");
      await expectApiError(buyer.api.reportProblem(so.id, "Nunca llegó el paquete a mi casa"), "already_reported");
      // Con disputa abierta, la confirmación automática no se aplica aunque pase el plazo
      await h.runExpiry();
      expect((await seller.api.order(co.order_id)).seller_orders[0].status).toBe("shipped");
      // El vendedor sigue activo: un reporte no suspende a nadie
      expect((await seller.api.account()).profile.id).toBe(seller.userId);
    });

    test("reembolso de prueba antes del envío con reposición de stock", async () => {
      const id = (await seller.api.saveListing({ ...hoodieListing(images, { L: 1 }), title: "Reembolso" })).id;
      const v = (await buyer.api.product(id)).variants[0];
      await buyer.api.cartAdd(v.id, 1);
      const co = await buyer.api.checkout((await addressFor(buyer)).id);
      await buyer.api.payTest(co.order_id);
      const so = (await seller.api.sellerOrders()).find((x) => x.order_id === co.order_id)!;
      const order = await seller.api.refund(so.id, "Sin stock real en almacén", true);
      expect(order.refunds.length).toBe(1);
      const after = await seller.api.product(id);
      expect(after.variants[0].stock_on_hand).toBe(1);
      expect((await buyer.api.order(co.order_id)).status).toBe("refunded");
    });
  });

  describe("Promociones", () => {
    test("una campaña no se activa sin pago confirmado", async () => {
      const biz = await seller.api.saveBusiness({ slug: `biz-${Date.now()}`, name: "Rack Test", category: "moda", description: "Negocio de prueba" });
      const pid = (await seller.api.saveListing({ ...hoodieListing(images, { M: 1 }), title: "Producto promocionado" })).id;
      const c = await seller.api.saveCampaign({ kind: "promoted_product", product_id: pid, business_id: biz.id, headline: "Nueva colección", budget_cents: 2500, duration_days: 7 });
      expect(c.status).toBe("draft");
      await expectApiError(seller.api.payCampaignTest(c.id), "invalid_transition");
      const submitted = await seller.api.submitCampaign(c.id);
      expect(submitted.status).toBe("pending_review");
      await expectApiError(seller.api.adminModerate("campaign", c.id, "approve"), "forbidden");
      await admin.api.adminModerate("campaign", c.id, "approve");
      const pending = (await seller.api.campaigns()).find((x) => x.id === c.id)!;
      expect(pending.status).toBe("pending_payment");
      expect((await buyer.api.home()).promoted.some((p) => p.id === pid)).toBe(false);
      await expectApiError(intruder.api.payCampaignTest(c.id), "not_found");
      const active = await seller.api.payCampaignTest(c.id);
      expect(active.status).toBe("active");
      expect(active.is_test).toBe(true);
      const home = await buyer.api.home();
      const card = home.promoted.find((p) => p.id === pid);
      expect(card?.sponsored).toBe(true);
      await buyer.api.track({ kind: "impression", campaign_id: c.id, session_id: "s1" });
      await buyer.api.track({ kind: "impression", campaign_id: c.id, session_id: "s1" }); // duplicada: no cuenta
      await buyer.api.track({ kind: "click", campaign_id: c.id, session_id: "s1" });
      const stats = await seller.api.campaignStats(c.id);
      expect(stats.impressions).toBe(1);
      expect(stats.clicks).toBe(1);
      expect(stats.attributed_sales).toBeNull();
    });

    test("no se puede promocionar lo que no es tuyo", async () => {
      const pid = (await seller.api.saveListing({ ...hoodieListing(images, { M: 1 }), title: "Ajeno" })).id;
      await expectApiError(intruder.api.saveCampaign({ kind: "promoted_product", product_id: pid, headline: "Robado", budget_cents: 2500, duration_days: 3 }), "forbidden");
    });
  });

  describe("Seguridad", () => {
    let productId: string;
    beforeAll(async () => { productId = (await seller.api.saveListing({ ...hoodieListing(images, { M: 2 }), title: "Protegido" })).id; });

    test("un usuario no puede modificar la publicación de otra persona", async () => {
      await expectApiError(intruder.api.saveListing({ ...hoodieListing(images), id: productId, title: "Hackeado" }), "forbidden");
      await expectApiError(intruder.api.setListingStatus([productId], "removed"), "forbidden");
      await expectApiError(intruder.api.quickPrice(productId, 100), "forbidden");
      const v = (await intruder.api.product(productId)).variants[0];
      await expectApiError(intruder.api.quickStock(v.id, 0), "forbidden");
      await expectApiError(intruder.api.bulkPrice([productId], -90), "forbidden");
      const still = await buyer.api.product(productId);
      expect(still.product.title).toBe("Protegido");
      expect(still.product.price_cents).toBe(3500);
    });

    test("acceso directo a tablas desde el navegador: rechazado", async () => {
      if (!h.rawTableWrite) return;
      const r1 = await h.rawTableWrite(intruder, "products", productId, { title: "Hack directo" });
      expect([401, 403]).toContain(r1.status);
      const r2 = await h.rawTableWrite(seller, "products", productId, { price_cents: 1 });
      expect([401, 403]).toContain(r2.status); // ni siquiera el dueño escribe directo: solo funciones validadas
      const r3 = await h.rawTableWrite(intruder, "profiles", intruder.userId, { role: "admin" });
      expect([401, 403]).toContain(r3.status);
    });

    test("datos privados y funciones de administración protegidos", async () => {
      await expectApiError(intruder.api.adminOverview(), "forbidden");
      await expectApiError(intruder.api.adminSettings({ commission_bps: 0 }), "forbidden");
      const v = (await buyer.api.product(productId)).variants[0];
      await buyer.api.cartAdd(v.id, 1);
      const co = await buyer.api.checkout((await addressFor(buyer)).id);
      await expectApiError(intruder.api.order(co.order_id), "not_found");
      await expectApiError(intruder.api.payTest(co.order_id), "not_found");
      await expectApiError(intruder.api.cancelOrder(co.order_id), "not_found");
      const sellerView = await seller.api.order(co.order_id);
      expect(sellerView.viewer_role).toBe("seller");
      await buyer.api.cancelOrder(co.order_id);
      const ov = await admin.api.adminOverview();
      expect(ov.users).toBeGreaterThanOrEqual(5);
    });

    test("no se puede comprar ni ofertar un producto propio", async () => {
      const v = (await seller.api.product(productId)).variants[0];
      await expectApiError(seller.api.cartAdd(v.id, 1), "own_item");
    });

    test("el modo de prueba no se puede desactivar sin pagos reales integrados", async () => {
      await expectApiError(admin.api.adminSettings({ test_mode: false }), "payments_not_ready");
      await admin.api.adminSettings({ commission_bps: 1200 });
      expect((await buyer.api.settings()).commission_bps).toBe(1200);
      await admin.api.adminSettings({ commission_bps: 700 });
    });

    test("moderación: un producto bloqueado deja de ser visible", async () => {
      await admin.api.adminModerate("product", productId, "block", "Prueba de moderación");
      await expectApiError(buyer.api.product(productId), "not_found");
      await expectApiError(seller.api.setListingStatus([productId], "active"), "listing_blocked");
      await admin.api.adminModerate("product", productId, "unblock");
      expect((await buyer.api.product(productId)).is_visible).toBe(true);
    });

    test("reportes con protección anti-spam", async () => {
      await intruder.api.report("product", productId, "counterfeit", "Parece falsificado");
      await expectApiError(intruder.api.report("product", productId, "counterfeit"), "already_reported");
    });
  });

  describe("Cuenta y bloqueos (requisitos de App Store y Google Play)", () => {
    const codeOf = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e: any) { return String(e.code); } };

    test("bloquear a un vendedor oculta sus productos e impide comprarle u ofertarle", async () => {
      const res = await seller.api.saveListing({ ...hoodieListing(images, { M: 2 }), title: "Gorra para bloqueo" });
      const v = (await buyer2.api.product(res.id)).variants[0];
      expect((await buyer2.api.toggleBlock(seller.userId)).blocked).toBe(true);
      expect((await buyer2.api.blocks()).some((b) => b.id === seller.userId)).toBe(true);
      expect((await buyer2.api.search({ q: "gorra para bloqueo" })).items.length).toBe(0);
      expect(["unavailable", "blocked", "not_found"]).toContain(await codeOf(buyer2.api.cartAdd(v.id, 1)));
      expect(["unavailable", "blocked", "not_found"]).toContain(await codeOf(buyer2.api.makeOffer(v.id, 2000)));
      // Los demás siguen viéndolo
      expect((await buyer.api.search({ q: "gorra para bloqueo" })).items.length).toBe(1);
      expect((await buyer2.api.toggleBlock(seller.userId)).blocked).toBe(false);
      expect((await buyer2.api.search({ q: "gorra para bloqueo" })).items.length).toBe(1);
      await expectApiError(buyer2.api.toggleBlock(buyer2.userId), "validation");
    });

    test("eliminar una cuenta sin historial la borra y corta el acceso", async () => {
      const leaver = await h.newUser("leaver");
      await expectApiError(leaver.api.deleteAccount("no"), "validation");
      const r = await leaver.api.deleteAccount("eliminar");
      expect(r.deleted).toBe(true);
      expect(r.kept_order_history).toBe(false);
      await expectApiError(leaver.api.account(), "account_deleted");
    });

    test("eliminar una cuenta con un pedido sin pagar lo cancela y libera el stock", async () => {
      const res = await seller.api.saveListing({ ...hoodieListing(images, { M: 1 }), title: "Pieza para cuenta eliminada" });
      const v = (await buyer.api.product(res.id)).variants[0];
      const leaver = await h.newUser("leaver2");
      await leaver.api.cartAdd(v.id, 1);
      const co = await leaver.api.checkout((await addressFor(leaver)).id);
      expect((await buyer.api.product(res.id)).variants[0].available).toBe(0);
      const r = await leaver.api.deleteAccount("ELIMINAR");
      expect(r.kept_order_history).toBe(true);
      expect((await buyer.api.product(res.id)).variants[0].available).toBe(1);
      expect((await seller.api.order(co.order_id)).status).toBe("cancelled");
      await expectApiError(leaver.api.account(), "account_deleted");
    });
  });
}
