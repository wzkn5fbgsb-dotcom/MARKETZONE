// Lógica compartida de IA para MARKETZONE (Edge Functions y versión de prueba).
// Reglas: no inventar modelos, tallas, materiales, autenticidad, defectos ni ventas comparables.

export interface ListingAiInput {
  category_hint?: string | null;
  known?: { brand?: string; size?: string; condition?: string; notes?: string; price_idea?: string };
  categories: { id: string; name: string; parent_id: string | null }[];
}

export interface ListingAiResult {
  titles: { search: string; descriptive: string; commercial: string; short: string };
  description: string;
  category_id: string | null;
  category_confidence: "alta" | "media" | "baja";
  attributes: { name: string; value: string; certainty: "visible" | "probable" | "no_confirmado" }[];
  keywords: string[];
  detected_brand: { value: string | null; certainty: "visible" | "probable" | "no_confirmado" };
  condition_observations: string[];
  uncertainties: string[];
  missing_info: string[];
  photo_tips: string[];
  clarity_tips: string[];
  price: { min_cents: number | null; max_cents: number | null; basis: "estimacion_ia"; note: string };
}

export const LISTING_TOOL = {
  name: "proponer_publicacion",
  description: "Devuelve la propuesta de publicación basada SOLO en lo que se ve en las fotos y en los datos del vendedor.",
  input_schema: {
    type: "object",
    properties: {
      titles: {
        type: "object",
        properties: { search: { type: "string" }, descriptive: { type: "string" }, commercial: { type: "string" }, short: { type: "string" } },
        required: ["search", "descriptive", "commercial", "short"],
      },
      description: { type: "string" },
      category_id: { type: ["string", "null"] },
      category_confidence: { type: "string", enum: ["alta", "media", "baja"] },
      attributes: {
        type: "array",
        items: { type: "object", properties: { name: { type: "string" }, value: { type: "string" }, certainty: { type: "string", enum: ["visible", "probable", "no_confirmado"] } }, required: ["name", "value", "certainty"] },
      },
      keywords: { type: "array", items: { type: "string" } },
      detected_brand: { type: "object", properties: { value: { type: ["string", "null"] }, certainty: { type: "string", enum: ["visible", "probable", "no_confirmado"] } }, required: ["value", "certainty"] },
      condition_observations: { type: "array", items: { type: "string" } },
      uncertainties: { type: "array", items: { type: "string" } },
      missing_info: { type: "array", items: { type: "string" } },
      photo_tips: { type: "array", items: { type: "string" } },
      clarity_tips: { type: "array", items: { type: "string" } },
      price: {
        type: "object",
        properties: { min_cents: { type: ["integer", "null"] }, max_cents: { type: ["integer", "null"] }, note: { type: "string" } },
        required: ["min_cents", "max_cents", "note"],
      },
    },
    required: ["titles", "description", "category_id", "category_confidence", "attributes", "keywords", "detected_brand",
      "condition_observations", "uncertainties", "missing_info", "photo_tips", "clarity_tips", "price"],
  },
} as const;

