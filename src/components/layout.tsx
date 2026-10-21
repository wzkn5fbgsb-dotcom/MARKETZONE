// Estructura: cabecera, barra inferior móvil, aviso de demo y pie.
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, navigate, useLocation, withQuery } from "../app/router";
import { useApp } from "../app/state";
import { Icon } from "../ui/icons";
import { Logo } from "./brand";
import { Avatar } from "../ui/kit";

export function SearchBox({ initial = "", autoFocus = false, placeholder = "Busca marcas, prendas, tallas…" }: { initial?: string; autoFocus?: boolean; placeholder?: string }) {
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
  const showMobileSearch = loc.path === "/" || loc.path === "/explorar";
  return (
    <header className="header">
      <div className="wrap">
        <div className="header-inner">
          <Link to="/" aria-label="Inicio"><Logo size={30} /></Link>
          <nav className="nav-desktop" aria-label="Principal">
            <Link to="/explorar" className={on("/explorar")}>Explorar</Link>
            <Link to="/negocios" className={on("/negocios")}>Negocios</Link>
            <Link to="/publicar" className={on("/publicar")}>Vender</Link>
            <Link to="/promociona" className={on("/promociona")}>Promociona</Link>
          </nav>
          <div className="header-search"><SearchBox key={loc.path === "/explorar" ? loc.query.get("q") ?? "" : "h"} initial={loc.path === "/explorar" ? loc.query.get("q") ?? "" : ""} /></div>
          <div className="header-actions">
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
      {item("/explorar", "search", "Explorar", p.startsWith("/explorar") || p.startsWith("/p/"))}
      <Link to="/publicar" className="sell" aria-label="Publicar"><span className="sell-dot"><Icon name="plus" size={22} stroke={2.4} /></span>Publicar</Link>
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
            ? <><b>Versión de demostración.</b> Productos y tiendas de ejemplo; tus datos se guardan solo en este dispositivo. Pagos en modo de prueba: no se cobra dinero real.</>
            : <><b>Modo de prueba.</b> Los pagos son simulados y no se cobra dinero real.</>}
        </span>
        <Link to="/estado" className="link small" style={{ whiteSpace: "nowrap" }}>Estado del proyecto</Link>
      </div>
    </div>
  );
}

export function Footer() {
  const { config } = useApp();
  return (
    <footer className="footer">
      <div className="wrap row between" style={{ alignItems: "flex-start", gap: 20 }}>
        <div className="stack" style={{ gap: 8 }}>
          <Logo size={24} />
          <span>Marketplace de moda, sneakers y streetwear con inventario por talla, ofertas y herramientas para negocios.</span>
        </div>
        <div className="row" style={{ gap: 16 }}>
          <Link to="/explorar" className="link">Explorar</Link>
          <Link to="/publicar" className="link">Vender</Link>
          <Link to="/promociona" className="link">Promociona tu negocio</Link>
          <Link to="/estado" className="link">Estado del proyecto</Link>
        </div>
        <span className="mono tiny">v{config.version} · {config.mode === "demo" ? "demo local" : "Supabase"}</span>
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
