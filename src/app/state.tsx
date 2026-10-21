// Estado global: backend activo, sesión, cuenta, ajustes y categorías.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Backend, Session } from "../api/backend";
import { MarketApi } from "../api/endpoints";
import type { Account, Category, PublicSettings } from "../api/types";
import type { DemoRuntime } from "../api/demo/persist";
import type { AppConfig } from "./config";
import { clearCache, useQuery } from "./query";
import { navigate } from "./router";

interface AppState {
  config: AppConfig;
  backend: Backend;
  api: MarketApi;
  demo: DemoRuntime | null;
  session: Session | null;
  account: Account | null;
  accountLoading: boolean;
  reloadAccount: () => void;
  settings: PublicSettings | null;
  categories: Category[];
  sessionId: string;
  /** Devuelve true si hay sesión; si no, lleva a la pantalla de acceso y vuelve después. */
  requireAuth: (next?: string) => boolean;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ config, backend, demo, children }: { config: AppConfig; backend: Backend; demo: DemoRuntime | null; children: ReactNode }) {
  const api = useMemo(() => new MarketApi(backend), [backend]);
  const [session, setSession] = useState<Session | null>(backend.auth.getSession());
  useEffect(() => backend.auth.onChange((s) => { clearCache(); setSession(s); }), [backend]);
  const uid = session?.user.id ?? null;
  const acc = useQuery(uid ? `account:${uid}` : null, () => api.account(), { staleMs: 5000 });
  // Una cuenta eliminada puede conservar una sesión vieja en el teléfono: se cierra sola.
  useEffect(() => {
    if ((acc.error as { code?: string } | null)?.code === "account_deleted") void backend.auth.signOut().catch(() => undefined);
  }, [acc.error, backend]);
  const settings = useQuery("settings", () => api.settings(), { staleMs: 60000 });
  const cats = useQuery("categories", () => api.categories(), { staleMs: 60000 });
  const sessionId = useMemo(() => {
    try {
      const k = "mz.sid";
      const v = sessionStorage.getItem(k) ?? Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem(k, v);
      return v;
    } catch { return Math.random().toString(36).slice(2, 12); }
  }, []);

  useEffect(() => { void api.expireStale().catch(() => null); }, [api]);

  const value: AppState = {
    config, backend, api, demo, session,
    account: uid ? acc.data ?? null : null,
    accountLoading: !!uid && acc.loading,
    reloadAccount: acc.reload,
    settings: settings.data ?? null,
    categories: cats.data ?? [],
    sessionId,
    requireAuth: (next) => {
      if (backend.auth.getSession()) return true;
      navigate(`/entrar?next=${encodeURIComponent(next ?? location.hash.replace(/^#/, "") ?? "/")}`);
      return false;
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("AppProvider ausente");
  return v;
}

export function categoryName(categories: Category[], id: string | null | undefined) {
  return categories.find((c) => c.id === id)?.name ?? id ?? "";
}
