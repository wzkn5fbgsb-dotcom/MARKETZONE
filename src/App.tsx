import { useEffect, useState, type JSX } from "react";
import { match, navigate, useLocation } from "./app/router";
import { useApp } from "./app/state";
import { DemoBanner, Footer, Header, Page, TabBar } from "./components/layout";
import { Callout, Empty } from "./ui/kit";
import Home from "./pages/Home";
import Explore from "./pages/Explore";
import Categories from "./pages/Categories";
import Product from "./pages/Product";
import { BusinessPage, BusinessesPage, StorePage } from "./pages/Store";
import { Forgot, Login, Register, ResetPassword } from "./pages/Auth";
import { Favorites, Notifications, Profile, Settings } from "./pages/Account";
import { CartPage, OfferList, OffersPage, OrderPage, OrdersPage } from "./pages/Commerce";
import Sell from "./pages/Sell";
import Dashboard from "./pages/Dashboard";
import { BusinessEditor, CampaignWizard, CampaignsPage, PromoteHome } from "./pages/Promote";
import Admin from "./pages/Admin";
import Status from "./pages/Status";
import { Privacy, Terms } from "./pages/Legal";
import { Link } from "./app/router";

const ROUTES: [string, (p: Record<string, string>) => JSX.Element][] = [
  ["/", () => <Home />],
  ["/categorias", () => <Categories />],
  ["/explorar", () => <Explore />],
  ["/p/:id", (p) => <Product key={p.id} id={p.id} />],
  ["/tienda/:slug", (p) => <StorePage key={p.slug} slug={p.slug} />],
  ["/negocios", () => <BusinessesPage />],
  ["/negocio/:slug", (p) => <BusinessPage key={p.slug} slug={p.slug} />],
  ["/entrar", () => <Login />],
  ["/registro", () => <Register />],
  ["/recuperar", () => <Forgot />],
  ["/restablecer", () => <ResetPassword />],
  ["/perfil", () => <Profile />],
  ["/ajustes", () => <Settings />],
  ["/favoritos", () => <Favorites />],
  ["/notificaciones", () => <Notifications />],
  ["/carrito", () => <CartPage />],
  ["/pedidos", () => <OrdersPage />],
  ["/pedido/:id", (p) => <OrderPage key={p.id} id={p.id} />],
  ["/ofertas", () => <OffersPage />],
  ["/publicar", () => <Sell />],
  ["/publicar/:id", (p) => <Sell key={p.id} id={p.id} />],
  ["/panel", () => <Dashboard />],
  ["/panel/:tab", (p) => <Dashboard tab={p.tab} />],
  ["/promociona", () => <PromoteHome />],
  ["/promociona/negocio", () => <BusinessEditor />],
  ["/promociona/negocio/:id", (p) => <BusinessEditor key={p.id} id={p.id} />],
  ["/promociona/campana", () => <CampaignWizard />],
  ["/promociona/campanas", () => <CampaignsPage />],
  ["/admin", () => <Admin />],
  ["/admin/:tab", (p) => <Admin tab={p.tab} />],
  ["/estado", () => <Status />],
  ["/privacidad", () => <Privacy />],
  ["/terminos", () => <Terms />],
];

export default function App() {
  const loc = useLocation();
  const { backend } = useApp();
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  // Enlaces de correo de Supabase Auth (#access_token=... o #error=...)
  useEffect(() => {
    const h = location.hash;
    if (!/access_token=|error=/.test(h)) return;
    backend.auth.consumeRedirect(h).then((kind) => {
      navigate(kind === "recovery" ? "/restablecer" : "/", { replace: true });
      if (kind === "signup") setAuthNotice("Correo confirmado. ¡Bienvenido a MARKETZONE!");
    }).catch((e) => { setAuthNotice(e.message); navigate("/recuperar", { replace: true }); });
  }, [backend]);

  let content: JSX.Element | null = null;
  for (const [pattern, render] of ROUTES) {
    const params = match(pattern, loc.path);
    if (params) { content = render(params); break; }
  }
  return (
    <div className="has-tabbar">
      <Header />
      <DemoBanner />
      {authNotice && <div className="wrap" style={{ paddingTop: 12 }}><Callout kind="info">{authNotice}</Callout></div>}
      {content ?? <Page><Empty icon="search" title="Página no encontrada" action={<Link to="/" className="btn btn-primary">Ir al inicio</Link>}>La dirección no existe o se movió.</Empty></Page>}
      <Footer />
      <TabBar />
    </div>
  );
}

export { OfferList };
