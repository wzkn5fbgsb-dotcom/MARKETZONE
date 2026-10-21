// Utilidades comunes de las Edge Functions (compatibles con Deno y con Bun en pruebas).
declare const Deno: { env: { get(k: string): string | undefined } } | undefined;

export function env(name: string): string | undefined {
  try {
    if (typeof Deno !== "undefined") return Deno.env.get(name);
  } catch { /* sin permisos de entorno */ }
  return (globalThis as any).process?.env?.[name];
}

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });

/** Verifica el token del usuario contra Supabase Auth y devuelve su id. */
export async function requireUser(req: Request): Promise<string | Response> {
  const auth = req.headers.get("authorization") ?? "";
  const url = env("SUPABASE_URL");
  const anon = env("SUPABASE_ANON_KEY");
  if (!url || !anon) return json(500, { code: "server_misconfigured", message: "Faltan SUPABASE_URL o SUPABASE_ANON_KEY en el servidor." });
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, authorization: auth } });
  if (!res.ok) return json(401, { code: "auth_required", message: "Inicia sesión para usar la IA." });
  const user = await res.json();
  return String(user.id);
}

/** Registra un uso de IA y comprueba la cuota diaria (con la clave de servicio, nunca expuesta al navegador). */
export async function checkQuota(userId: string, feature: string, limit: number): Promise<Response | null> {
  const url = env("SUPABASE_URL");
  const service = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return json(500, { code: "server_misconfigured", message: "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor." });
  const res = await fetch(`${url}/rest/v1/rpc/ai_usage_hit`, {
    method: "POST",
    headers: { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json" },
    body: JSON.stringify({ p_user: userId, p_feature: feature, p_daily_limit: limit }),
  });
  if (!res.ok) return json(500, { code: "quota_error", message: "No se pudo comprobar la cuota de IA." });
  const q = await res.json();
  if (!q.allowed) return json(429, { code: "ai_quota_exceeded", message: `Alcanzaste el límite diario de ${limit} usos de IA. Vuelve mañana.` });
  return null;
}

/** Llama a la API de Claude forzando una herramienta para obtener JSON estructurado. */
export async function callClaude(opts: {
  prompt: string;
  images?: { media_type: string; data: string }[];
  tool?: { name: string; description: string; input_schema: unknown };
  maxTokens?: number;
}): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) {
    return { ok: false, response: json(503, { code: "ai_not_configured", message: "La IA no está configurada en el servidor. Puedes completar la publicación manualmente." }) };
  }
  const base = env("ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com";
  const model = env("AI_MODEL") ?? "claude-sonnet-5-5";
  const content: unknown[] = (opts.images ?? []).map((img) => ({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } }));
  content.push({ type: "text", text: opts.prompt });
  const body: Record<string, unknown> = { model, max_tokens: opts.maxTokens ?? 2000, messages: [{ role: "user", content }] };
  if (opts.tool) { body.tools = [opts.tool]; body.tool_choice = { type: "tool", name: opts.tool.name }; }
  let res: Response;
  try {
    res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, response: json(502, { code: "ai_unreachable", message: "No se pudo contactar con el servicio de IA. Inténtalo de nuevo." }) };
  }
  if (!res.ok) {
    const status = res.status === 429 ? 429 : 502;
    return { ok: false, response: json(status, { code: status === 429 ? "ai_busy" : "ai_error", message: status === 429 ? "El servicio de IA está ocupado. Inténtalo en un minuto." : "El servicio de IA respondió con un error." }) };
  }
  const out = await res.json();
  const block = (out.content ?? []).find((c: any) => c.type === "tool_use") ?? null;
  if (opts.tool) {
    if (!block) return { ok: false, response: json(502, { code: "ai_bad_output", message: "La IA no devolvió una propuesta válida." }) };
    return { ok: true, data: block.input };
  }
  const text = (out.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  try {
    const start = text.search(/[{[]/);
    return { ok: true, data: JSON.parse(text.slice(start, Math.max(text.lastIndexOf("}"), text.lastIndexOf("]")) + 1)) };
  } catch {
    return { ok: false, response: json(502, { code: "ai_bad_output", message: "La IA no devolvió un resultado válido." }) };
  }
}
