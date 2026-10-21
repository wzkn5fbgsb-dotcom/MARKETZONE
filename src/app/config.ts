// Configuración en tiempo de compilación (esbuild define) con posibilidad de sobrescribir en tiempo de ejecución
// mediante window.__MZ_CONFIG__ (útil para desplegar la misma build en distintos entornos).
declare const __MZ_BUILD__: { mode: "auto" | "demo" | "supabase"; router: "hash" | "history"; supabaseUrl: string; supabaseAnonKey: string; target: string; version: string };

export interface AppConfig {
  mode: "demo" | "supabase";
  router: "hash" | "history";
  supabaseUrl: string;
  supabaseAnonKey: string;
  target: string; // "web" | "artifact"
  version: string;
}

export function loadConfig(): AppConfig {
  const build = typeof __MZ_BUILD__ !== "undefined" ? __MZ_BUILD__
    : { mode: "auto" as const, router: "hash" as const, supabaseUrl: "", supabaseAnonKey: "", target: "web", version: "dev" };
  const runtime = (globalThis as any).__MZ_CONFIG__ ?? {};
  const supabaseUrl = String(runtime.supabaseUrl ?? build.supabaseUrl ?? "");
  const supabaseAnonKey = String(runtime.supabaseAnonKey ?? build.supabaseAnonKey ?? "");
  const wanted = runtime.mode ?? build.mode;
  const mode = wanted === "demo" ? "demo" : wanted === "supabase" ? "supabase" : supabaseUrl && supabaseAnonKey ? "supabase" : "demo";
  return { mode, router: runtime.router ?? build.router ?? "hash", supabaseUrl, supabaseAnonKey, target: build.target, version: build.version };
}
