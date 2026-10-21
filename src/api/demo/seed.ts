// Datos de DEMOSTRACIÓN claramente identificados (is_demo = true).
// No se crean reseñas, seguidores, ventas ni pedidos ficticios: esas cifras parten de cero y solo
// cambian con lo que hagas en la demo.
import { DemoEngine } from "./engine";
import { emptyDB, uuid, type DemoDB, type ProductRow } from "./db";
import { hashPassword } from "./backend";

export const DEMO_PASSWORD = "demo-marketzone";
export const DEMO_ACCOUNTS = {
  buyer: { email: "comprador@demo.marketzone", name: "Comprador demo", username: "comprador_demo" },
  seller: { email: "vendedor@demo.marketzone", name: "Vendedor demo", username: "vendedor_demo" },
  admin: { email: "admin@demo.marketzone", name: "Admin demo", username: "admin_demo" },
};

interface SeedProduct {
  store: string; cat: string; title: string; brand: string; cond: ProductRow["condition"]; price: number; was?: number;
  art: string; color: string; material?: string; fit?: string; flaws?: string; desc: string; tags: string[];
  variants: [string | null, string | null, number][]; daysAgo: number; offers?: boolean;
}

const STORES = [
  { key: "rack41", owner: "rack41", name: "Rack 41", slug: "rack41", accent: "crimson", bio: "Streetwear de reventa curado en LA: hoodies, gráficas y cargo. Tienda de demostración.", cats: ["streetwear", "ropa"] },
  { key: "sole", owner: "soletheory", name: "Sole Theory", slug: "sole-theory", accent: "steel", bio: "Sneakers nuevos y usados verificados por el vendedor, con fotos de suela y etiqueta. Tienda de demostración.", cats: ["sneakers"] },
  { key: "archivo", owner: "archivovintage", name: "Archivo Vintage", slug: "archivo-vintage", accent: "ember", bio: "Piezas únicas de segunda mano: denim, vestidos y chaquetas. Tienda de demostración.", cats: ["ropa"] },
  { key: "bolso", owner: "bolsoco", name: "Bolso & Co.", slug: "bolso-co", accent: "ivory", bio: "Bolsos, gorras y gafas para el día a día. Tienda de demostración.", cats: ["bolsos", "accesorios"] },
  { key: "glow", owner: "glowlab", name: "Glow Lab", slug: "glow-lab", accent: "ivory", bio: "Skincare y fragancias selladas, solo productos permitidos. Tienda de demostración.", cats: ["belleza"] },
  { key: "mine", owner: "seller", name: "Mi tienda demo", slug: "mi-tienda-demo", accent: "crimson", bio: "La tienda de la cuenta 'Vendedor demo'. Úsala para probar el panel, el inventario y las ofertas.", cats: ["ropa"] },
] as const;

