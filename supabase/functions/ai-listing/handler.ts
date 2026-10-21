// Edge Function: análisis de fotos y propuesta de publicación con IA.
// La clave ANTHROPIC_API_KEY vive solo en el servidor (secreto de Supabase).
import { CORS, callClaude, checkQuota, env, json, requireUser } from "../_shared/http.ts";
import { LISTING_TOOL, listingPrompt, normalizeListingResult, type ListingAiInput } from "../_shared/listing-ai.ts";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { code: "method_not_allowed", message: "Usa POST." });
  if (!env("ANTHROPIC_API_KEY")) {
    return json(503, { code: "ai_not_configured", message: "La IA no está configurada en el servidor. Puedes completar la publicación manualmente." });
  }
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  let body: any;
  try { body = await req.json(); } catch { return json(400, { code: "validation", message: "Solicitud no válida." }); }
  const images: { media_type: string; data: string }[] = Array.isArray(body?.images) ? body.images : [];
  if (images.length < 1 || images.length > 6) return json(400, { code: "validation", message: "Envía entre 1 y 6 fotografías." });
  for (const img of images) {
    if (!ALLOWED.includes(img?.media_type) || typeof img?.data !== "string" || img.data.length > 2_000_000) {
      return json(400, { code: "validation", message: "Cada foto debe ser JPG, PNG o WebP y pesar menos de 1,5 MB." });
    }
  }
  const categories: ListingAiInput["categories"] = Array.isArray(body?.categories) ? body.categories.slice(0, 200) : [];
  const quota = await checkQuota(user, "listing", Number(env("AI_DAILY_LIMIT") ?? 40));
  if (quota) return quota;

  const input: ListingAiInput = { category_hint: body?.category_hint ?? null, known: body?.known ?? {}, categories };
  const result = await callClaude({ prompt: listingPrompt(input, images.length), images, tool: LISTING_TOOL as any, maxTokens: 2500 });
  if (!result.ok) return result.response;
  return json(200, { proposal: normalizeListingResult(result.data, categories.map((c) => c.id)), provider: "claude", generated_at: new Date().toISOString() });
}
