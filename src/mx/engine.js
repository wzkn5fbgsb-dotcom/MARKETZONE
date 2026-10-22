// Subastas en vivo en el motor de demostración (mismas reglas que la migración 1300 del servidor).
import { ApiError } from "../api/backend";
import { uuid as fe } from "../api/demo/db";

function T(code, message, detail) { throw new ApiError(code, message, detail ?? null, 400); }

/* ===== MARKETXONE · Subastas en vivo (versión demo en el navegador) =====
   Replica las reglas de public/sql parte 7. Se instala en el motor demo. */
var MX_BOT_USERS = ["rack41", "soletheory", "archivovintage", "bolsoco", "glowlab"];
var MX_DURATIONS = [5, 10, 15, 30, 60];
var MX_CONDITIONS = ["new_with_tags", "new_without_tags", "used_excellent", "used_good", "used_flawed"];

function __mxMoney(c) {
  c = c || 0;
  return "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
}

function __mxEnsure(E) {
  var d = E.db;
  if (!d.auctions) d.auctions = [];
  if (!d.auction_bids) d.auction_bids = [];
  if (!d.auction_holds) d.auction_holds = [];
  if (!d.seq.auction_bid) d.seq.auction_bid = 0;
  var s = d.settings;
  if (s.auction_decision_minutes == null) s.auction_decision_minutes = 60;
  if (s.auction_ship_days == null) s.auction_ship_days = 3;
  if (s.auction_extend_seconds == null) s.auction_extend_seconds = 15;
  if (s.auction_max_relists == null) s.auction_max_relists = 3;
  return d;
}

function __mxNowMs(E) { return E.now().getTime(); }

function __mxPhase(E, a) {
  var now = __mxNowMs(E);
  if (a.status === "open" && now < E.t(a.starts_at)) return "upcoming";
  if (a.status === "open" && now < E.t(a.ends_at)) return "live";
  if (a.status === "open") return "closing";
  return a.status;
}

function __mxVisible(E, a, uid) {
  if (a.status === "cancelled") return false;
  var p = E.profile(a.seller_id);
  if (!p || p.status !== "active") return false;
  var st = a.store_id ? E.store(a.store_id) : null;
  if (a.store_id && (!st || st.status !== "active")) return false;
  if (uid && uid !== a.seller_id && E.blockedBetween(uid, a.seller_id)) return false;
  return true;
}

function __mxBots(E) {
  return E.db.profiles.filter(function (p) { return MX_BOT_USERS.indexOf(p.username) >= 0 && p.status === "active"; });
}
function __mxIsBot(E, id) {
  var p = E.profile(id);
  return !!p && MX_BOT_USERS.indexOf(p.username) >= 0;
}

function __mxCard(E, a) {
  var d = E.db, seller = E.profile(a.seller_id);
  return {
    id: a.id, title: a.title, brand: a.brand, size: a.size, color: a.color, condition: a.condition,
    status: a.status, phase: __mxPhase(E, a), round: a.round,
    start_price_cents: a.start_price_cents, current_price_cents: a.current_price_cents,
    next_bid_cents: a.current_price_cents != null ? a.current_price_cents + 100 : a.start_price_cents,
    final_price_cents: a.final_price_cents, bid_count: a.bid_count,
    starts_at: a.starts_at, ends_at: a.ends_at, ended_at: a.ended_at, decision_due_at: a.decision_due_at,
    is_demo: !!a.is_demo, created_at: a.created_at,
    image_url: a.images && a.images[0] ? a.images[0].url : null,
    bidders: d.auction_holds.filter(function (h) { return h.auction_id === a.id; }).length,
    seller: seller ? { username: seller.username, display_name: seller.display_name } : null
  };
}

function __mxJson(E, a, uid) {
  var d = E.db, s = d.settings;
  var hold = uid ? d.auction_holds.find(function (h) { return h.auction_id === a.id && h.user_id === uid; }) : null;
  var st = a.store_id ? E.store(a.store_id) : null;
  var so = a.order_id ? d.seller_orders.find(function (x) { return x.order_id === a.order_id; }) : null;
  var bids = d.auction_bids.filter(function (b) { return b.auction_id === a.id; })
    .sort(function (x, y) { return y.id - x.id; }).slice(0, 20)
    .map(function (b) {
      var p = E.profile(b.bidder_id), u = p ? p.username : "??";
      return { id: b.id, amount_cents: b.amount_cents, created_at: b.created_at, mine: b.bidder_id === uid,
               bidder: u.slice(0, 2) + "***" + u.slice(-1) };
    });
  var j = __mxCard(E, a);
  Object.assign(j, {
    category_id: a.category_id, flaws: a.flaws, measurements: a.measurements, description: a.description,
    duration_minutes: a.duration_minutes, previous_id: a.previous_id, next_id: a.next_id,
    root_start_price_cents: (d.auctions.find(function (x) { return x.id === (a.root_id || a.id); }) || a).start_price_cents,
    order_id: uid && (uid === a.seller_id || uid === a.high_bidder_id) ? a.order_id : null,
    max_rounds: s.auction_max_relists + 1,
    relists_left: Math.max(0, s.auction_max_relists + 1 - a.round),
    is_final_round: a.round >= s.auction_max_relists + 1,
    shipping_cents: s.shipping_flat_cents, commission_bps: s.commission_bps,
    extend_seconds: s.auction_extend_seconds, decision_minutes: s.auction_decision_minutes,
    ship_days: s.auction_ship_days, test_mode: !!s.test_mode, server_now: E.iso(),
    images: (a.images || []).map(function (i) { return { id: i.id, url: i.url }; }),
    store: st ? { slug: st.slug, name: st.name } : null,
    ship_by: so ? so.ship_by : null,
    bids: bids,
    viewer: {
      signed_in: !!uid,
      is_seller: !!uid && uid === a.seller_id,
      is_high_bidder: !!uid && uid === a.high_bidder_id,
      has_bid: !!uid && d.auction_bids.some(function (b) { return b.auction_id === a.id && b.bidder_id === uid; }),
      won: !!uid && uid === a.high_bidder_id && (a.status === "awaiting_seller" || a.status === "sold"),
      hold: hold ? { limit_cents: hold.limit_cents, held_cents: hold.held_cents, shipping_cents: hold.shipping_cents, status: hold.status } : null
    }
  });
  return j;
}

