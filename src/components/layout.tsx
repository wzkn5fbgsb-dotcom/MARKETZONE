// Estructura: cabecera, barra inferior móvil, aviso de demo y pie.
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, navigate, useLocation, withQuery } from "../app/router";
import { useApp } from "../app/state";
import { Icon } from "../ui/icons";
import { Logo } from "./brand";
import { Avatar } from "../ui/kit";
import { useTheme, type ThemePref } from "../app/theme";

export function SearchBox({ initial = "", autoFocus = false, placeholder = "Busca marca, prenda o talla" }: { initial?: string; autoFocus?: boolean; placeholder?: string }) {
  const [q, setQ] = useState(initial);
  const submit = (e: FormEvent) => { e.preventDefault(); navigate(withQuery("/explorar", { q: q.trim() })); };
  return (
    <form className="search-box" onSubmit={submit} role="search">
      <Icon name="search" size={18} />
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
        aria-label="Buscar productos" autoFocus={autoFocus} enterKeyHint="search" />
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
          <Link to="/" aria-label="Inicio"><Logo size={30} /></Link>
          <nav className="nav-desktop" aria-label="Principal">
            <Link to="/categorias" className={on("/categorias")}>Categorías</Link>
            <Link to="/explorar" className={on("/explorar")}>Explorar</Link>
            <Link to="/negocios" className={on("/negocios")}>Negocios</Link>
            <Link to="/publicar" className={on("/publicar")}>Vender</Link>
          </nav>
          <div className="header-search"><SearchBox key={loc.path === "/explorar" ? loc.query.get("q") ?? "" : "h"} initial={loc.path === "/explorar" ? loc.query.get("q") ?? "" : ""} /></div>
          <div className="header-actions">
            <ThemeButton />
            {session && (
              <Link to="/notificaciones" className="icon-btn" aria-label="Notificaciones">
                <Icon name="bell" />{!!account?.unread_notifications && <span className="dot">{account.unread_notifications}</span>}
              </Link>
            )}
            <Link to="/favoritos" className="icon-btn hide-sm" aria-label="Favoritos"><Icon name="heart" /></Link>
            <Link to="/carrito" className="icon-btn" aria-label="Carrito">
              <Icon name="bag" />{!!account?.cart_count && <span className="dot">{account.cart_count}</span>}
            </Link>
            {session ? (
              <Link to="/perfil" className="icon-btn" aria-label="Mi perfil">
                <Avatar name={account?.profile.display_name ?? "?"} src={account?.profile.avatar_url} />
              </Link>
            ) : (
              <Link to="/entrar" className="btn btn-outline btn-sm" style={{ marginLeft: 6 }}>Entrar</Link>
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
    <nav className="tabbar" aria-label="Navegación inferior">
      {item("/", "home", "Inicio", p === "/")}
      {item("/categorias", "categories", "Categorías", p.startsWith("/categorias") || p.startsWith("/explorar") || p.startsWith("/p/"))}
      <Link to="/publicar" className={`sell ${p.startsWith("/publicar") ? "on" : ""}`} aria-current={p.startsWith("/publicar") ? "page" : undefined}><span className="sell-dot"><Icon name="plus" size={22} stroke={2.4} /></span>Vender</Link>
      {item("/favoritos", "heart", "Favoritos", p.startsWith("/favoritos"))}
      {item("/perfil", "user", "Perfil", ["/perfil", "/panel", "/pedidos", "/ofertas", "/ajustes", "/admin"].some((x) => p.startsWith(x)))}
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
          {config.mode === "demo"
            ? <><b>Demo.</b> Los productos son de ejemplo, lo que publiques se guarda solo en este teléfono y no se cobra dinero.</>
            : <><b>Modo de prueba.</b> Puedes comprar y vender, pero los pagos son simulados: no se cobra dinero.</>}
        </span>
        <Link to="/estado" className="link small" style={{ whiteSpace: "nowrap" }}>Qué funciona</Link>
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
          <span style={{ maxWidth: "38ch" }}>Compra y vende ropa, sneakers y streetwear. Haz ofertas y negocia el precio con el vendedor.</span>
        </div>
        <nav className="footer-links" aria-label="Pie de página">
          <Link to="/categorias" className="link">Categorías</Link>
          <Link to="/publicar" className="link">Vender</Link>
          <Link to="/promociona" className="link">Promociona tu negocio</Link>
          <Link to="/estado" className="link">Qué funciona</Link>
          <Link to="/terminos" className="link">Términos</Link>
          <Link to="/privacidad" className="link">Privacidad</Link>
        </nav>
        <div className="stack" style={{ gap: 8 }}>
          <span className="small">Apariencia</span>
          <ThemePicker />
        </div>
        <span className="tiny">Versión {config.version}{config.mode === "demo" ? " (demo)" : ""}</span>
      </div>
    </footer>
  );
}

export function Page({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return <main className="page"><div className="wrap" style={narrow ? { maxWidth: 760 } : undefined}>{children}</div></main>;
}

export function BackLink({ to, label = "Volver" }: { to: string; label?: string }) {
  return <Link to={to} className="row-nw small muted" style={{ gap: 4, marginBottom: 12 }}><Icon name="back" size={16} />{label}</Link>;
}

const THEME_LABEL: Record<ThemePref, string> = { dark: "Oscuro", light: "Claro", auto: "Automático" };

/** Botón de la cabecera: cambia entre claro y oscuro con un toque. */
export function ThemeButton() {
  const { theme, set } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" className="icon-btn" onClick={() => set(next)} aria-label={next === "light" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"} title={next === "light" ? "Modo claro" : "Modo oscuro"}>
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}

/** Selector completo: oscuro, claro o automático (sigue el ajuste del teléfono). */
export function ThemePicker() {
  const { pref, set } = useTheme();
  return (
    <div className="segmented" role="radiogroup" aria-label="Apariencia">
      {(["dark", "light", "auto"] as ThemePref[]).map((k) => (
        <button key={k} type="button" role="radio" aria-checked={pref === k} className={`seg ${pref === k ? "on" : ""}`} onClick={() => set(k)}>
          <Icon name={k === "dark" ? "moon" : k === "light" ? "sun" : "auto"} size={16} />{THEME_LABEL[k]}
        </button>
      ))}
    </div>
  );
}
