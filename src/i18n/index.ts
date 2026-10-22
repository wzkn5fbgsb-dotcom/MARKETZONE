// Idiomas de MARKETXONE: español (texto original), inglés, francés y chino simplificado.
// La clave de cada traducción es el texto en español; si falta una traducción se muestra el español.
// Cambiar de idioma recarga la página para que todos los textos (incluidas las tablas de etiquetas) se regeneren.
import { en } from "./en";
import { fr } from "./fr";
import { zh } from "./zh";

export type Lang = "es" | "en" | "fr" | "zh";
export const LANGS: { id: Lang; label: string; htmlLang: string; locale: string }[] = [
  { id: "es", label: "Español", htmlLang: "es", locale: "es-MX" },
  { id: "en", label: "English", htmlLang: "en", locale: "en-US" },
  { id: "fr", label: "Français", htmlLang: "fr", locale: "fr-FR" },
  { id: "zh", label: "中文", htmlLang: "zh-Hans", locale: "zh-CN" },
];
const DICTS: Record<Exclude<Lang, "es">, Record<string, string>> = { en, fr, zh };
const KEY = "mz.lang";

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "es" || saved === "en" || saved === "fr" || saved === "zh") return saved;
  } catch { /* sin almacenamiento */ }
  const nav = (typeof navigator !== "undefined" ? navigator.languages?.[0] ?? navigator.language : "es") ?? "es";
  const base = nav.toLowerCase().slice(0, 2);
  return base === "en" || base === "fr" || base === "zh" ? base : "es";
}

export const lang: Lang = detect();
export const locale = LANGS.find((l) => l.id === lang)!.locale;
if (typeof document !== "undefined") document.documentElement.lang = LANGS.find((l) => l.id === lang)!.htmlLang;

const dict: Record<string, string> | null = lang === "es" ? null : DICTS[lang];

/** Traduce un texto escrito en español. `{0}`, `{1}`… se sustituyen por `args`. */
export function t(es: string, args?: unknown[]): string {
  let out = (dict && dict[es]) || es;
  if (args) out = out.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ""));
  return out;
}

export function setLang(next: Lang) {
  try { localStorage.setItem(KEY, next); } catch { /* sin almacenamiento */ }
  location.reload();
}
