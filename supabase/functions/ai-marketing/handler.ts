// Edge Function: textos y sugerencias de marketing con IA (siempre revisables por el negocio).
import { CORS, callClaude, checkQuota, env, json, requireUser } from "../_shared/http.ts";
import { marketingPrompt, normalizeMarketing, type MarketingInput } from "../_shared/listing-ai.ts";

const TASKS = ["headlines", "promo_text", "campaign_ideas", "improve_description", "suggest_products", "interpret_stats"];

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { code: "method_not_allowed", message: "Usa POST." });
  if (!env("ANTHROPIC_API_KEY")) {
    return json(503, { code: "ai_not_configured", message: "La IA de marketing no está configurada en el servidor." });
  }
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  let body: MarketingInput;
  try { body = await req.json(); } catch { return json(400, { code: "validation", message: "Solicitud no válida." }); }
  if (!TASKS.includes(body?.task)) return json(400, { code: "validation", message: "Tarea de marketing no válida." });
  const quota = await checkQuota(user, "marketing", Number(env("AI_DAILY_LIMIT") ?? 40));
  if (quota) return quota;
  const result = await callClaude({ prompt: marketingPrompt(body), maxTokens: 1500 });
  if (!result.ok) return result.response;
  return json(200, { ...normalizeMarketing(result.data), provider: "claude", generated_at: new Date().toISOString() });
}
