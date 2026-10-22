// Edge Function: asistente de servicio al cliente. Recibe la conversación, las respuestas aprobadas por el
// equipo y los datos de la propia persona, y devuelve una respuesta que nunca promete reembolsos.
// La clave ANTHROPIC_API_KEY vive solo en el servidor.
import { CORS, callClaude, checkQuota, env, json, requireUser } from "../_shared/http.ts";
import { normalizeSupportResult, supportPrompt } from "../_shared/support-ai.ts";

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { code: "method_not_allowed", message: "Usa POST." });
  if (!env("ANTHROPIC_API_KEY")) {
    return json(503, { code: "ai_not_configured", message: "La IA no está configurada en el servidor." });
  }
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  let body: any;
  try { body = await req.json(); } catch { return json(400, { code: "validation", message: "Solicitud no válida." }); }
  if (body?.ping) return json(200, { ok: true });
  const input = body?.input ?? {};
  const history = Array.isArray(input.history) ? input.history.slice(-12).map((m: any) => ({ role: String(m?.role ?? ""), body: String(m?.body ?? "").slice(0, 2000) })) : [];
  if (!history.length) return json(400, { code: "validation", message: "Falta el mensaje." });
  const kb = Array.isArray(input.kb) ? input.kb.slice(0, 40).map((k: any) => ({ id: String(k?.id ?? ""), question: String(k?.question ?? "").slice(0, 300), answer: String(k?.answer ?? "").slice(0, 3000) })) : [];
  const quota = await checkQuota(user, "support", Number(env("AI_SUPPORT_DAILY_LIMIT") ?? 80));
  if (quota) return quota;

  const ctx = { history, kb, settings: input.settings ?? {}, user: input.user ?? {}, lang_name: typeof input.lang_name === "string" ? input.lang_name.slice(0, 40) : "español" };
  const result = await callClaude({ prompt: supportPrompt(ctx), maxTokens: 900 });
  if (!result.ok) return result.response;
  return json(200, normalizeSupportResult(result.data, kb.map((k: { id: string }) => k.id)));
}
