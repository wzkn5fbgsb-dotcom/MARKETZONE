// Formatos y etiquetas en español.
import type { CampaignKind, CampaignStatus, Condition, OfferStatus, OrderStatus, SellerOrderStatus } from "../api/types";
import { locale, t } from "../i18n";

export function money(cents: number | null | undefined, opts: { always2?: boolean } = {}) {
  if (cents === null || cents === undefined) return "—";
  const v = cents / 100;
  const whole = Number.isInteger(v) && !opts.always2;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

export function parseMoney(input: string): number | null {
  const clean = input.replace(/[^0-9.,]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".");
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export const CONDITIONS: Record<Condition, { code: string; label: string; hint: string }> = {
  new_with_tags: { code: t("Con etiqueta"), label: t("Nuevo con etiquetas"), hint: t("Sin usar, con etiquetas originales") },
  new_without_tags: { code: t("Nuevo"), label: t("Nuevo sin etiquetas"), hint: t("Sin usar, sin etiquetas") },
  used_excellent: { code: t("Como nuevo"), label: t("Usado, como nuevo"), hint: t("Uso mínimo, sin defectos visibles") },
  used_good: { code: t("Usado"), label: t("Usado, buen estado"), hint: t("Señales normales de uso") },
  used_flawed: { code: t("Con detalles"), label: t("Usado, con detalles"), hint: t("Tiene defectos que se describen en la publicación") },
};

export const ORDER_STATUS: Record<OrderStatus, string> = {
  pending_payment: t("Pendiente de pago"), paid: t("Pagado"), cancelled: t("Cancelado"), expired: t("Vencido"),
  refunded: t("Reembolsado"), partially_refunded: t("Reembolso parcial"),
};

export const FULFILLMENT_STATUS: Record<SellerOrderStatus, string> = {
  pending_payment: t("Pendiente de pago"), paid: t("Pagado"), preparing: t("Preparando"), shipped: t("Enviado"),
  delivered: t("Entregado"), cancelled: t("Cancelado"), refunded: t("Reembolsado"),
};

export const OFFER_STATUS: Record<OfferStatus, string> = {
  pending: t("Pendiente"), countered: t("Contraoferta recibida"), accepted: t("Aceptada"), declined: t("Rechazada"),
  expired: t("Expirada"), cancelled: t("Cancelada"), completed: t("Trato hecho"),
};

export const CAMPAIGN_STATUS: Record<CampaignStatus, string> = {
  draft: t("Borrador"), pending_review: t("Pendiente de revisión"), pending_payment: t("Pendiente de pago"), active: t("Activa"),
  paused: t("Pausada"), finished: t("Finalizada"), rejected: t("Rechazada"),
};

export const CAMPAIGN_KIND: Record<CampaignKind, { label: string; hint: string }> = {
  promoted_product: { label: t("Un artículo promocionado"), hint: t("Ese artículo aparece en la sección Patrocinado del inicio.") },
  home_store: { label: t("Toda tu tienda en portada"), hint: t("Tu tienda completa (tu clóset) o tu negocio aparece destacado en el inicio para atraer más visitas a todos tus artículos.") },
  category_spotlight: { label: t("Destacado en categoría"), hint: t("Tu producto aparece primero al explorar su categoría.") },
  temporary_promo: { label: t("Promoción temporal"), hint: t("Un anuncio de tu negocio durante unos días.") },
  featured_offer: { label: t("Oferta destacada"), hint: t("Destaca un producto con un mensaje de oferta (sin inventar descuentos).") },
};

export const BUSINESS_CATEGORIES: Record<string, string> = {
  moda: t("Moda"), sneakers: t("Sneakers"), belleza: t("Belleza"), accesorios: t("Accesorios"), reventa: t("Reventa"), servicios: t("Servicios"), otro: t("Otro"),
};

export function tone(status: string): "ok" | "warn" | "bad" | "info" | "muted" | "accent" {
  if (["paid", "delivered", "completed", "active", "ok", "succeeded"].includes(status)) return "ok";
  if (["pending_payment", "pending", "countered", "pending_review", "preparing", "accepted", "draft", "paused", "open", "reviewing"].includes(status)) return "warn";
  if (["cancelled", "expired", "declined", "rejected", "refunded", "blocked", "suspended", "failed"].includes(status)) return "bad";
  if (["shipped"].includes(status)) return "info";
  return "muted";
}

const rtf = typeof Intl !== "undefined" && "RelativeTimeFormat" in Intl ? new Intl.RelativeTimeFormat(locale, { numeric: "auto" }) : null;
export function ago(iso: string | null | undefined) {
  if (!iso) return "";
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const [v, u]: [number, Intl.RelativeTimeFormatUnit] = abs < 60 ? [diff, "second"] : abs < 3600 ? [diff / 60, "minute"]
    : abs < 86400 ? [diff / 3600, "hour"] : abs < 2592000 ? [diff / 86400, "day"] : [diff / 2592000, "month"];
  return rtf ? rtf.format(Math.round(v), u) : new Date(iso).toLocaleDateString(locale);
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function dateOnly(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

export function remaining(iso: string | null | undefined) {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "vencido";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return t("{0} h {1} min", [h, m % 60]);
  return t("{0} días", [Math.floor(h / 24)]);
}

export function pct(bps: number) { return `${(bps / 100).toLocaleString(locale, { maximumFractionDigits: 2 })} %`; }

export function sizeLabel(size: string | null, color: string | null) {
  return [color, size].filter(Boolean).join(" · ") || t("Unidad única");
}

export function slugify(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