export function listingPrompt(input: ListingAiInput, imageCount: number): string {
  const cats = input.categories.filter((c) => c.parent_id).map((c) => `${c.id} (${c.name})`).join(", ");
  const known = input.known ?? {};
  return [
    `Eres el asistente de publicaciones de MARKETZONE, un marketplace de moda, sneakers, streetwear, accesorios, bolsos y belleza.`,
    `Analiza ${imageCount} fotografía(s) de UN artículo y propone una publicación en español para que el vendedor la revise.`,
    ``,
    `REGLAS OBLIGATORIAS:`,
    `- Describe solo lo que se ve. No inventes modelos concretos, colaboraciones, tallas, materiales, años ni medidas.`,
    `- No afirmes que el artículo es auténtico ni original basándote en fotos. Nunca uses "100% auténtico" ni similares.`,
    `- No inventes defectos ni digas que está "en perfecto estado" si no se puede comprobar; lista lo observado en condition_observations.`,
    `- Marca cada atributo con certainty: "visible" (claramente en la foto), "probable" o "no_confirmado".`,
    `- La marca solo es "visible" si el logotipo o la etiqueta se leen con claridad.`,
    `- Si algo importante no se puede saber por la foto (talla, material, medidas, autenticidad, defectos ocultos), añádelo a missing_info o uncertainties.`,
    `- Precio: solo una estimación orientativa en centavos de USD (min_cents y max_cents) si hay datos suficientes; si no, null.`,
    `  NUNCA menciones ventas comparables ni precios de transacciones: no tienes acceso a datos de ventas reales. La nota debe decir que es una estimación de la IA.`,
    `- category_id debe ser uno de estos ids o null: ${cats}.`,
    `- Títulos: "search" optimizado para búsquedas (marca + tipo + color + talla si el vendedor la dio), "descriptive", "commercial" (atractivo, sin exagerar ni prometer) y "short" (máx. 40 caracteres). Máximo 80 caracteres cada uno.`,
    `- description: 3–6 frases claras, con lo verificable; termina recordando confirmar talla y medidas si no se dieron.`,
    `- keywords: 5–12 palabras clave en minúsculas.`,
    `- photo_tips: consejos concretos para mejorar las fotos (luz, fondo, etiqueta, suela, defectos de cerca).`,
    ``,
    `DATOS DEL VENDEDOR (tienen prioridad sobre tu interpretación):`,
    `- Categoría sugerida: ${input.category_hint ?? "no indicada"}`,
    `- Marca: ${known.brand || "no indicada"}`,
    `- Talla: ${known.size || "no indicada"}`,
    `- Estado declarado: ${known.condition || "no indicado"}`,
    `- Notas: ${known.notes || "ninguna"}`,
    `- Idea de precio: ${known.price_idea || "ninguna"}`,
  ].join("\n");
}

export const JSON_SHAPE_HINT = `Responde SOLO con un objeto JSON con esta forma:
{"titles":{"search":"","descriptive":"","commercial":"","short":""},"description":"","category_id":null,"category_confidence":"media",
"attributes":[{"name":"","value":"","certainty":"visible"}],"keywords":[],"detected_brand":{"value":null,"certainty":"no_confirmado"},
"condition_observations":[],"uncertainties":[],"missing_info":[],"photo_tips":[],"clarity_tips":[],"price":{"min_cents":null,"max_cents":null,"note":""}}`;

const str = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strArr = (v: unknown, n = 12, max = 200) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);
const BANNED = /(100\s*%\s*(aut[eé]ntic|original)|garantizad[oa] aut[eé]ntic|autenticidad garantizada|perfecto estado)/gi;