function __mxSell(E, a, actor, reason) {
  var d = E.db, s = d.settings;
  if (a.status !== "awaiting_seller") return;
  var h = d.auction_holds.find(function (x) { return x.auction_id === a.id && x.user_id === a.high_bidder_id; });
  if (E.blockedBetween(a.high_bidder_id, a.seller_id)) {
    if (h) { h.status = "released"; h.updated_at = E.iso(); }
    a.status = "unsold"; a.updated_at = E.iso();
    E.notify(a.high_bidder_id, "auction_cancelled", 'Sin venta: "' + a.title + '"', "La venta no se pudo completar. Se liberó tu dinero retenido; no se te cobró nada.", "/subastas");
    return;
  }
  var x = a.final_price_cents, ship = h.shipping_cents, comm = Math.round(x * s.commission_bps / 1e4);
  var order = { id: fe(), number: ++d.seq.order, buyer_id: a.high_bidder_id, source: "auction", offer_id: null, auction_id: a.id,
    status: "pending_payment", is_test: true, currency: "USD", subtotal_cents: x, shipping_cents: ship, tax_cents: 0,
    total_cents: x + ship, shipping_address: h.shipping_address, payment_due_at: E.iso(5 * 6e4), paid_at: null,
    cancelled_at: null, created_at: E.iso(), updated_at: E.iso() };
  d.orders.push(order);
  var so = { id: fe(), order_id: order.id, seller_id: a.seller_id, store_id: a.store_id, status: "pending_payment",
    subtotal_cents: x, shipping_cents: ship, commission_bps: s.commission_bps, commission_cents: comm, seller_net_cents: x - comm,
    payout_status: "not_applicable", carrier: null, tracking_number: null, shipped_at: null, delivered_at: null,
    created_at: E.iso(), updated_at: E.iso(), ship_by: E.iso(s.auction_ship_days * 864e5) };
  d.seller_orders.push(so);
  d.order_items.push({ id: fe(), order_id: order.id, seller_order_id: so.id, product_id: null, variant_id: null, title: a.title,
    size: a.size, color: a.color, image_url: a.images && a.images[0] ? a.images[0].url : null, unit_price_cents: x, quantity: 1,
    line_total_cents: x });
  d.payments.push({ id: fe(), order_id: order.id, campaign_id: null, payer_id: a.high_bidder_id, provider: "test",
    provider_ref: h.payment_ref, amount_cents: order.total_cents, currency: "USD", status: "succeeded", is_test: true, created_at: E.iso() });
  h.status = "captured"; h.held_cents = order.total_cents; h.updated_at = E.iso();
  a.status = "sold"; a.order_id = order.id; a.updated_at = E.iso();
  E.finalizePaid(order, actor);
  E.notify(a.high_bidder_id, "auction_sold", 'Compra confirmada: "' + a.title + '" por ' + __mxMoney(x),
    "Se cobró " + __mxMoney(order.total_cents) + " (precio final + envío) de tu dinero retenido. El vendedor tiene " + s.auction_ship_days +
    " días para enviarlo; si no lo envía, se te reembolsa.", "/pedido/" + order.id);
  E.notify(a.seller_id, "auction_sold", 'Vendido en subasta: "' + a.title + '" por ' + __mxMoney(x),
    reason === "auto" ? "No respondiste a tiempo y la venta se confirmó sola. Envíalo en menos de " + s.auction_ship_days + " días con número de guía."
    : reason === "final_round" ? "Era la última ronda: la venta es obligatoria. Envíalo en menos de " + s.auction_ship_days + " días con número de guía."
    : "Envíalo en menos de " + s.auction_ship_days + " días con número de guía. Si no lo envías a tiempo, se reembolsa al comprador.",
    "/panel/pedidos");
}

