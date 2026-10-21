// Enrutador mínimo (hash o history) sin dependencias.
import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

let mode: "hash" | "history" = "hash";
const EVT = "mz:navigate";

export function setRouterMode(m: "hash" | "history") { mode = m; }

export interface Loc { path: string; query: URLSearchParams; raw: string }

function read(): Loc {
  let raw: string;
  if (mode === "hash") {
    raw = location.hash.replace(/^#/, "") || "/";
    // Enlaces de Supabase Auth pueden añadir un segundo fragmento (#/restablecer#access_token=...)
    const second = raw.indexOf("#");
    if (second >= 0) raw = raw.slice(0, second);
  } else {
    raw = location.pathname + location.search;
  }
  if (!raw.startsWith("/")) raw = "/" + raw;
  const [path, qs] = raw.split("?");
  return { path: decodeURI(path.replace(/\/+$/, "") || "/"), query: new URLSearchParams(qs ?? ""), raw };
}

export function hrefFor(to: string) { return mode === "hash" ? `#${to}` : to; }

export function navigate(to: string, opts: { replace?: boolean; keepScroll?: boolean } = {}) {
  if (mode === "hash") {
    const target = `#${to}`;
    if (opts.replace) history.replaceState(null, "", target);
    else if (location.hash !== target) history.pushState(null, "", target);
  } else {
    if (opts.replace) history.replaceState(null, "", to); else history.pushState(null, "", to);
  }
  window.dispatchEvent(new Event(EVT));
  if (!opts.keepScroll) window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
}

export function useLocation(): Loc {
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const on = () => setLoc(read());
    window.addEventListener(EVT, on);
    window.addEventListener("popstate", on);
    window.addEventListener("hashchange", on);
    return () => {
      window.removeEventListener(EVT, on);
      window.removeEventListener("popstate", on);
      window.removeEventListener("hashchange", on);
    };
  }, []);
  return loc;
}

export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length && !(p.at(-1)?.endsWith("?") && p.length - 1 === s.length)) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i];
    if (seg.startsWith(":")) {
      const name = seg.slice(1).replace(/\?$/, "");
      if (s[i] === undefined) { if (seg.endsWith("?")) continue; return null; }
      params[name] = decodeURIComponent(s[i]);
    } else if (seg !== s[i]) return null;
  }
  return params;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; children: ReactNode };
export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={hrefFor(to)} onClick={handle} {...rest}>{children}</a>;
}

export function withQuery(path: string, params: Record<string, string | number | boolean | null | undefined | string[]>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "" || v === false) continue;
    q.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
