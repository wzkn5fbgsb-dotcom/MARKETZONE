import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppProvider } from "./app/state";
import { loadConfig } from "./app/config";
import { setRouterMode } from "./app/router";
import { ToastProvider } from "./ui/kit";
import { SupabaseBackend, browserStore } from "./api/supabase";
import type { Backend } from "./api/backend";
import type { DemoRuntime } from "./api/demo/persist";
import { setLocalImageResolver } from "./app/images";
import { LOGO_SVG } from "./components/brand";
import "./styles.css";

async function boot() {
  const config = loadConfig();
  setRouterMode(config.router);
  let backend: Backend;
  let demo: DemoRuntime | null = null;
  if (config.mode === "supabase") {
    backend = new SupabaseBackend(config.supabaseUrl, config.supabaseAnonKey, browserStore);
  } else {
    const [{ openDemo }, { DemoBackend }, { artifactAi }] = await Promise.all([import("./api/demo/persist"), import("./api/demo/backend"), import("./ai/client")]);
    demo = await openDemo();
    const db = new DemoBackend(demo.engine, browserStore, demo.images, artifactAi);
    setLocalImageResolver((id) => db.getImage(id));
    backend = db;
  }
  // Favicon con el logotipo (también funciona cuando la página se sirve sin archivos auxiliares)
  try {
    const link = document.querySelector<HTMLLinkElement>("link[rel=icon]") ?? Object.assign(document.createElement("link"), { rel: "icon" });
    link.href = "data:image/svg+xml," + encodeURIComponent(LOGO_SVG);
    document.head.appendChild(link);
  } catch { /* sin head accesible */ }
  const root = document.getElementById("root")!;
  createRoot(root).render(
    <StrictMode>
      <AppProvider config={config} backend={backend} demo={demo}>
        <ToastProvider><App /></ToastProvider>
      </AppProvider>
    </StrictMode>,
  );
}

boot().catch((e) => {
  const root = document.getElementById("root");
  if (root) root.innerHTML = `<div style="padding:24px;font-family:system-ui;color:#fff;background:#0B0B0D">No se pudo iniciar MARKETZONE: ${String(e?.message ?? e)}</div>`;
});
