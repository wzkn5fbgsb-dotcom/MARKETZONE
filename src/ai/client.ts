// Cliente de IA de la web. Nunca contiene claves: en producción llama a la Edge Function del servidor;
// en la versión publicada en Claude usa la capacidad "sample" del visor (IA real, con consentimiento).
import type { Backend } from "../api/backend";
import { ApiError } from "../api/backend";
import type { AiProvider } from "../api/demo/backend";
import { JSON_SHAPE_HINT, listingPrompt, marketingPrompt, normalizeListingResult, normalizeMarketing,
  type ListingAiInput, type ListingAiResult, type MarketingInput } from "../../supabase/functions/_shared/listing-ai";
import { blobFor, compressImage, toBase64 } from "../app/images";
import { t } from "../i18n";

export type { ListingAiResult, MarketingInput };

export interface AiStatus { available: boolean; reason: string; provider: "server" | "claude-viewer" | "none" }

export async function aiStatus(backend: Backend): Promise<AiStatus> {
  if (backend.mode === "demo") {
    const ok = await artifactAi.available();
    return ok ? { available: true, reason: t("Análisis real con Claude desde el visor (se pide permiso al usarlo)."), provider: "claude-viewer" }
      : { available: false, reason: t("La IA no está disponible en esta versión de demostración fuera de Claude. Puedes publicar manualmente."), provider: "none" };
  }
  try {
    await backend.invokeFunction("ai-listing", { ping: true });
    return { available: true, reason: t("IA del servidor activa."), provider: "server" };
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 400 || err.status === 401) return { available: true, reason: t("IA del servidor activa."), provider: "server" };
    return { available: false, reason: err.code === "ai_not_configured" ? t("La IA no está configurada en el servidor (falta la clave). Puedes publicar manualmente.")
      : t("La función de IA no está desplegada todavía. Puedes publicar manualmente."), provider: "none" };
  }
}

export async function analyzeListing(backend: Backend, imageUrls: string[], input: ListingAiInput): Promise<ListingAiResult> {
  const blobs = (await Promise.all(imageUrls.slice(0, 6).map((u) => blobFor(u)))).filter(Boolean) as Blob[];
  if (!blobs.length) throw new ApiError("validation", t("Añade al menos una fotografía para analizar."));
  if (backend.mode === "demo") {
    const small = await Promise.all(blobs.map((b) => compressImage(b, 1280, 0.82).catch(() => b)));
    const res = await backend.invokeFunction<{ proposal: ListingAiResult }>("ai-listing", { blobs: small, input });
    return res.proposal;
  }
  const images = await Promise.all(blobs.map(async (b) => ({ media_type: "image/jpeg", data: await toBase64(await compressImage(b, 1024, 0.8)) })));
  const res = await backend.invokeFunction<{ proposal: ListingAiResult }>("ai-listing", { images, ...input });
  return res.proposal;
}

export async function marketingSuggestions(backend: Backend, input: MarketingInput) {
  return backend.invokeFunction<{ suggestions: { title: string; text: string }[]; notes: string }>("ai-marketing", input);
}

// ------------------------------------------------------------------ proveedor del visor de Claude
type SampleFn = ((input: string, opts?: Record<string, unknown>) => Promise<{ text: string }>) & {
  json: <T>(input: string, opts?: Record<string, unknown>) => Promise<T>;
  limits: () => Promise<{ images?: { maxCount: number; mediaTypes: string[] } }>;
};

let samplePromise: Promise<SampleFn | null> | null = null;
function getSample(): Promise<SampleFn | null> {
  if (!samplePromise) {
    const claude = (globalThis as any).claude;
    samplePromise = claude?.use ? (claude.use("sample") as Promise<SampleFn | null>).catch(() => null) : Promise.resolve(null);
  }
  return samplePromise;
}

const SAMPLE_ERRORS: Record<string, string> = {
  not_granted: t("No se concedió permiso para usar Claude en esta página. Puedes publicar manualmente."),
  sampling_disabled: t("Claude no está disponible para esta cuenta."),
  rate_limited: t("Demasiadas solicitudes a la IA. Espera un momento e inténtalo de nuevo."),
  image_rejected: t("Una de las fotos no se pudo procesar. Prueba con otra."),
  images_unavailable: t("Esta vista no puede enviar fotos a la IA."),
  invalid_json: t("La IA no devolvió un resultado válido. Inténtalo de nuevo."),
  refused: t("La IA no pudo analizar estas fotos."),
};

export const artifactAi: AiProvider = {
  async available() {
    const s = await getSample();
    if (!s) return false;
    try { return !!(await s.limits())?.images; } catch { return false; }
  },
  async invoke(name, body: any) {
    const s = await getSample();
    if (!s) throw new ApiError("ai_not_configured", t("La IA no está disponible en esta versión."), null, 503);
    try {
      if (name === "ai-listing") {
        const input = body.input as ListingAiInput;
        const raw = await s.json(listingPrompt(input, body.blobs.length) + "\n\n" + JSON_SHAPE_HINT, { images: body.blobs, modelTier: "default" });
        return { proposal: normalizeListingResult(raw, input.categories.map((c) => c.id)), provider: "claude-viewer" };
      }
      if (name === "ai-marketing") {
        const raw = await s.json(marketingPrompt(body as MarketingInput), { modelTier: "quick", cache: false });
        return normalizeMarketing(raw);
      }
    } catch (e: any) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(String(e?.code ?? "ai_error"), SAMPLE_ERRORS[e?.code] ?? t("La IA no respondió. Inténtalo de nuevo o continúa manualmente."));
    }
    throw new ApiError("not_found", t("Función de IA desconocida."));
  },
};
