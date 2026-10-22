// Estructura: cabecera, barra inferior móvil, aviso de demo y pie.
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, navigate, useLocation, withQuery } from "../app/router";
import { useApp } from "../app/state";
import { Icon } from "../ui/icons";
import { Logo } from "./brand";
import { Avatar } from "../ui/kit";
import { useTheme, type ThemePref } from "../app/theme";
import { LANGS, lang, setLang, t, type Lang } from "../i18n";

export function SearchBox({ initial = "", autoFocus = false, placeholder = t("Busca marca, prenda o talla") }: { initial?: string; autoFocus?: boolean; placeholder?: string }) {
  const [q, setQ] = useState(initial);
  const submit = (e: FormEvent) => { e.preventDefault(); navigate(withQuery("/explorar", { q: q.trim() })); };
  return (
    <form className="search-box" onSubmit={submit} role="search">
      <Icon name="search" size={18} />
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
        aria-label={t("Buscar productos")} autoFocus={autoFocus} enterKeyHint="search" />
    </form>
  );
}

export function Header() {
  const { account, session } = useApp();
  const loc = useLocation();
  const on = (p: string) => (loc.path === p || loc.path.startsWith(p + "/") ? "on" : "");
  const showMobileSearch = loc.path === "/" || loc.path === "/explorar" || loc.path === "/categorias";
  return (
    <header className="header">
      <div className="wrap">
        <div className="header-inner">
          <Link to="/" aria-label={t("Inicio")}><Logo size={30} /></Link>
          <nav className="nav-desktop" aria-label={t("Principal")}>
            <Link to="/explorar" className={on("/explorar")}>{t("Explorar")}</Link>
            <Link to="/subastas" className={on("/subastas")}>{t("Subastas")}</Link>
            <Link to="/publicar" className={on("/publicar")}>{t("Vender")}</Link>
          </nav>
          <div className="header-search"><SearchBox key={loc.path === "/explorar" ? loc.query.get("q") ?? "" : "h"} initial={loc.path === "/explorar" ? loc.query.get("q") ?? "" : ""} /></div>
          <div className="header-actions">
            <Link to="/ayuda" className="icon-btn" aria-label={t("Ayuda y soporte")}><Icon name="chat" /></Link>
            {session && (
              <Link to="/notificaciones" className="icon-btn" aria-label={t("Notificaciones")}>
                <Icon name="bell" />{!!account?.unread_notifications && <span className="dot">{account.unread_notifications}</span>}
              </Link>
            )}
            <Link to="/favoritos" className="icon-btn hide-sm" aria-label={t("Favoritos")}><Icon name="heart" /></Link>
            <Link to="/carrito" className="icon-btn" aria-label={t("Carrito")}>
              <Icon name="bag" />{!!account?.cart_count && <span className="dot">{account.cart_count}</span>}
            </Link>
            {session ? (
              <Link to="/perfil" className="icon-btn" aria-label={t("Mi perfil")}>
                <Avatar name={account?.profile.display_name ?? "?"} src={account?.profile.avatar_url} />
              </Link>
            ) : (
              <Link to="/entrar" className="btn btn-outline btn-sm" style={{ marginLeft: 6 }}>{t("Entrar")}</Link>
            )}
          </div>
        </div>
        {showMobileSearch && <div className="mobile-search"><SearchBox key={loc.query.get("q") ?? ""} initial={loc.path === "/explorar" ? loc.query.get("q") ?? "" : ""} /></div>}
      </div>
    </header>
  );
}

export function TabBar() {
  const loc = useLocation();
  const p = loc.path;
  const item = (to: string, icon: Parameters<typeof Icon>[0]["name"], label: string, active: boolean) => (
    <Link to={to} className={active ? "on" : ""} aria-current={active ? "page" : undefined}><Icon name={icon} size={22} />{label}</Link>
  );
  return (
    <nav className="tabbar" aria-label={t("Navegación inferior")}>
      {item("/", "home", t("Inicio"), p === "/")}
      {item("/categorias", "categories", t("Categorías"), p.startsWith("/categorias") || p.startsWith("/explorar") || p.startsWith("/p/"))}
      <Link to="/publicar" className={`sell ${p.startsWith("/publicar") ? "on" : ""}`} aria-current={p.startsWith("/publicar") ? "page" : undefined}><span className="sell-dot"><Icon name="plus" size={22} stroke={2.4} /></span>{t("Vender")}</Link>
      {item("/subastas", "gavel", t("Subastas"), p.startsWith("/subasta") || p.startsWith("/mis-subastas"))}
      {item("/perfil", "user", t("Perfil"), ["/perfil", "/panel", "/pedidos", "/ofertas", "/ajustes", "/admin", "/favoritos", "/ayuda"].some((x) => p.startsWith(x)))}
    </nav>
  );
}

