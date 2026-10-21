// Logotipo original de MARKETZONE: una "Z" geométrica dentro de una zona delimitada por marcas de esquina.
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="9" fill="#DC143C" />
      <path d="M11 11.5h18v4.3L17.6 25.5H29v4H11v-4.3l11.4-9.7H11z" fill="#fff" />
      <path d="M6 6h6v2.2H8.2V12H6zM34 34h-6v-2.2h3.8V28H34z" fill="#fff" opacity=".85" />
    </svg>
  );
}

export function Logo({ size = 30, compact = false }: { size?: number; compact?: boolean }) {
  return (
    <span className="row-nw" style={{ gap: 9 }} aria-label="MARKETZONE">
      <LogoMark size={size} />
      {!compact && (
        <span className="display" style={{ fontSize: size * 0.56, letterSpacing: "0.02em" }}>
          MARKET<span style={{ color: "var(--muted)" }}>ZONE</span>
        </span>
      )}
    </span>
  );
}

/** SVG del icono (favicon / PWA). */
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#DC143C"/><path d="M11 11.5h18v4.3L17.6 25.5H29v4H11v-4.3l11.4-9.7H11z" fill="#fff"/><path d="M6 6h6v2.2H8.2V12H6zM34 34h-6v-2.2h3.8V28H34z" fill="#fff" opacity=".85"/></svg>`;
