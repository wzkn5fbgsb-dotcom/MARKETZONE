import { t } from "../i18n";
// Logotipo original de MARKETXONE: una "X" geométrica dentro de una zona delimitada por marcas de esquina.
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="9" fill="#DC143C" />
      <path d="M11 11h5.4l3.6 5.4 3.6-5.4H29l-6.3 9L29 29h-5.4L20 23.6 16.4 29H11l6.3-9z" fill="#fff" />
      <path d="M6 6h6v2.2H8.2V12H6zM34 34h-6v-2.2h3.8V28H34z" fill="#fff" opacity=".85" />
    </svg>
  );
}

export function Logo({ size = 30, compact = false }: { size?: number; compact?: boolean }) {
  return (
    <span className="row-nw" style={{ gap: 9 }} aria-label="MARKETXONE">
      <LogoMark size={size} />
      {!compact && (
        <span className="display logo-word" style={{ fontSize: size * 0.56, letterSpacing: "0.02em" }}>
          MARKET<span style={{ color: "var(--muted)" }}>XONE</span>
        </span>
      )}
    </span>
  );
}

/** SVG del icono (favicon / PWA). */
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#DC143C"/><path d="M11 11h5.4l3.6 5.4 3.6-5.4H29l-6.3 9L29 29h-5.4L20 23.6 16.4 29H11l6.3-9z" fill="#fff"/><path d="M6 6h6v2.2H8.2V12H6zM34 34h-6v-2.2h3.8V28H34z" fill="#fff" opacity=".85"/></svg>`;
