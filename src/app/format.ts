// Formatos y etiquetas en español.
import type { CampaignKind, CampaignStatus, Condition, OfferStatus, OrderStatus, SellerOrderStatus } from "../api/types";

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
  new_with_tags: { code: "Con etiqueta", label: "Nuevo con etiquetas", hint: "Sin usar, con etiquetas originales" },
  new_without_tags: { code: "Nuevo", label: "Nuevo sin etiquetas", hint: "Sin usar, sin etiquetas" },
  used_excellent: { code: "Como nuevo", label: "Usado, como nuevo", hint: "Uso mínimo, sin defectos visibles" },
  used_good: { code: "Usado", label: "Usado, buen estado", hint: "Señales normales de uso" },
  used_flawed: { code: "Con detalles", label: "Usado, con detalles", hint: "Tiene defectos que se describen en la publicación" },
};

export const ORDER_STATUS: Record<OrderStatus, string> = {
  pending_payment: "Pendiente de pago", paid: "Pagado", cancelled: "Cancelado", expired: "Vencido",
  refunded: "Reembolsado", partially_refunded: "Reembolso parcial",
};

export const FULFILLMENT_STATUS: Record<SellerOrderStatus, string> = {
  pending_payment: "Pendiente de pago", paid: "Pagado", preparing: "Preparando", shipped: "Enviado",
  delivered: "Entregado", cancelled: "Cancelado", refunded: "Reembolsado",
};

export const OFFER_STATUS: Record<OfferStatus, string> = {
  pending: "Pendiente", countered: "Contraoferta recibida", accepted: "Aceptada · pendiente de pago", declined: "Rechazada",
  expired: "Expirada", cancelled: "Cancelada", completed: "Compra completada",
};

export const CAMPAIGN_STATUS: Record<CampaignStatus, string> = {
  draft: "Borrador", pending_review: "Pendiente de revisión", pending_payment: "Pendiente de pago", active: "Activa",
  paused: "Pausada", finished: "Finalizada", rejected: "Rechazada",
};

export const CAMPAIGN_KIND: Record<CampaignKind, { label: string; hint: string }> = {
  promoted_product: { label: "Producto promocionado", hint: "Tu producto aparece en la sección Patrocinado del inicio." },
  home_store: { label: "Tienda o negocio en portada", hint: "Tu negocio aparece destacado en la página principal." },
  category_spotlight: { label: "Destacado en categoría", hint: "Tu producto aparece primero al explorar su categoría." },
  temporary_promo: { label: "Promoción temporal", hint: "Un anuncio de tu negocio durante unos días." },
  featured_offer: { label: "Oferta destacada", hint: "Destaca un producto con un mensaje de oferta (sin inventar descuentos)." },
};

export const BUSINESS_CATEGORIES: Record<string, string> = {
  moda: "Moda", sneakers: "Sneakers", belleza: "Belleza", accesorios: "Accesorios", reventa: "Reventa", servicios: "Servicios", otro: "Otro",
};

export function tone(status: string): "ok" | "warn" | "bad" | "info" | "muted" | "accent" {
  if (["paid", "delivered", "completed", "active", "ok", "succeeded"].includes(status)) return "ok";
  if (["pending_payment", "pending", "countered", "pending_review", "preparing", "accepted", "draft", "paused", "open", "reviewing"].includes(status)) return "warn";
  if (["cancelled", "expired", "declined", "rejected", "refunded", "blocked", "suspended", "failed"].includes(status)) return "bad";
  if (["shipped"].includes(status)) return "info";
  return "muted";
}

const rtf = typeof Intl !== "undefined" && "RelativeTimeFormat" in Intl ? new Intl.RelativeTimeFormat("es", { numeric: "auto" }) : null;
export function ago(iso: string | null | undefined) {
  if (!iso) return "";
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const [v, u]: [number, Intl.RelativeTimeFormatUnit] = abs < 60 ? [diff, "second"] : abs < 3600 ? [diff / 60, "minute"]
    : abs < 86400 ? [diff / 3600, "hour"] : abs < 2592000 ? [diff / 86400, "day"] : [diff / 2592000, "month"];
  return rtf ? rtf.format(Math.round(v), u) : new Date(iso).toLocaleDateString("es");
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function dateOnly(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}

export function remaining(iso: string | null | undefined) {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "vencido";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} días`;
}

export function pct(bps: number) { return `${(bps / 100).toLocaleString("es", { maximumFractionDigits: 2 })} %`; }

export function sizeLabel(size: string | null, color: string | null) {
  return [color, size].filter(Boolean).join(" · ") || "Unidad única";
}

export function slugify(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
