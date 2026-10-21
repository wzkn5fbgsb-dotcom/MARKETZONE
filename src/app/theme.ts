// Tema claro / oscuro. La preferencia se guarda en este dispositivo.
// "auto" sigue el ajuste del teléfono o la computadora.
import { useEffect, useState } from "react";

export type ThemePref = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "mz.theme";
const listeners = new Set<() => void>();

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch { /* almacenamiento no disponible */ }
  return "dark"; // la marca nace en negro
}

function systemTheme(): Theme {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function resolveTheme(pref = getThemePref()): Theme {
  return pref === "auto" ? systemTheme() : pref;
}

export function applyTheme() {
  const t = resolveTheme();
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "light" ? "#F4F4F6" : "#0B0B0D");
}

export function setThemePref(pref: ThemePref) {
  try { localStorage.setItem(KEY, pref); } catch { /* sin almacenamiento: se aplica solo en esta visita */ }
  applyTheme();
  listeners.forEach((l) => l());
}

let watching = false;
function watchSystem() {
  if (watching || typeof matchMedia !== "function") return;
  watching = true;
  matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", () => {
    if (getThemePref() === "auto") { applyTheme(); listeners.forEach((l) => l()); }
  });
}

export function useTheme() {
  const [, force] = useState(0);
  useEffect(() => {
    watchSystem();
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return { pref: getThemePref(), theme: resolveTheme(), set: setThemePref };
}

