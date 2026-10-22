// IA de subastas de MARKETXONE: prompt y normalización compartidos por la web y la Edge Function "ai-auction".
// Reglas: describir solo lo visible, no inventar marca, talla, medidas ni autenticidad.
/* eslint-disable no-var */

export const MX_MEASURE_HINTS = ["Largo", "Ancho (axila a axila)", "Hombros", "Manga", "Cintura", "Cadera", "Tiro", "Entrepierna", "Largo de plantilla", "Alto", "Ancho", "Fondo", "Correa"];

export interface AuctionAiInput {
  category_hint?: string | null;
  known?: { brand?: string; size?: string; condition?: string; notes?: string };
  categories: { id: string; name: string; parent_id: string | null }[];
}

export interface AuctionAiResult {
  title: string;
  brand: { value: string | null; certainty: string };
  category_id: string | null;
  category_confidence: string;
  size: { value: string | null; source: string };
  color: string;
  material: { value: string | null; certainty: string };
  condition: string | null;
  condition_confidence: string;
  flaws: string[];
  description: string;
  measurements: string[];
  price: { min_cents: number | null; max_cents: number | null };
  start_price_cents: number | null;
  missing_info: string[];
  photo_tips: string[];
}

const MX_AI_SHAPE = 'Responde SOLO con un objeto JSON con esta forma exacta:\n' +
  '{"title":"","brand":{"value":null,"certainty":"no_confirmado"},"category_id":null,"category_confidence":"media",' +
  '"size":{"value":null,"source":"no_visible"},"color":"","material":{"value":null,"certainty":"no_confirmado"},' +
  '"condition":null,"condition_confidence":"media","flaws":[],"description":"","measurements":[],' +
  '"price":{"min_cents":null,"max_cents":null},"start_price_cents":null,"missing_info":[],"photo_tips":[]}';


export function auctionPrompt(e: AuctionAiInput, n: number): string {
  var cats = (e.categories || []).filter(function (c: any) { return c.parent_id; }).map(function (c: any) { return c.id + " (" + c.name + ")"; }).join(", ");
  var k: any = e.known || {};
  return [
    "Eres el experto en publicaciones de MARKETXONE, un marketplace de moda, sneakers, streetwear, accesorios, bolsos y belleza.",
    "Analiza con mucho cuidado " + n + " fotografía(s) de UN artículo que se va a SUBASTAR y llena la publicación en español lo más precisa posible. El vendedor la revisará antes de publicar.",
    "",
    "CÓMO ANALIZAR:",
    "- Revisa cada foto: tipo de prenda o artículo, corte, color exacto (p. ej. \"negro deslavado\", \"crema\"), estampados, logotipos, etiquetas, costuras, herrajes, suela, materiales y desgaste.",
    "- Lee todo el texto visible en etiquetas (marca, talla, composición, país). Si una etiqueta se lee, úsala.",
    "",
    "REGLAS OBLIGATORIAS:",
    "- Describe solo lo que se ve. No inventes modelos concretos, colaboraciones, años ni ediciones.",
    "- brand.certainty: \"visible\" solo si el logotipo o la etiqueta se lee con claridad; \"probable\" si se intuye; si no, \"no_confirmado\" y value null.",
    "- size.source: \"etiqueta\" solo si la talla se lee en una etiqueta; si no, \"no_visible\" y value null. Nunca adivines la talla.",
    "- Nunca afirmes que es auténtico u original. No uses \"100% auténtico\", \"original garantizado\" ni \"perfecto estado\".",
    "- condition: uno de estos valores o null: new_with_tags (sin usar, con etiquetas de tienda visibles), new_without_tags (sin usar, sin etiquetas), used_excellent (uso mínimo, sin defectos visibles), used_good (señales normales de uso), used_flawed (tiene defectos visibles).",
    "- Si ves cualquier defecto (manchas, hoyos, bolitas, decoloración, suela gastada, raspones, costuras abiertas), usa used_flawed y escribe cada uno en flaws indicando en qué foto se ve (p. ej. \"Mancha pequeña en el puño izquierdo (foto 2)\").",
    "- measurements: NO inventes números. Solo lista de 2 a 4 nombres de las medidas que el vendedor debe tomar para este tipo de artículo, elegidos de: Largo, Ancho (axila a axila), Hombros, Manga, Cintura, Cadera, Tiro, Entrepierna, Largo de plantilla, Alto, Ancho, Fondo, Correa.",
    "- title: máximo 80 caracteres, optimizado para búsquedas: marca (solo si es visible) + tipo + color + detalle clave + talla (solo si se leyó o la dio el vendedor).",
    "- description: 3 a 5 frases claras y naturales: qué es, color y material (solo si se ve o se lee), estilo o corte, estado real con lo observado y qué incluye. Termina pidiendo revisar fotos y medidas.",
    "- category_id: uno de estos ids o null: " + cats + ".",
    "- price: estimación orientativa en centavos de USD (min_cents, max_cents) solo si hay datos suficientes; si no, null. No tienes acceso a ventas reales: no menciones ventas comparables.",
    "- start_price_cents: precio inicial sugerido para la subasta, en dólares enteros (múltiplo de 100), conservador (aprox. 40–60% de min_cents) para atraer pujas; mínimo 100. null si no hay precio.",
    "- missing_info: lo que el vendedor debe confirmar porque no se ve (talla, material, medidas, defectos ocultos).",
    "- photo_tips: hasta 4 consejos concretos de fotos que faltan (etiqueta, suela, defecto de cerca, espalda).",
    "",
    "DATOS DEL VENDEDOR (tienen prioridad sobre tu interpretación):",
    "- Categoría elegida: " + (e.category_hint || "no indicada"),
    "- Marca: " + (k.brand || "no indicada"),
    "- Talla: " + (k.size || "no indicada"),
    "- Estado declarado: " + (k.condition || "no indicado"),
    "- Notas: " + (k.notes || "ninguna"),
    "",
    MX_AI_SHAPE
  ].join("\n");
}