function __mxTick(E, a) {
  var d = E.db, s = d.settings, now = __mxNowMs(E), left = Math.max(0, s.auction_max_relists + 1 - a.round);
  if (a.status === "open" && E.t(a.ends_at) <= now) {
    if (!a.bid_count) {
      a.status = "unsold"; a.ended_at = E.iso(); a.updated_at = E.iso();
      d.auction_holds.filter(function (h) { return h.auction_id === a.id && h.status === "held"; }).forEach(function (h) {
        h.status = "released"; h.updated_at = E.iso();
        E.notify(h.user_id, "auction_ended", 'Terminó "' + a.title + '" sin pujas', "Se liberó tu dinero retenido; no se te cobró nada.", "/subasta/" + a.id);
      });
      E.notify(a.seller_id, "auction_unsold", '"' + a.title + '" terminó sin pujas',
        left > 0 ? "Puedes reenlistarla (te quedan " + left + ")." : "Ya no quedan reenlistados para este artículo.", "/subasta/" + a.id);
      return;
    }
    d.auction_holds.filter(function (h) { return h.auction_id === a.id && h.status === "held" && h.user_id !== a.high_bidder_id; }).forEach(function (h) {
      h.status = "released"; h.updated_at = E.iso();
      E.notify(h.user_id, "auction_lost", 'Subasta terminada: "' + a.title + '"',
        "Ganó otra persona con " + __mxMoney(a.current_price_cents) + ". Se liberó tu dinero retenido; no se te cobró nada.", "/subasta/" + a.id);
    });
    a.status = "awaiting_seller"; a.ended_at = E.iso(); a.final_price_cents = a.current_price_cents;
    a.decision_due_at = E.iso(s.auction_decision_minutes * 6e4); a.updated_at = E.iso();
    if (left === 0) { __mxSell(E, a, null, "final_round"); return; }
    E.notify(a.seller_id, "auction_decide", '"' + a.title + '" terminó en ' + __mxMoney(a.final_price_cents),
      "Acepta la venta o reenlístala (te quedan " + left + "). Si no respondes en " + s.auction_decision_minutes + " min, la venta se confirma sola.",
      "/subasta/" + a.id);
    E.notify(a.high_bidder_id, "auction_won", '¡Ganaste "' + a.title + '" por ' + __mxMoney(a.final_price_cents) + "!",
      "El vendedor tiene " + s.auction_decision_minutes + " min para confirmar. Tu dinero sigue retenido: si confirma, se cobra el precio final + envío; si reenlista, se libera.",
      "/subasta/" + a.id);
  } else if (a.status === "awaiting_seller" && E.t(a.decision_due_at) <= now) {
    __mxSell(E, a, null, "auto");
  } else if (a.status === "awaiting_seller" && a.is_demo && __mxIsBot(E, a.seller_id) && now - E.t(a.ended_at) > 8000) {
    // En la demo, las tiendas de ejemplo aceptan la venta a los pocos segundos.
    __mxSell(E, a, a.seller_id, "accepted");
  }
}

function __mxShipRefund(E, so) {
  var d = E.db, o = d.orders.find(function (x) { return x.id === so.order_id; });
  var amount = so.subtotal_cents + so.shipping_cents;
  d.refunds.push({ id: fe(), order_id: o.id, seller_order_id: so.id, amount_cents: amount, reason: "El vendedor no envió a tiempo (subasta).",
    status: "succeeded", is_test: true, restocked: false, created_by: null, created_at: E.iso() });
  so.status = "refunded"; so.payout_status = "reversed"; so.updated_at = E.iso();
  o.status = "refunded"; o.updated_at = E.iso();
  E.notify(o.buyer_id, "order_refunded", "Reembolso del pedido #" + o.number,
    "El vendedor no envió a tiempo. Se te devolvió " + __mxMoney(amount) + " (prueba, sin dinero real).", "/pedido/" + o.id);
  E.notify(so.seller_id, "auction_ship_missed", "Pedido #" + o.number + " cancelado", "No lo enviaste a tiempo y se reembolsó al comprador.", "/panel/pedidos");
}

/* Pujas automáticas de las cuentas de ejemplo para que la demo se sienta en vivo. */
function __mxBotHold(E, a, bot) {
  var d = E.db, h = d.auction_holds.find(function (x) { return x.auction_id === a.id && x.user_id === bot.id; });
  if (h) return h;
  var limit = (a.bot_cap_cents || a.start_price_cents * 2) + 2000;
  h = { id: fe(), auction_id: a.id, user_id: bot.id, limit_cents: limit, shipping_cents: d.settings.shipping_flat_cents,
        held_cents: limit + d.settings.shipping_flat_cents, status: "held", payment_ref: "test_hold_" + fe().replace(/-/g, ""),
        is_test: true, shipping_address: { full_name: bot.display_name, line1: "100 Demo St", line2: null, city: "Los Angeles",
        region: "CA", postal_code: "90012", country: "US", phone: null }, created_at: E.iso(), updated_at: E.iso() };
  d.auction_holds.push(h);
  return h;
}