export function DemoBanner() {
  const { config, settings } = useApp();
  if (config.mode !== "demo" && !settings?.test_mode) return null;
  return (
    <div className="demo-banner">
      <div className="wrap">
        <Icon name="info" size={16} />
        <span className="grow">
          {config.mode === "demo" ? t("Demo: artículos de ejemplo, sin cobros reales.") : t("Modo de prueba: pagos simulados, sin cobros reales.")}
        </span>
      </div>
    </div>
  );
}

export function Footer() {
  const { config } = useApp();
  return (
    <footer className="footer">
      <div className="wrap footer-inner">
        <div className="stack" style={{ gap: 8 }}>
          <Logo size={24} />
          <span style={{ maxWidth: "38ch" }}>{t("Compra y vende ropa, sneakers y streetwear. Haz ofertas y negocia el precio con el vendedor.")}</span>
        </div>
        <nav className="footer-links" aria-label={t("Pie de página")}>
          <Link to="/explorar" className="link">{t("Explorar")}</Link>
          <Link to="/subastas" className="link">{t("Subastas")}</Link>
          <Link to="/publicar" className="link">{t("Vender")}</Link>
          <Link to="/promociona" className="link">{t("Promociona tu negocio")}</Link>
          <Link to="/terminos" className="link">{t("Términos")}</Link>
          <Link to="/privacidad" className="link">{t("Privacidad")}</Link>
        </nav>
        <div className="stack" style={{ gap: 8 }}>
          <span className="small">{t("Apariencia")}</span>
          <ThemePicker />
          <label className="small" htmlFor="lang-footer">{t("Idioma")}</label>
          <LangPicker id="lang-footer" />
        </div>
        <span className="tiny">{t("Versión")}{" "}{config.version}{config.mode === "demo" ? t(" (demo)") : ""}</span>
      </div>
    </footer>
  );
}

export function Page({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return <main className="page"><div className="wrap" style={narrow ? { maxWidth: 760 } : undefined}>{children}</div></main>;
}

export function BackLink({ to, label = t("Volver") }: { to: string; label?: string }) {
  return <Link to={to} className="row-nw small muted" style={{ gap: 4, marginBottom: 12 }}><Icon name="back" size={16} />{label}</Link>;
}

const THEME_LABEL: Record<ThemePref, string> = { dark: t("Oscuro"), light: t("Claro"), auto: t("Automático") };

/** Botón de la cabecera: cambia entre claro y oscuro con un toque. */
export function ThemeButton() {
  const { theme, set } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" className="icon-btn" onClick={() => set(next)} aria-label={next === "light" ? t("Cambiar a modo claro") : t("Cambiar a modo oscuro")} title={next === "light" ? t("Modo claro") : t("Modo oscuro")}>
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}

/** Selector completo: oscuro, claro o automático (sigue el ajuste del teléfono). */
export function ThemePicker() {
  const { pref, set } = useTheme();
  return (
    <div className="segmented" role="radiogroup" aria-label={t("Apariencia")}>
      {(["dark", "light", "auto"] as ThemePref[]).map((k) => (
        <button key={k} type="button" role="radio" aria-checked={pref === k} className={`seg ${pref === k ? "on" : ""}`} onClick={() => set(k)}>
          <Icon name={k === "dark" ? "moon" : k === "light" ? "sun" : "auto"} size={16} />{THEME_LABEL[k]}
        </button>
      ))}
    </div>
  );
}

/** Idioma de la app. Al cambiarlo se recarga la página con los textos traducidos. */
export function LangPicker({ id }: { id?: string }) {
  return (
    <select id={id} className="select" style={{ maxWidth: 220 }} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
      {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
    </select>
  );
}