const MX_AI_BAN = /(100\s*%\s*(aut[eé]ntic[oa]s?|original(es)?)|garantizad[oa]s?\s+aut[eé]ntic[oa]s?|autenticidad garantizada|original(es)?\s+garantizad[oa]s?|(en\s+)?perfecto estado)/gi;
function aiStr(v: unknown, max?: number): string {
  if (typeof v !== "string") return "";
  var parts = v.split(/(?<=[.!?])\s+/), keep = parts.filter(function (x: string) { MX_AI_BAN.lastIndex = 0; return !MX_AI_BAN.test(x); });
  var t = (parts.length > 1 && keep.length ? keep.join(" ") : v).replace(MX_AI_BAN, "");
  return t.replace(/\s+([.,;:])/g, "$1").replace(/([,;:])[,;:]+/g, "$1").replace(/(^|[.!?])\s*[.,;:]+/g, "$1").replace(/\s{2,}/g, " ").trim().slice(0, max || 400);
}
function aiList(v: unknown, n?: number, max?: number): string[] { return Array.isArray(v) ? v.map(function (x) { return aiStr(x, max || 200); }).filter(Boolean).slice(0, n || 8) : []; }
function aiCert(v: unknown): string { return v === "visible" || v === "probable" ? v : "no_confirmado"; }

export function normalizeAuctionResult(e: any, catIds: string[]): AuctionAiResult {
  e = e || {};
  var conds = ["new_with_tags", "new_without_tags", "used_excellent", "used_good", "used_flawed"];
  var min = Number.isInteger(e.price && e.price.min_cents) && e.price.min_cents > 0 ? e.price.min_cents : null;
  var max = Number.isInteger(e.price && e.price.max_cents) && e.price.max_cents > 0 ? e.price.max_cents : null;
  if (min && max && min > max) { var t = min; min = max; max = t; }
  var raw = Number(e.start_price_cents);
  var start: number | null = Number.isFinite(raw) && raw >= 100 ? Math.max(100, Math.round(raw / 100) * 100) : (min ? Math.max(100, Math.round(min * 0.5 / 100) * 100) : null);
  if (start && start > 10000000) start = null;
  var flaws = aiList(e.flaws, 8, 160);
  var cond = conds.indexOf(e.condition) >= 0 ? e.condition : null;
  if (flaws.length && cond && cond !== "used_flawed") cond = "used_flawed";
  var hints = MX_MEASURE_HINTS;
  var meas = aiList(e.measurements, 4, 30).map(function (m) {
    var hit = hints.filter(function (h) { return h.toLowerCase() === m.toLowerCase(); })[0];
    return hit || m;
  }).filter(function (m, i, a) { return a.indexOf(m) === i; });
  var sizeSrc = e.size && e.size.source === "etiqueta" ? "etiqueta" : "no_visible";
  var missing = aiList(e.missing_info, 6, 160);
  if (!missing.some(function (x) { return /autentic/i.test(x); })) missing.push("La autenticidad no se puede verificar con fotos.");
  return {
    title: aiStr(e.title, 80),
    brand: { value: aiStr(e.brand && e.brand.value, 60) || null, certainty: aiCert(e.brand && e.brand.certainty) },
    category_id: typeof e.category_id === "string" && catIds.indexOf(e.category_id) >= 0 ? e.category_id : null,
    category_confidence: ["alta", "media", "baja"].indexOf(e.category_confidence) >= 0 ? e.category_confidence : "baja",
    size: { value: sizeSrc === "etiqueta" ? aiStr(e.size && e.size.value, 20) || null : null, source: sizeSrc },
    color: aiStr(e.color, 40),
    material: { value: aiStr(e.material && e.material.value, 60) || null, certainty: aiCert(e.material && e.material.certainty) },
    condition: cond,
    condition_confidence: ["alta", "media", "baja"].indexOf(e.condition_confidence) >= 0 ? e.condition_confidence : "baja",
    flaws: flaws,
    description: aiStr(e.description, 1500),
    measurements: meas,
    price: { min_cents: min, max_cents: max },
    start_price_cents: start,
    missing_info: missing,
    photo_tips: aiList(e.photo_tips, 4, 160)
  };
}