function __mxBotsAct(E) {
  var d = E.db, now = __mxNowMs(E), bots = __mxBots(E);
  if (!bots.length) return;
  d.auctions.forEach(function (a) {
    if (a.status !== "open" || __mxPhase(E, a) !== "live") return;
    if (__mxIsBot(E, a.seller_id) === false && !a.bot_cap_cents) {
      // Subasta creada por una persona: las cuentas demo pujan hasta un tope razonable.
      a.bot_cap_cents = Math.round(a.start_price_cents * (1.4 + Math.random() * 0.8) / 100) * 100;
    }
    var cap = a.bot_cap_cents || a.start_price_cents * 2;
    var next = a.current_price_cents != null ? a.current_price_cents + 100 : a.start_price_cents;
    if (next > cap) return;
    var last = a.last_bid_at ? E.t(a.last_bid_at) : E.t(a.starts_at);
    var quiet = now - last, remaining = E.t(a.ends_at) - now;
    var humanLeading = a.high_bidder_id && !__mxIsBot(E, a.high_bidder_id);
    var wait = humanLeading ? 3500 + Math.random() * 5000 : 6000 + Math.random() * 14000;
    if (remaining < 12000) wait = Math.min(wait, 2500 + Math.random() * 2500);
    if (quiet < wait) return;
    if (humanLeading && Math.random() < 0.25) { a.last_bid_at = E.iso(); return; }
    var options = bots.filter(function (b) { return b.id !== a.seller_id && b.id !== a.high_bidder_id; });
    if (!options.length) return;
    var bot = options[Math.floor(Math.random() * options.length)];
    var jump = Math.random() < 0.15 ? 100 * (1 + Math.floor(Math.random() * 4)) : 0;
    var amount = Math.min(next + jump, cap);
    var h = __mxBotHold(E, a, bot);
    if (amount > h.limit_cents) return;
    __mxApplyBid(E, a, bot.id, amount);
  });
}

function __mxApplyBid(E, a, uid, amount) {
  var d = E.db, s = d.settings, prev = a.high_bidder_id;
  d.auction_bids.push({ id: ++d.seq.auction_bid, auction_id: a.id, bidder_id: uid, amount_cents: amount, created_at: E.iso() });
  a.current_price_cents = amount; a.high_bidder_id = uid; a.bid_count = (a.bid_count || 0) + 1;
  a.last_bid_at = E.iso();
  var minEnd = __mxNowMs(E) + s.auction_extend_seconds * 1000;
  if (E.t(a.ends_at) < minEnd) a.ends_at = new Date(minEnd).toISOString();
  a.updated_at = E.iso();
  if (prev && prev !== uid && !__mxIsBot(E, prev)) {
    var recent = d.notifications.some(function (n) {
      return n.user_id === prev && n.kind === "auction_outbid" && n.link === "/subasta/" + a.id && __mxNowMs(E) - E.t(n.created_at) < 120000;
    });
    if (!recent) E.notify(prev, "auction_outbid", 'Te superaron en "' + a.title + '"',
      "La puja va en " + __mxMoney(amount) + ". Entra para seguir pujando.", "/subasta/" + a.id);
  }
}

