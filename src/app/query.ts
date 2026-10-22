// Caché de datos mínima con suscripción e invalidación por prefijo.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ApiError } from "../api/backend";
import { t } from "../i18n";

interface Entry { data?: unknown; error?: ApiError | null; promise?: Promise<unknown> | null; fn: () => Promise<unknown>; at: number }
const cache = new Map<string, Entry>();
const subs = new Map<string, Set<() => void>>();

function emit(key: string) { subs.get(key)?.forEach((f) => f()); }

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e && typeof e === "object" && "code" in e) return new ApiError(String((e as any).code), String((e as any).message ?? t("Error")));
  return new ApiError("unknown", t("Algo salió mal. Inténtalo de nuevo."));
}

function load(key: string, force = false) {
  const e = cache.get(key);
  if (!e) return;
  if (e.promise && !force) return;
  const p = e.fn().then(
    (data) => { const cur = cache.get(key); if (cur && cur.promise === p) { cur.data = data; cur.error = null; cur.promise = null; cur.at = Date.now(); emit(key); } },
    (err) => { const cur = cache.get(key); if (cur && cur.promise === p) { cur.error = toApiError(err); cur.promise = null; emit(key); } },
  );
  e.promise = p;
  emit(key);
}

export function useQuery<T>(key: string | null, fn: () => Promise<T>, opts: { staleMs?: number } = {}) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!key) return;
    let e = cache.get(key);
    if (!e) { e = { fn: () => fnRef.current(), at: 0 }; cache.set(key, e); }
    else e.fn = () => fnRef.current();
    const set = subs.get(key) ?? new Set();
    set.add(force);
    subs.set(key, set);
    const stale = Date.now() - e.at > (opts.staleMs ?? 15000);
    if ((e.data === undefined && !e.error) || stale) load(key);
    else force();
    return () => { set.delete(force); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = key ? cache.get(key) : undefined;
  const reload = useCallback(() => { if (key) load(key, true); }, [key]);
  return {
    data: e?.data as T | undefined,
    error: e?.error ?? null,
    loading: !!key && (!e || (e.data === undefined && !e.error)),
    refreshing: !!e?.promise,
    reload,
  };
}

/** Invalida claves que empiecen por alguno de los prefijos y recarga las que están en pantalla. */
export function invalidate(...prefixes: string[]) {
  for (const [key, e] of cache) {
    if (!prefixes.length || prefixes.some((p) => key.startsWith(p))) {
      e.at = 0;
      if (subs.get(key)?.size) load(key, true); else cache.delete(key);
    }
  }
}

/** Vacía la caché (al entrar o salir de la cuenta) y vuelve a pedir lo que está en pantalla. */
export function clearCache() {
  for (const [key, e] of cache) {
    e.data = undefined; e.error = null; e.at = 0; e.promise = null;
    if (subs.get(key)?.size) load(key, true); else cache.delete(key);
  }
  for (const k of subs.keys()) emit(k);
}

/** Ejecuta una acción con estado de carga y error, e invalida claves al terminar. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, opts: { invalidates?: string[]; onSuccess?: (r: R) => void; onError?: (e: ApiError) => void } = {}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    setPending(true);
    setError(null);
    try {
      const r = await fn(...args);
      if (opts.invalidates) invalidate(...opts.invalidates);
      opts.onSuccess?.(r);
      return r;
    } catch (e) {
      const err = toApiError(e);
      setError(err);
      opts.onError?.(err);
      return undefined;
    } finally {
      setPending(false);
    }
  }, [fn]); // eslint-disable-line react-hooks/exhaustive-deps
  return { run, pending, error, setError };
}
