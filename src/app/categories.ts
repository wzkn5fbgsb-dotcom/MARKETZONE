// Identidad visual de cada categoría: ilustración propia (sin marcas reales) y color de fondo.
// La misma tabla se reutilizará en la app de iOS y Android.
import { artBackdropCss, artDataUri } from "./art";
import { t } from "../i18n";

const ART: Record<string, string> = {
  ropa: "art:jacket:denim:stone:0:",
  sneakers: "art:sneaker:white:noir:0:crimson",
  streetwear: "art:hoodie:olive:fog:0:",
  accesorios: "art:cap:black:blush:0:",
  bolsos: "art:crossbody:tan:sage:0:",
  belleza: "art:serum:amber:blush:0:cream",
  "ropa-camisetas": "art:tee:white:fog:1:",
  "ropa-sudaderas": "art:hoodie:heather:stone:1:",
  "ropa-chaquetas": "art:jacket:denim:stone:1:",
  "ropa-pantalones": "art:pants:sand:stone:1:",
  "ropa-vestidos": "art:dress:burgundy:blush:1:",
  "sneakers-lifestyle": "art:sneaker:white:fog:1:crimson",
  "sneakers-running": "art:sneaker:orange:fog:1:charcoal",
  "sneakers-basket": "art:sneaker:black:stone:1:crimson",
  "streetwear-hoodies": "art:hoodie:black:fog:1:",
  "streetwear-graficas": "art:tee:black:stone:1:",
  "streetwear-cargo": "art:pants:olive:sage:1:",
  "accesorios-gorras": "art:cap:navy:fog:1:",
  "accesorios-gafas": "art:sunglasses:black:blush:1:",
  "accesorios-joyeria": "art:watch:gold:stone:1:",
  "accesorios-relojes": "art:watch:silver:fog:1:",
  "bolsos-tote": "art:tote:cream:sage:1:",
  "bolsos-crossbody": "art:crossbody:brown:stone:1:",
  "bolsos-mochilas": "art:crossbody:black:fog:1:",
  "belleza-skincare": "art:serum:amber:sage:1:cream",
  "belleza-fragancias": "art:perfume:rose:blush:1:",
  "belleza-maquillaje": "art:serum:pink:blush:1:",
};

export function categoryArt(id: string, parentId?: string | null): string {
  return artDataUri(ART[id] ?? (parentId && ART[parentId]) ?? "art:tee:black:stone:0:");
}

export function categoryBackdrop(id: string): string {
  return artBackdropCss(ART[id] ?? "art:tee:black:stone:0:");
}

/** "1 artículo" / "12 artículos" / "Sin artículos todavía" */
export function countLabel(n: number): string {
  return n === 0 ? t("Sin artículos todavía") : n === 1 ? t("1 artículo") : t("{0} artículos", [n]);
}