function __mxSeedDemo(E) {
  var d = E.db, now = __mxNowMs(E);
  var openDemo = d.auctions.filter(function (a) { return a.is_demo && a.status === "open" && E.t(a.ends_at) > now; });
  if (openDemo.length >= 3) return;
  var byUser = {};
  d.profiles.forEach(function (p) { byUser[p.username] = p; });
  var items = [
    { u: "rack41", cat: "streetwear-hoodies", title: "Hoodie heavyweight gris jaspeado", brand: "Mono Club", size: "L", color: "Gris",
      cond: "used_excellent", art: "hoodie:heather:fog", start: 1500, cap: 2900, dur: 10, startIn: -4, endIn: 6,
      meas: [["Largo (hombro a bastilla)", "28", "in"], ["Ancho (axila a axila)", "23", "in"], ["Manga", "25", "in"]],
      desc: "Hoodie de gramaje alto (450 g), capucha doble. Usada dos veces, sin manchas, sin bolitas y sin olores. Se envía doblada en bolsa.",
      flaws: null, bids: 6 },
    { u: "soletheory", cat: "sneakers-lifestyle", title: "Tenis retro blancos piel talla 9", brand: "Courtline", size: "9 US", color: "Blanco",
      cond: "used_good", art: "sneaker:white:stone", start: 2000, cap: 4800, dur: 15, startIn: -6, endIn: 9,
      meas: [["Largo de plantilla", "27", "cm"], ["Talla US", "9", "in"]],
      desc: "Tenis de piel blanca con suela de goma. Usados unas 10 veces: arrugas normales en la punta, suela con desgaste ligero. Sin caja.",
      flaws: null, bids: 9 },
    { u: "archivovintage", cat: "ropa-chaquetas", title: "Chaqueta denim vintage lavado claro", brand: "Rue 9", size: "M", color: "Azul claro",
      cond: "used_flawed", art: "jacket:lightdenim:sage", start: 1800, cap: 3600, dur: 30, startIn: -2, endIn: 14,
      meas: [["Largo", "24", "in"], ["Ancho (axila a axila)", "21", "in"], ["Hombros", "18", "in"]],
      desc: "Chaqueta de mezclilla vintage con botones metálicos y dos bolsillos de pecho. Tela gruesa, cierra bien. Ver fotos del detalle.",
      flaws: "Pequeña mancha clara en el puño izquierdo (foto 3). No afecta el uso.", bids: 3 },
    { u: "bolsoco", cat: "bolsos-crossbody", title: "Bolso crossbody camel piel sintética", brand: "Mara & Co.", size: null, color: "Camel",
      cond: "new_without_tags", art: "crossbody:tan:blush", start: 1200, cap: 2600, dur: 10, startIn: 4, endIn: 14,
      meas: [["Ancho", "9", "in"], ["Alto", "6", "in"], ["Correa (máx.)", "48", "in"]],
      desc: "Bolso cruzado nuevo sin etiquetas, nunca usado. Correa ajustable, cierre magnético y bolsillo interior. Sin rayones.",
      flaws: null, bids: 0 },
    { u: "bolsoco", cat: "accesorios-gorras", title: "Gorra 6 paneles negra bordada", brand: "Fieldhouse", size: "Ajustable", color: "Negro",
      cond: "new_with_tags", art: "cap:black:noir", start: 800, cap: 1700, dur: 5, startIn: 18, endIn: 23,
      meas: [["Circunferencia", "22.5", "in"], ["Visera", "2.8", "in"]],
      desc: "Gorra nueva con etiquetas, bordado frontal y ajuste trasero. Se envía en caja para que no se deforme.",
      flaws: null, bids: 0 }
  ];
  var sellerIds = {};
  items.forEach(function (it) {
    var seller = byUser[it.u];
    if (!seller) return;
    if (openDemo.some(function (a) { return a.title === it.title; })) return;
    var store = d.stores.find(function (st) { return st.owner_id === seller.id; });
    var starts = now + it.startIn * 6e4, ends = now + it.endIn * 6e4;
    if (ends - starts < it.dur * 6e4) starts = ends - it.dur * 6e4;
    var art = "art:" + it.art;
    var parts = it.art.split(":");
    var images = [art + ":0", art + ":1", art + ":2", "art:" + parts[0] + ":" + parts[1] + ":noir:0"].map(function (url, i) {
      return { id: fe(), url: url, position: i };
    });
    var a = { id: fe(), seller_id: seller.id, store_id: store ? store.id : null, root_id: null, previous_id: null, next_id: null, round: 1,
      title: it.title, brand: it.brand, category_id: it.cat, size: it.size, color: it.color, condition: it.cond, flaws: it.flaws,
      measurements: it.meas.map(function (m) { return { label: m[0], value: m[1], unit: m[2] }; }), description: it.desc,
      photos_confirmed: true, start_price_cents: it.start, duration_minutes: it.dur,
      starts_at: new Date(starts).toISOString(), ends_at: new Date(ends).toISOString(), status: "open",
      current_price_cents: null, high_bidder_id: null, bid_count: 0, ended_at: null, decision_due_at: null, final_price_cents: null,
      order_id: null, is_demo: true, bot_cap_cents: it.cap, images: images, created_at: new Date(starts - 36e5).toISOString(),
      updated_at: E.iso(), last_bid_at: null };
    a.root_id = a.id;
    d.auctions.push(a);
    // Historial de pujas previas para que la sala no empiece vacía.
    var bots = __mxBots(E).filter(function (b) { return b.id !== seller.id; });
    var price = it.start;
    for (var k = 0; k < it.bids && bots.length; k++) {
      var bot = bots[k % bots.length];
      if (a.high_bidder_id === bot.id) bot = bots[(k + 1) % bots.length];
      __mxBotHold(E, a, bot);
      var t = starts + (k + 1) * Math.max(4000, (now - starts) / (it.bids + 1));
      d.auction_bids.push({ id: ++d.seq.auction_bid, auction_id: a.id, bidder_id: bot.id, amount_cents: price, created_at: new Date(t).toISOString() });
      a.current_price_cents = price; a.high_bidder_id = bot.id; a.bid_count++; a.last_bid_at = new Date(t).toISOString();
      price += k % 3 === 2 ? 200 : 100;
    }
    sellerIds[seller.id] = true;
  });
}

function __mxSweep(E) {
  var d = __mxEnsure(E), now = __mxNowMs(E);
  if (E.__mxLastSweep && now - E.__mxLastSweep < 400) return;
  E.__mxLastSweep = now;
  __mxBotsAct(E);
  d.auctions.forEach(function (a) {
    if ((a.status === "open" && E.t(a.ends_at) <= now) || a.status === "awaiting_seller") __mxTick(E, a);
  });
  d.seller_orders.forEach(function (so) {
    if (so.ship_by && (so.status === "paid" || so.status === "preparing") && E.t(so.ship_by) <= now) {
      var o = d.orders.find(function (x) { return x.id === so.order_id; });
      if (o && o.source === "auction") __mxShipRefund(E, so);
    }
  });
}

function __mxAuctionSweep(E) {
  try { __mxSweep(E); } catch (err) { if (err && err.code) throw err; console.warn("auction sweep", err); }
}

function __mxValidPrice(c) {
  if (!Number.isInteger(c) || c < 100 || c > 1e7 || c % 100 !== 0) T("validation", "El precio inicial debe ser en dólares enteros, desde $1.", { field: "start_price_cents" });
}