/** Normaliza y sanea la respuesta del modelo (nunca se confía ciegamente en ella). */
export function normalizeListingResult(raw: any, validCategoryIds: string[]): ListingAiResult {
  const certainty = (c: unknown) => (c === "visible" || c === "probable" ? c : "no_confirmado") as "visible" | "probable" | "no_confirmado";
  const clean = (s: string) => s.replace(BANNED, "").replace(/\s{2,}/g, " ").trim();
  const titles = raw?.titles ?? {};
  const cat = typeof raw?.category_id === "string" && validCategoryIds.includes(raw.category_id) ? raw.category_id : null;
  const min = Number.isInteger(raw?.price?.min_cents) && raw.price.min_cents > 0 ? raw.price.min_cents : null;
  const max = Number.isInteger(raw?.price?.max_cents) && raw.price.max_cents > 0 ? raw.price.max_cents : null;
  const uncertainties = strArr(raw?.uncertainties);
  if (!uncertainties.some((u) => /autentic/i.test(u))) uncertainties.push("La autenticidad no se puede verificar a partir de fotografías.");
  return {
    titles: {
      search: clean(str(titles.search, 80)), descriptive: clean(str(titles.descriptive, 80)),
      commercial: clean(str(titles.commercial, 80)), short: clean(str(titles.short, 40)),
    },
    description: clean(str(raw?.description, 1500)),
    category_id: cat,
    category_confidence: ["alta", "media", "baja"].includes(raw?.category_confidence) ? raw.category_confidence : "baja",
    attributes: (Array.isArray(raw?.attributes) ? raw.attributes : []).slice(0, 12)
      .map((a: any) => ({ name: str(a?.name, 40), value: str(a?.value, 80), certainty: certainty(a?.certainty) })).filter((a: any) => a.name && a.value),
    keywords: strArr(raw?.keywords, 12, 30).map((k) => k.toLowerCase()),
    detected_brand: { value: str(raw?.detected_brand?.value, 60) || null, certainty: certainty(raw?.detected_brand?.certainty) },
    condition_observations: strArr(raw?.condition_observations).map(clean),
    uncertainties,
    missing_info: strArr(raw?.missing_info),
    photo_tips: strArr(raw?.photo_tips, 6),
    clarity_tips: strArr(raw?.clarity_tips, 6),
    price: {
      min_cents: min !== null && max !== null && min > max ? max : min,
      max_cents: min !== null && max !== null && min > max ? min : max,
      basis: "estimacion_ia",
      note: "Estimación orientativa generada por IA. No se basa en ventas comparables verificadas. Tú decides el precio final.",
    },
  };
}

// ------------------------------------------------------------------ marketing
export type MarketingTask = "headlines" | "promo_text" | "campaign_ideas" | "improve_description" | "suggest_products" | "interpret_stats";

export interface MarketingInput {
  task: MarketingTask;
  business?: { name?: string; category?: string; description?: string };
  product?: { title?: string; description?: string; price_cents?: number };
  text?: string;
  products?: { id: string; title: string; price_cents: number; available: number; favorites?: number }[];
  stats?: Record<string, unknown>;
}

export function marketingPrompt(i: MarketingInput): string {
  const base = [
    `Eres el asistente de marketing de MARKETZONE. Responde en español, con tono claro y comercial pero honesto.`,
    `REGLAS: no inventes descuentos, precios, testimonios, reseñas, cifras de ventas ni resultados. No prometas resultados.`,
    `Si faltan datos, dilo en "notes". Todo será revisado y editado por el negocio antes de usarse.`,
    `Responde SOLO con JSON: {"suggestions":[{"title":"","text":""}],"notes":""}`,
  ];
  const ctx = JSON.stringify({ business: i.business, product: i.product, text: i.text, products: i.products?.slice(0, 30), stats: i.stats }).slice(0, 6000);
  const tasks: Record<MarketingTask, string> = {
    headlines: "Propón 5 titulares de campaña (máx. 70 caracteres).",
    promo_text: "Escribe 3 textos promocionales cortos (máx. 280 caracteres) para una campaña.",
    campaign_ideas: "Propón 4 ideas de campaña concretas, cada una con objetivo y formato sugerido.",
    improve_description: "Mejora la descripción dada: 2 versiones más claras y atractivas, sin añadir datos que no estén en el texto original.",
    suggest_products: "De la lista de productos, sugiere hasta 3 para promocionar y explica el motivo con los datos dados (stock, precio, favoritos). No inventes datos.",
    interpret_stats: "Interpreta las estadísticas dadas en 3–5 observaciones prácticas. Recuerda que impresiones no son ventas.",
  };
  return [...base, `TAREA: ${tasks[i.task] ?? tasks.headlines}`, `DATOS: ${ctx}`].join("\n");
}

export function normalizeMarketing(raw: any) {
  const clean = (s: string) => s.replace(BANNED, "").trim();
  return {
    suggestions: (Array.isArray(raw?.suggestions) ? raw.suggestions : []).slice(0, 6)
      .map((s: any) => ({ title: clean(str(s?.title, 120)), text: clean(str(s?.text, 800)) })).filter((s: any) => s.title || s.text),
    notes: str(raw?.notes, 600),
  };
}