const P: SeedProduct[] = [
  // Vendedor demo: ejemplo exacto de inventario por tallas del documento de requisitos
  { store: "mine", cat: "ropa-sudaderas", title: "Sudadera negra con capucha", brand: "Northline", cond: "new_with_tags", price: 3500, art: "art:hoodie:black:stone",
    color: "Negro", material: "Algodón y poliéster (según etiqueta)", fit: "Regular", desc: "Sudadera con capucha, bolsillo canguro y puños de canalé. Una sola publicación con inventario por talla.",
    tags: ["sudadera", "hoodie", "negro", "basico"], variants: [["XS", "Negro", 1], ["S", "Negro", 2], ["M", "Negro", 3], ["L", "Negro", 1], ["XL", "Negro", 0]], daysAgo: 1 },
  { store: "mine", cat: "ropa-camisetas", title: "Camiseta oversize logo círculo", brand: "Northline", cond: "new_with_tags", price: 2400, art: "art:tee:white:sage::crimson",
    color: "Negra / Blanca", material: "Algodón", fit: "Oversize", desc: "Camiseta de corte amplio con estampado frontal. Inventario por color y talla.",
    tags: ["camiseta", "oversize", "grafica"], variants: [["S", "Negra", 2], ["M", "Negra", 3], ["L", "Negra", 1], ["S", "Blanca", 1], ["M", "Blanca", 2]], daysAgo: 2 },
  { store: "mine", cat: "ropa-chaquetas", title: "Chaqueta denim lavado medio", brand: "Rue 9", cond: "used_excellent", price: 5800, was: 6800, art: "art:jacket:denim:stone",
    color: "Azul", material: "Denim", fit: "Regular", desc: "Chaqueta de mezclilla con botones metálicos y bolsillos de pecho. Uso mínimo.", tags: ["denim", "chaqueta", "vintage"],
    variants: [["M", null, 1]], daysAgo: 6 },
  // Rack 41
  { store: "rack41", cat: "streetwear-hoodies", title: "Hoodie heavyweight gris jaspeado", brand: "Mono Club", cond: "new_without_tags", price: 4800, was: 5600, art: "art:hoodie:heather:fog",
    color: "Gris", material: "Algodón 450 g", fit: "Boxy", desc: "Hoodie de gramaje alto, capucha doble. Nunca usada, sin etiquetas.", tags: ["hoodie", "gris", "heavyweight"],
    variants: [["S", null, 1], ["M", null, 2], ["L", null, 2], ["XL", null, 1]], daysAgo: 3 },
  { store: "rack41", cat: "streetwear-graficas", title: "Camiseta gráfica sol rojo", brand: "Mono Club", cond: "new_with_tags", price: 3200, art: "art:tee:cream:blush::crimson",
    color: "Crema", material: "Algodón", fit: "Regular", desc: "Camiseta con gráfica frontal de círculo rojo y texto minimalista.", tags: ["grafica", "camiseta", "crema"],
    variants: [["S", null, 3], ["M", null, 4], ["L", null, 2]], daysAgo: 4 },
  { store: "rack41", cat: "streetwear-cargo", title: "Pantalón cargo olivo", brand: "Atlas Goods", cond: "used_good", price: 3900, art: "art:pants:olive:sage",
    color: "Verde oliva", material: "Algodón ripstop", fit: "Relaxed", desc: "Cargo con bolsillos laterales con solapa. Desgaste leve en los bajos.", tags: ["cargo", "workwear", "verde"],
    variants: [["30", null, 1], ["32", null, 1], ["34", null, 0]], daysAgo: 7 },
  { store: "rack41", cat: "streetwear-hoodies", title: "Hoodie negra edición drop", brand: "Mono Club", cond: "new_with_tags", price: 6500, art: "art:hoodie:black:ember",
    color: "Negro", material: "Algodón", desc: "Hoodie de edición limitada del vendedor. Agotada en M: demuestra variantes agotadas.", tags: ["hoodie", "drop", "negro"],
    variants: [["S", null, 1], ["M", null, 0], ["L", null, 1]], daysAgo: 9 },
  { store: "rack41", cat: "ropa-camisetas", title: "Camiseta básica carbón", brand: "Atlas Goods", cond: "new_with_tags", price: 1800, was: 2200, art: "art:tee:charcoal:fog::cream",
    color: "Gris carbón", material: "Algodón", desc: "Básica de corte recto.", tags: ["camiseta", "basico"], variants: [["S", null, 5], ["M", null, 6], ["L", null, 4], ["XL", null, 2]], daysAgo: 12 },
  // Sole Theory
  { store: "sole", cat: "sneakers-lifestyle", title: "Sneaker low blanco y rojo", brand: "Arcade Athletic", cond: "new_with_tags", price: 11000, art: "art:sneaker:white:noir::crimson",
    color: "Blanco / rojo", material: "Piel sintética (según etiqueta)", desc: "Par nuevo en caja. Tallas US hombre.", tags: ["sneakers", "low", "blanco"],
    variants: [["US 8", null, 1], ["US 9", null, 2], ["US 10", null, 1], ["US 11", null, 0]], daysAgo: 1 },
  { store: "sole", cat: "sneakers-running", title: "Runner azul marino", brand: "Arcade Athletic", cond: "used_excellent", price: 7400, was: 8900, art: "art:sneaker:navy:fog",
    color: "Azul marino", desc: "Usadas dos veces. Suela sin desgaste visible en las fotos; pide más fotos si lo necesitas.", tags: ["running", "azul"],
    variants: [["US 9.5", null, 1]], daysAgo: 5 },
  { store: "sole", cat: "sneakers-basket", title: "Sneaker alto negro", brand: "Kōen", cond: "used_good", price: 9500, art: "art:sneaker:black:stone::cream",
    color: "Negro", desc: "Buen estado general, arrugas normales en la puntera.", tags: ["basketball", "negro", "high"],
    variants: [["US 10", null, 1]], daysAgo: 8 },
  { store: "sole", cat: "sneakers-lifestyle", title: "Sneaker crema minimal", brand: "Kōen", cond: "new_without_tags", price: 8800, art: "art:sneaker:cream:sage::brown",
    color: "Crema", desc: "Nuevo sin caja.", tags: ["minimal", "crema"], variants: [["US 7", null, 1], ["US 8", null, 1], ["US 9", null, 1]], daysAgo: 10 },
  // Archivo Vintage (piezas únicas)
  { store: "archivo", cat: "ropa-vestidos", title: "Vestido midi burdeos", brand: "Sin marca", cond: "used_excellent", price: 4200, art: "art:dress:burgundy:blush",
    color: "Burdeos", material: "Viscosa (según etiqueta)", desc: "Vestido de tirantes con falda evasé. Pieza única.", tags: ["vestido", "midi", "vintage"],
    variants: [["S", null, 1]], daysAgo: 2 },
  { store: "archivo", cat: "ropa-chaquetas", title: "Chaqueta denim clara años 90", brand: "Sin marca", cond: "used_flawed", price: 3600, art: "art:jacket:lightdenim:stone",
    color: "Azul claro", flaws: "Pequeña mancha en el puño izquierdo y un botón reemplazado.", desc: "Denim lavado claro, corte recto. Defectos declarados y fotografiados.", tags: ["denim", "90s", "vintage"],
    variants: [["L", null, 1]], daysAgo: 4 },
  { store: "archivo", cat: "ropa-pantalones", title: "Pantalón cargo arena", brand: "Sin marca", cond: "used_good", price: 2900, was: 3500, art: "art:pants:sand:stone",
    color: "Arena", desc: "Cargo vintage con bolsillos laterales.", tags: ["cargo", "arena"], variants: [["M", null, 1]], daysAgo: 11 },
  { store: "archivo", cat: "ropa-vestidos", title: "Vestido lila de tirantes", brand: "Sin marca", cond: "used_excellent", price: 3800, art: "art:dress:lilac:fog",
    color: "Lila", desc: "Vestido ligero de verano. Pieza única.", tags: ["vestido", "lila"], variants: [["M", null, 1]], daysAgo: 13 },
  // Bolso & Co.
  { store: "bolso", cat: "bolsos-crossbody", title: "Bolso crossbody camel", brand: "Sabi", cond: "new_with_tags", price: 6200, art: "art:crossbody:tan:blush",
    color: "Camel", material: "Material sintético", desc: "Bolso cruzado con solapa y cierre metálico.", tags: ["bolso", "crossbody", "camel"], variants: [[null, null, 3]], daysAgo: 2 },
  { store: "bolso", cat: "bolsos-tote", title: "Tote de lona crema", brand: "Sabi", cond: "new_with_tags", price: 2600, art: "art:tote:cream:stone",
    color: "Crema", material: "Lona de algodón", desc: "Tote amplia con bolsillo frontal.", tags: ["tote", "lona"], variants: [[null, null, 6]], daysAgo: 5 },
  { store: "bolso", cat: "accesorios-gorras", title: "Gorra seis paneles negra", brand: "Orbit", cond: "new_with_tags", price: 2200, was: 2800, art: "art:cap:black:stone",
    color: "Negro", desc: "Gorra ajustable con parche frontal liso.", tags: ["gorra", "negro"], variants: [["Única", null, 8]], daysAgo: 6 },
  { store: "bolso", cat: "accesorios-gafas", title: "Gafas de sol cuadradas", brand: "Orbit Eyewear", cond: "new_without_tags", price: 3400, art: "art:sunglasses:black:blush::teal",
    color: "Negro / verde", desc: "Montura acetato. Incluye funda.", tags: ["gafas", "sol"], variants: [["Única", null, 4]], daysAgo: 8 },
  { store: "bolso", cat: "accesorios-relojes", title: "Reloj analógico correa negra", brand: "Atlas Goods", cond: "used_excellent", price: 7900, art: "art:watch:black:fog::silver",
    color: "Negro / plata", desc: "Funciona correctamente según el vendedor. Pila cambiada recientemente.", tags: ["reloj", "analogico"], variants: [["Única", null, 1]], daysAgo: 14 },
  // Glow Lab
  { store: "glow", cat: "belleza-skincare", title: "Sérum facial 30 ml (sellado)", brand: "Lumen Skin", cond: "new_with_tags", price: 2800, art: "art:serum:amber:sage::cream",
    color: "Ámbar", desc: "Producto sellado. Revisa la fecha de caducidad en las fotos antes de comprar.", tags: ["serum", "skincare"], variants: [[null, null, 12]], daysAgo: 1 },
  { store: "glow", cat: "belleza-fragancias", title: "Eau de parfum 50 ml (sellado)", brand: "Vela Studio", cond: "new_with_tags", price: 6400, was: 7200, art: "art:perfume:rose:blush::gold",
    color: "Rosa", desc: "Fragancia sellada en caja original.", tags: ["perfume", "fragancia"], variants: [[null, null, 5]], daysAgo: 3 },
  { store: "glow", cat: "belleza-skincare", title: "Sérum hidratante 15 ml", brand: "Lumen Skin", cond: "new_with_tags", price: 1900, art: "art:serum:pink:blush::cream",
    color: "Rosa", desc: "Tamaño viaje, sellado.", tags: ["serum", "viaje"], variants: [[null, null, 9]], daysAgo: 6 },
];