function __mxAuctionInstall(E) {
  var h = E.handlers;
  try { if (typeof window !== "undefined") window.__mxEngine = E; } catch (e) {}
  var d = function () { return __mxEnsure(E); };
  var find = function (id) {
    var a = d().auctions.find(function (x) { return x.id === id; });
    return a || null;
  };

  h.list_auctions = function (n, uid) {
    d(); __mxSeedDemo(E); __mxSweep(E);
    var p = n.p || {}, tab = p.tab || "live", now = __mxNowMs(E), lim = Math.min(Math.max(p.limit || 40, 1), 100);
    var rows = d().auctions.filter(function (a) {
      if (!__mxVisible(E, a, uid)) return false;
      if (tab === "live") return a.status === "open" && E.t(a.starts_at) <= now && E.t(a.ends_at) > now;
      if (tab === "upcoming") return a.status === "open" && E.t(a.starts_at) > now;
      if (tab === "ended") return ["awaiting_seller", "sold", "unsold"].indexOf(a.status) >= 0 && now - E.t(a.ended_at) < 7 * 864e5;
      return false;
    });
    rows.sort(function (x, y) {
      if (tab === "live") return E.t(x.ends_at) - E.t(y.ends_at);
      if (tab === "upcoming") return E.t(x.starts_at) - E.t(y.starts_at);
      return E.t(y.ended_at) - E.t(x.ended_at);
    });
    return rows.slice(0, lim).map(function (a) { return __mxCard(E, a); });
  };

  h.get_auction = function (n, uid) {
    d();
    var a = find(n.p_id);
    if (a) __mxTick(E, a);
    var holder = a && uid && d().auction_holds.some(function (x) { return x.auction_id === a.id && x.user_id === uid; });
    if (!a || !(__mxVisible(E, a, uid) || a.seller_id === uid || holder)) T("not_found", "La subasta no existe.");
    return __mxJson(E, a, uid);
  };

  h.create_auction = function (n, uid) {
    var o = E.requireUser(uid), p = n.p || {}, db = d(), now = __mxNowMs(E);
    var title = (p.title || "").trim(), desc = (p.description || "").trim(), flaws = (p.flaws || "").trim() || null;
    if (title.length < 5 || title.length > 120) T("validation", "Escribe un título de 5 a 120 caracteres.", { field: "title" });
    if (!db.categories.some(function (c) { return c.id === p.category_id && c.is_active; })) T("validation", "Elige una categoría.", { field: "category_id" });
    if (MX_CONDITIONS.indexOf(p.condition) < 0) T("validation", "Indica el estado del artículo.", { field: "condition" });
    if (p.condition === "used_flawed" && (flaws || "").length < 5) T("validation", "Describe los detalles o defectos (al menos 5 caracteres) y muéstralos en las fotos.", { field: "flaws" });
    if (desc.length > 3000) T("validation", "La descripción puede tener hasta 3000 caracteres.", { field: "description" });
    var images = Array.isArray(p.images) ? p.images : [];
    if (images.length < 1 || images.length > 12) T("validation", "Sube de 1 a 12 fotos claras del artículo.", { field: "images" });
    if (images.some(function (i) { return !/^(https?:|mzimg:|art:|data:image\/)/.test(String(i && i.url || "")); }))
      T("validation", "Las fotos deben subirse al almacenamiento de MARKETXONE.", { field: "images" });
    var meas = (Array.isArray(p.measurements) ? p.measurements : []).filter(function (m) {
      var l = String(m && m.label || "").trim();
      return l.length >= 1 && l.length <= 30 && /^[0-9]{1,4}([.,][0-9]{1,2})?$/.test(String(m.value || "")) && (m.unit === "in" || m.unit === "cm");
    }).map(function (m) { return { label: String(m.label).trim(), value: String(m.value).replace(",", "."), unit: m.unit }; });
    if (meas.length < 2 || meas.length > 12) T("validation", "Agrega de 2 a 12 medidas con su número y unidad (por ejemplo: Largo 28 in).", { field: "measurements" });
    if (p.photos_confirmed !== true) T("validation", "Confirma que las fotos son claras, reales y muestran los detalles.", { field: "photos_confirmed" });
    __mxValidPrice(p.start_price_cents);
    var dur = p.duration_minutes || 10, delay = p.starts_in_minutes || 0;
    if (MX_DURATIONS.indexOf(dur) < 0) T("validation", "Elige una duración válida.", { field: "duration_minutes" });
    if (!Number.isInteger(delay) || delay < 0 || delay > 10080) T("validation", "La subasta puede empezar ahora o en los próximos 7 días.", { field: "starts_in_minutes" });
    if (db.auctions.filter(function (a) { return a.seller_id === o && (a.status === "open" || a.status === "awaiting_seller"); }).length >= 30)
      T("too_many_auctions", "Tienes 30 subastas abiertas. Espera a que terminen algunas.");
    var starts = now + delay * 6e4;
    var a = { id: fe(), seller_id: o, store_id: E.defaultStore(o), root_id: null, previous_id: null, next_id: null, round: 1,
      title: title, brand: (p.brand || "").trim().slice(0, 60) || null, category_id: p.category_id,
      size: (p.size || "").trim().slice(0, 20) || null, color: (p.color || "").trim().slice(0, 40) || null,
      condition: p.condition, flaws: flaws ? flaws.slice(0, 1000) : null, measurements: meas, description: desc,
      photos_confirmed: true, start_price_cents: p.start_price_cents, duration_minutes: dur,
      starts_at: new Date(starts).toISOString(), ends_at: new Date(starts + dur * 6e4).toISOString(), status: "open",
      current_price_cents: null, high_bidder_id: null, bid_count: 0, ended_at: null, decision_due_at: null, final_price_cents: null,
      order_id: null, is_demo: false, images: images.map(function (i, k) { return { id: fe(), url: i.url, storage_path: i.storage_path || null, position: k }; }),
      created_at: E.iso(), updated_at: E.iso(), last_bid_at: null };
    a.root_id = a.id;
    db.auctions.push(a);
    return __mxJson(E, a, o);
  };

  h.join_auction = function (n, uid) {
    var o = E.requireUser(uid), db = d(), s = db.settings, a = find(n.p_auction_id);
    if (a) __mxTick(E, a);
    if (!a || !__mxVisible(E, a, o)) T("not_found", "La subasta no existe.");
    var ph = __mxPhase(E, a);
    if (ph !== "upcoming" && ph !== "live") T("auction_closed", "Esta subasta ya terminó.");
    if (a.seller_id === o) T("own_item", "No puedes pujar en tu propia subasta.");
    E.assertNotBlocked(o, a.seller_id);
    if (!s.test_mode) T("payments_not_ready", "Los pagos reales todavía no están activos.");
    var next = a.current_price_cents != null ? a.current_price_cents + 100 : a.start_price_cents, lim = n.p_limit_cents;
    if (!Number.isInteger(lim) || lim % 100 !== 0 || lim < next || lim > 1e7)
      T("validation", "Tu límite debe ser en dólares enteros y de al menos " + __mxMoney(next) + ".", { field: "limit_cents", min_cents: next });
    var hold = db.auction_holds.find(function (x) { return x.auction_id === a.id && x.user_id === o; });
    if (hold && hold.status === "held") {
      if (a.high_bidder_id === o && lim < a.current_price_cents) T("validation", "Vas ganando: tu límite no puede quedar por debajo de tu puja actual.");
      hold.limit_cents = lim; hold.held_cents = lim + hold.shipping_cents; hold.updated_at = E.iso();
      return __mxJson(E, a, o);
    }
    var addr = db.addresses.filter(function (x) { return x.user_id === o && (!n.p_address_id || x.id === n.p_address_id); })
      .sort(function (x, y) { return Number(y.is_default) - Number(x.is_default) || x.created_at.localeCompare(y.created_at); })[0];
    if (!addr) T("address_required", "Agrega una dirección de envío: si ganas, el artículo se envía ahí.");
    var row = { id: fe(), auction_id: a.id, user_id: o, limit_cents: lim, shipping_cents: s.shipping_flat_cents,
      held_cents: lim + s.shipping_flat_cents, status: "held", payment_ref: "test_hold_" + fe().replace(/-/g, ""), is_test: true,
      shipping_address: E.addressSnapshot(addr), created_at: E.iso(), updated_at: E.iso() };
    if (hold) Object.assign(hold, row, { id: hold.id }); else db.auction_holds.push(row);
    return __mxJson(E, a, o);
  };

  h.place_bid = function (n, uid) {
    var o = E.requireUser(uid), db = d(), a = find(n.p_auction_id);
    if (a) __mxTick(E, a);
    if (!a || !__mxVisible(E, a, o)) T("not_found", "La subasta no existe.");
    var ph = __mxPhase(E, a);
    if (ph === "upcoming") T("auction_not_started", "La subasta todavía no empieza.");
    if (ph !== "live") T("auction_closed", "Esta subasta ya terminó.");
    if (a.seller_id === o) T("own_item", "No puedes pujar en tu propia subasta.");
    E.assertNotBlocked(o, a.seller_id);
    var hold = db.auction_holds.find(function (x) { return x.auction_id === a.id && x.user_id === o; });
    if (!hold || hold.status !== "held") T("hold_required", "Para pujar, primero entra a la subasta con tu dinero retenido.");
    if (a.high_bidder_id === o) T("already_winning", "Ya vas ganando. Espera a que alguien te supere.");
    var next = a.current_price_cents != null ? a.current_price_cents + 100 : a.start_price_cents, amt = n.p_amount_cents;
    if (!Number.isInteger(amt) || amt % 100 !== 0) T("validation", "Las pujas van en dólares enteros.");
    if (amt < next) T("outbid", "Alguien pujó antes que tú. La siguiente puja es de " + __mxMoney(next) + ".", { current_price_cents: a.current_price_cents, next_bid_cents: next });
    if (amt > hold.limit_cents) T("limit_reached", "Esa puja pasa tu límite retenido de " + __mxMoney(hold.limit_cents) + ". Sube tu límite para seguir pujando.", { limit_cents: hold.limit_cents });
    __mxApplyBid(E, a, o, amt);
    return __mxJson(E, a, o);
  };

  h.auction_decide = function (n, uid) {
    var o = E.requireUser(uid), db = d(), s = db.settings, a = find(n.p_auction_id);
    if (a) __mxTick(E, a);
    if (!a || a.seller_id !== o) T("not_found", "La subasta no existe.");
    if (n.p_action === "accept") {
      if (a.status !== "awaiting_seller") T("invalid_action", "Esta subasta no está esperando tu decisión.");
      __mxSell(E, a, o, "accepted");
      return __mxJson(E, a, o);
    }
    if (n.p_action !== "relist") T("invalid_action", "Acción no válida.");
    if (a.status !== "awaiting_seller" && a.status !== "unsold") T("invalid_action", "Solo puedes reenlistar una subasta terminada que no se vendió.");
    if (a.round >= s.auction_max_relists + 1) T("no_relists_left", "Ya reenlistaste este artículo " + s.auction_max_relists + " veces: la última ronda es obligatoria.");
    var price = n.p_start_price_cents != null ? n.p_start_price_cents : a.start_price_cents;
    __mxValidPrice(price);
    var root = find(a.root_id || a.id) || a;
    if (price > root.start_price_cents) T("validation", "Al reenlistar, el precio inicial no puede pasar el original de " + __mxMoney(root.start_price_cents) + ".", { field: "start_price_cents" });
    var dur = n.p_duration_minutes || a.duration_minutes, delay = n.p_starts_in_minutes || 0;
    if (MX_DURATIONS.indexOf(dur) < 0) T("validation", "Elige una duración válida.");
    if (!Number.isInteger(delay) || delay < 0 || delay > 10080) T("validation", "La subasta puede empezar ahora o en los próximos 7 días.");
    if (a.status === "awaiting_seller") {
      db.auction_holds.filter(function (x) { return x.auction_id === a.id && x.status === "held"; }).forEach(function (x) { x.status = "released"; x.updated_at = E.iso(); });
      E.notify(a.high_bidder_id, "auction_relisted", 'El vendedor reenlistó "' + a.title + '"',
        "No aceptó el precio final y lo volverá a subastar. Se liberó tu dinero retenido; no se te cobró nada.", "/subasta/" + a.id);
    }
    var now = __mxNowMs(E), starts = now + delay * 6e4;
    var nw = Object.assign({}, a, { id: fe(), root_id: a.root_id || a.id, previous_id: a.id, next_id: null, round: a.round + 1,
      start_price_cents: price, duration_minutes: dur, starts_at: new Date(starts).toISOString(),
      ends_at: new Date(starts + dur * 6e4).toISOString(), status: "open", current_price_cents: null, high_bidder_id: null,
      bid_count: 0, ended_at: null, decision_due_at: null, final_price_cents: null, order_id: null, created_at: E.iso(),
      updated_at: E.iso(), last_bid_at: null, bot_cap_cents: a.bot_cap_cents ? Math.max(price + 300, a.bot_cap_cents) : null,
      images: (a.images || []).map(function (i) { return Object.assign({}, i, { id: fe() }); }) });
    db.auctions.push(nw);
    a.status = "relisted"; a.next_id = nw.id; a.updated_at = E.iso();
    return __mxJson(E, nw, o);
  };

  h.cancel_auction = function (n, uid) {
    var o = E.requireUser(uid), db = d(), a = find(n.p_id);
    if (a) __mxTick(E, a);
    if (!a || a.seller_id !== o) T("not_found", "La subasta no existe.");
    if (!((a.status === "open" && !a.bid_count) || a.status === "unsold")) T("invalid_action", "Ya hay pujas: la subasta no se puede cancelar.");
    db.auction_holds.filter(function (x) { return x.auction_id === a.id && x.status === "held"; }).forEach(function (x) {
      x.status = "released"; x.updated_at = E.iso();
      E.notify(x.user_id, "auction_cancelled", 'Se canceló "' + a.title + '"', "El vendedor canceló la subasta antes de recibir pujas. Se liberó tu dinero retenido.", "/subastas");
    });
    a.status = "cancelled"; a.ended_at = a.ended_at || E.iso(); a.updated_at = E.iso();
    return __mxJson(E, a, o);
  };

  h.my_auctions = function (n, uid) {
    var o = E.requireUser(uid), db = d();
    __mxSweep(E);
    var strip = function (j) { delete j.bids; delete j.images; delete j.description; return j; };
    if (n.p_role === "seller") {
      return db.auctions.filter(function (a) { return a.seller_id === o && a.status !== "cancelled"; })
        .sort(function (x, y) { return E.t(y.created_at) - E.t(x.created_at); }).slice(0, 100)
        .map(function (a) { return strip(__mxJson(E, a, o)); });
    }
    var now = __mxNowMs(E);
    return db.auction_holds.filter(function (x) { return x.user_id === o && now - E.t(x.updated_at) < 60 * 864e5; })
      .sort(function (x, y) { return E.t(y.updated_at) - E.t(x.updated_at); }).slice(0, 100)
      .map(function (x) { return find(x.auction_id); }).filter(Boolean)
      .map(function (a) { return strip(__mxJson(E, a, o)); });
  };
}

export { MX_CONDITIONS, MX_DURATIONS, __mxAuctionInstall, __mxAuctionSweep };
