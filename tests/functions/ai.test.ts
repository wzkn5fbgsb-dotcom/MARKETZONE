// Pruebas de las Edge Functions de IA contra el stack local, con un servidor simulado de la API de Claude.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { SupabaseBackend, memoryStore } from "../../src/api/supabase";
import { handler as listingHandler } from "../../supabase/functions/ai-listing/handler";
import { handler as marketingHandler } from "../../supabase/functions/ai-marketing/handler";

const URL = "http://127.0.0.1:54321";
const keys = JSON.parse(await Bun.file("/home/claude/localstack/keys.json").text());
let token = "";
let lastRequest: any = null;
let mock: ReturnType<typeof Bun.serve>;

const categories = [{ id: "ropa", name: "Ropa", parent_id: null }, { id: "ropa-sudaderas", name: "Sudaderas", parent_id: "ropa" }];
const img = { media_type: "image/jpeg", data: "/9j/4AAQSkZJRgABAQ==" };
const req = (body: unknown, auth = `Bearer ${token}`) =>
  new Request("http://x/functions/v1/ai-listing", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  const b = new SupabaseBackend(URL, keys.anon, memoryStore());
  await b.auth.signUp({ email: `ai.${Date.now()}@test.dev`, password: "Password123!" });
  token = b.auth.getSession()!.access_token;
  mock = Bun.serve({
    port: 0,
    async fetch(r) {
      lastRequest = { headers: Object.fromEntries(r.headers), body: await r.json() };
      const isTool = !!lastRequest.body.tools;
      return Response.json(isTool ? {
        content: [{ type: "tool_use", name: "proponer_publicacion", input: {
          titles: { search: "Sudadera negra con capucha talla M", descriptive: "Sudadera negra 100% auténtica con capucha", commercial: "Sudadera negra esencial", short: "Sudadera negra" },
          description: "Sudadera negra con capucha y bolsillo canguro. Confirma la talla.", category_id: "categoria-inventada",
          category_confidence: "media", attributes: [{ name: "Color", value: "Negro", certainty: "visible" }, { name: "Material", value: "Algodón", certainty: "seguro" }],
          keywords: ["Sudadera", "negra"], detected_brand: { value: null, certainty: "no_confirmado" }, condition_observations: ["Sin daños visibles en la parte frontal"],
          uncertainties: [], missing_info: ["Talla"], photo_tips: ["Fotografía la etiqueta"], clarity_tips: [], price: { min_cents: 4000, max_cents: 2500, note: "x" },
        } }],
      } : { content: [{ type: "text", text: '{"suggestions":[{"title":"Drop de otoño","text":"Nueva colección disponible"}],"notes":""}' }] });
    },
  });
  Object.assign(process.env, {
    SUPABASE_URL: URL, SUPABASE_ANON_KEY: keys.anon, SUPABASE_SERVICE_ROLE_KEY: keys.service,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${mock.port}`, AI_DAILY_LIMIT: "3",
  });
});
afterAll(() => { mock?.stop(true); delete process.env.ANTHROPIC_API_KEY; });

describe("IA para publicaciones", () => {
  test("sin clave configurada informa del estado y no simula ningún análisis", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await listingHandler(req({ images: [img], categories }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("ai_not_configured");
    expect(lastRequest).toBeNull();
  });

  test("rechaza llamadas sin sesión", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const res = await listingHandler(req({ images: [img], categories }, "Bearer invalido"));
    expect(res.status).toBe(401);
  });

  test("envía las imágenes al servidor de IA y devuelve una propuesta saneada para revisión", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const res = await listingHandler(req({ images: [img], categories, known: { size: "M" } }));
    expect(res.status).toBe(200);
    const { proposal } = await res.json();
    // Petición: clave solo en el servidor, imagen en base64, herramienta forzada
    expect(lastRequest.headers["x-api-key"]).toBe("test-key");
    expect(lastRequest.body.messages[0].content[0].type).toBe("image");
    expect(lastRequest.body.tool_choice).toEqual({ type: "tool", name: "proponer_publicacion" });
    expect(lastRequest.body.messages[0].content.at(-1).text).toContain("Talla: M");
    // Saneado: sin afirmaciones de autenticidad, categoría inválida descartada, certezas normalizadas
    expect(proposal.titles.descriptive).not.toMatch(/auténtic/i);
    expect(proposal.category_id).toBeNull();
    expect(proposal.attributes.find((a: any) => a.name === "Material").certainty).toBe("no_confirmado");
    expect(proposal.uncertainties.some((u: string) => /autenticidad/i.test(u))).toBe(true);
    expect(proposal.price.min_cents).toBe(2500);
    expect(proposal.price.max_cents).toBe(4000);
    expect(proposal.price.basis).toBe("estimacion_ia");
    expect(proposal.keywords).toEqual(["sudadera", "negra"]);
  });

  test("valida las fotos y aplica la cuota diaria", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect((await listingHandler(req({ images: [], categories }))).status).toBe(400);
    expect((await listingHandler(req({ images: [{ media_type: "application/pdf", data: "x" }], categories }))).status).toBe(400);
    await listingHandler(req({ images: [img], categories }));
    await listingHandler(req({ images: [img], categories }));
    const over = await listingHandler(req({ images: [img], categories }));
    expect(over.status).toBe(429);
    expect((await over.json()).code).toBe("ai_quota_exceeded");
  });
});

describe("IA para marketing", () => {
  test("genera sugerencias editables", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const res = await marketingHandler(new Request("http://x", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ task: "headlines", business: { name: "Rack 41", category: "moda" } }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suggestions[0].title).toBe("Drop de otoño");
    expect(lastRequest.body.messages[0].content.at(-1).text).toContain("no inventes descuentos");
  });
});