export async function buildSeedDB(now = new Date()): Promise<DemoDB> {
  const iso = (daysAgo: number, h = 0) => new Date(now.getTime() - daysAgo * 864e5 - h * 36e5).toISOString();
  const engine = new DemoEngine(emptyDB(iso(30)));
  const db = engine.db;
  const hash = async () => { const salt = uuid(); return { salt, hash: await hashPassword(DEMO_PASSWORD, salt) }; };

  const ids: Record<string, string> = {};
  for (const [key, a] of Object.entries(DEMO_ACCOUNTS)) {
    ids[key] = engine.registerUser({ email: a.email, ...(await hash()), username: a.username, display_name: a.name, role: key === "admin" ? "admin" : "user", created_at: iso(30) });
  }
  for (const s of STORES) {
    if (s.owner === "seller") continue;
    ids[s.owner] = engine.registerUser({ email: `${s.owner}@demo.marketzone`, ...(await hash()), username: s.owner, display_name: s.name, created_at: iso(30) });
  }
  const storeIds: Record<string, string> = {};
  for (const s of STORES) {
    const id = uuid();
    storeIds[s.key] = id;
    db.stores.push({ id, owner_id: ids[s.owner], slug: s.slug, name: s.name, logo_url: null, cover_url: null, bio: s.bio, accent: s.accent,
      categories: [...s.cats], social_links: { instagram: "", tiktok: "", website: "" }, business_info: {}, status: "active",
      is_demo: true, created_at: iso(29), updated_at: iso(29) });
  }

  const productIds: string[] = [];
  P.forEach((p, i) => {
    const id = uuid();
    productIds.push(id);
    const store = db.stores.find((s) => s.id === storeIds[p.store])!;
    const row: ProductRow = {
      id, seller_id: store.owner_id, store_id: store.id, category_id: p.cat, title: p.title, description: p.desc, brand: p.brand,
      condition: p.cond, flaws: p.flaws ?? null, color: p.color, material: p.material ?? null, fit: p.fit ?? null, price_cents: p.price,
      compare_at_cents: p.was ?? null, tags: p.tags, attributes: {}, weight_grams: null, length_cm: null, width_cm: null, height_cm: null,
      offers_enabled: p.offers ?? true, status: "active", moderation_status: "ok", moderation_note: null, ai_assisted: false, is_demo: true,
      search_text: "", published_at: iso(p.daysAgo, i % 7), created_at: iso(p.daysAgo + 1), updated_at: iso(p.daysAgo),
    };
    row.search_text = [row.title, row.brand, row.color, row.material, row.tags.join(" "), row.category_id, row.description.slice(0, 500)]
      .map((x) => x ?? "").join(" ").toLowerCase();
    db.products.push(row);
    if (p.was) db.price_history.push({ product_id: id, old_cents: p.was, new_cents: p.price, changed_by: store.owner_id, created_at: iso(p.daysAgo - 0.5 > 0 ? p.daysAgo - 0.5 : 0) });
    [0, 1, 2].forEach((v) => db.images.push({ id: uuid(), product_id: id, url: `${p.art.split(":").slice(0, 4).join(":")}:${v}:${p.art.split(":")[5] ?? ""}`, storage_path: null, position: v, created_at: row.created_at }));
    p.variants.forEach(([size, color, qty], pos) => {
      const v = { id: uuid(), product_id: id, size, color, sku: null, price_cents: null, stock_on_hand: qty, stock_reserved: 0, is_active: true,
        position: pos + 1, created_at: row.created_at, updated_at: row.created_at };
      db.variants.push(v);
      db.movements.push({ id: ++db.seq.movement, variant_id: v.id, product_id: id, kind: "initial", on_hand_delta: qty, reserved_delta: 0,
        on_hand_after: qty, reserved_after: 0, order_id: null, reservation_id: null, actor_id: store.owner_id, note: "Alta de variante (demo)", created_at: row.created_at });
    });
  });

  const biz: { key: string; owner: string; slug: string; name: string; category: string; store: string; location: string; description: string; hours: Record<string, string> }[] = [
    { key: "glow", owner: "glowlab", slug: "glow-lab-studio", name: "Glow Lab Studio", category: "belleza", store: "glow", location: "Los Ángeles, CA",
      description: "Estudio de skincare con productos sellados y asesoría por mensaje. Negocio de demostración.", hours: { "Lun–Vie": "10:00–18:00", "Sáb": "11:00–15:00" } },
    { key: "sole", owner: "soletheory", slug: "sole-theory-lab", name: "Sole Theory Lab", category: "servicios", store: "sole", location: "Long Beach, CA",
      description: "Limpieza y restauración de sneakers, además de venta de pares seleccionados. Negocio de demostración.", hours: { "Mar–Sáb": "12:00–19:00" } },
    { key: "rack", owner: "rack41", slug: "rack-41-popup", name: "Rack 41 Pop-Up", category: "reventa", store: "rack41", location: "Downtown LA",
      description: "Pop-ups mensuales de streetwear de reventa. Negocio de demostración.", hours: { "Último sábado de cada mes": "12:00–18:00" } },
  ];
  const bizIds: Record<string, string> = {};
  for (const b of biz) {
    const id = uuid();
    bizIds[b.key] = id;
    db.businesses.push({ id, owner_id: ids[b.owner], store_id: storeIds[b.store], slug: b.slug, name: b.name, logo_url: null, cover_url: null,
      description: b.description, category: b.category, location: b.location, contact: { email: `${b.owner}@demo.marketzone` }, hours: b.hours,
      social_links: { instagram: "" }, customer_info: "Datos de demostración: no es un negocio real.", status: "active", is_demo: true,
      created_at: iso(20), updated_at: iso(20) });
  }

  const camp = (owner: string, kind: string, headline: string, extra: Partial<{ business_id: string; store_id: string; product_id: string; body: string; category_id: string }>, days = 14) => {
    db.campaigns.push({ id: uuid(), owner_id: ids[owner], business_id: extra.business_id ?? null, store_id: extra.store_id ?? null, product_id: extra.product_id ?? null,
      kind, category_id: extra.category_id ?? null, headline, body: extra.body ?? null, budget_cents: 2500, duration_days: days, starts_at: iso(2), ends_at: new Date(now.getTime() + (days - 2) * 864e5).toISOString(),
      status: "active", is_test: true, is_demo: true, review_note: "Campaña de demostración (sin cobro)", reviewed_by: null, reviewed_at: null, created_at: iso(3), updated_at: iso(2) });
  };
  camp("soletheory", "promoted_product", "Recién llegados en tallas US 8–10", { product_id: productIds[8] });
  camp("rack41", "promoted_product", "Hoodie heavyweight", { product_id: productIds[3] });
  camp("bolsoco", "promoted_product", "Crossbody para todos los días", { product_id: productIds[16] });
  camp("glowlab", "home_store", "Skincare sellado con asesoría", { business_id: bizIds.glow, store_id: storeIds.glow });
  camp("glowlab", "temporary_promo", "Semana de sets de viaje", { business_id: bizIds.glow, body: "Nuevos tamaños de viaje disponibles esta semana. Demo: sin descuentos." });
  camp("soletheory", "category_spotlight", "Sneakers destacados", { product_id: productIds[9], category_id: "sneakers" });

  db.seq.order = 100000;
  return db;
}
