import { useApp } from "../app/state";
import { useQuery } from "../app/query";
import { Link, withQuery } from "../app/router";
import { GridSkeleton, ProductGrid, Rail, SectionHeader } from "../components/product";
import { BusinessCard, StoreCard } from "../components/store";
import { Badge, ErrorBox } from "../ui/kit";
import { Icon } from "../ui/icons";
import { artDataUri } from "../app/art";
import { categoryArt, countLabel } from "../app/categories";
import { money } from "../app/format";

/** Duración legible de un plazo en minutos: "30 min", "2 h", "1 día". */
function span(min: number) {
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  const d = Math.round(min / 1440);
  return d === 1 ? "1 día" : `${d} días`;
}

/** Ejemplo ilustrado de una negociación: la función que distingue a MARKETZONE. */
function OfferStory() {
  const { settings } = useApp();
  const pay = settings?.offer_payment_minutes;
  return (
    <figure className="offer-story" aria-label="Ejemplo de cómo funciona una oferta">
      <div className="os-item">
        <div className="os-thumb zone"><img src={artDataUri("art:hoodie:black:fog:0:")} alt="" /></div>
        <div className="stack" style={{ gap: 2 }}>
          <span className="os-title">Sudadera negra, talla M</span>
          <span className="small muted">Publicada en <b className="price" style={{ fontSize: 15, color: "var(--text)" }}>{money(5000)}</b></span>
        </div>
      </div>
      <ol className="os-thread">
        <li className="os-msg me" style={{ animationDelay: ".35s" }}><span className="os-who">Tú</span>Te ofrezco <b>{money(4000)}</b></li>
        <li className="os-msg them" style={{ animationDelay: "1.15s" }}><span className="os-who">Vendedor</span>Te la dejo en <b>{money(4500)}</b></li>
        <li className="os-msg me" style={{ animationDelay: "1.95s" }}><span className="os-who">Tú</span>Acepto</li>
        <li className="os-deal" style={{ animationDelay: "2.6s" }}>
          <Icon name="check" size={18} stroke={2.4} />
          <span>Trato cerrado en <b>{money(4500)}</b>.{pay ? ` Tienes ${span(pay)} para pagar.` : ""}</span>
        </li>
      </ol>
      <figcaption className="tiny dim">Ejemplo de una negociación</figcaption>
    </figure>
  );
}

export default function Home() {
  const { api, categories, session } = useApp();
  const feed = useQuery("home", () => api.home());
  const top = categories.filter((c) => !c.parent_id);
  const f = feed.data;
  const empty = f && !f.recent.length;

  return (
    <main className="page" style={{ paddingTop: 0 }}>
      <div className="wrap stack-xl">
        <section className="hero">
          <div className="stack-lg">
            <h1 className="display hero-title"><span>Compra y vende moda.</span> <span>El precio se negocia.</span></h1>
            <p className="hero-lede">Ropa, sneakers, streetwear y accesorios, nuevos y de segunda mano. Ofrece lo que quieres pagar y quien vende acepta, rechaza o te hace una contraoferta.</p>
            <div className="row">
              <Link to="/publicar" className="btn btn-primary btn-lg"><Icon name="plus" size={18} stroke={2.2} />Vender</Link>
              <Link to="/categorias" className="btn btn-outline btn-lg">Ver categorías</Link>
            </div>
          </div>
          <OfferStory />
        </section>

        <section>
          <SectionHeader title="Categorías" action={<Link to="/categorias" className="link small">Ver todas</Link>} />
          <div className="cat-tiles">
            {top.map((c) => (
              <Link key={c.id} to={withQuery("/explorar", { cat: c.id })} className="cat-tile">
                <span className="cat-tile-art"><img src={categoryArt(c.id)} alt="" loading="lazy" /></span>
                <span className="cat-tile-name">{c.name}</span>
                <span className="cat-tile-n">{countLabel(c.active_count)}</span>
              </Link>
            ))}
            {!top.length && Array.from({ length: 6 }, (_, i) => <div key={i} className="skel" style={{ aspectRatio: "1 / 1.3", borderRadius: 16 }} />)}
          </div>
        </section>

        <ErrorBox error={feed.error} onRetry={feed.reload} />
        {feed.loading && <GridSkeleton />}

        {f && f.promoted.length > 0 && (
          <section>
            <SectionHeader title="Patrocinado" note="Vendedores que pagaron por aparecer aquí." />
            <Rail items={f.promoted} />
          </section>
        )}

        {f && f.recent.length > 0 && (
          <section>
            <SectionHeader title="Recién publicado" action={<Link to="/explorar" className="link small">Ver todo</Link>} />
            <ProductGrid items={f.recent} wide />
          </section>
        )}

        {f && f.deals.length > 0 && (
          <section>
            <SectionHeader title="Bajaron de precio" note="El precio anterior estuvo publicado; no es un descuento inventado." action={<Link to={withQuery("/explorar", { deals: 1 })} className="link small">Ver todos</Link>} />
            <Rail items={f.deals} />
          </section>
        )}

        {f && f.featured.length > 0 && f.recent.length > 4 && (
          <section>
            <SectionHeader title="Los más guardados" note="Lo que más gente agregó a favoritos." action={<Link to={withQuery("/explorar", { sort: "popular" })} className="link small">Ver más</Link>} />
            <Rail items={f.featured} />
          </section>
        )}

        {f && f.promos.length > 0 && (
          <section className="grid-2">
            {f.promos.map((p) => (
              <Link key={p.campaign_id} to={p.business ? `/negocio/${p.business.slug}` : p.store ? `/tienda/${p.store.slug}` : "/negocios"} className="promo-card">
                <div className="row between"><Badge kind="accent">Publicidad</Badge>{p.is_test && <Badge kind="demo">Prueba, sin cobro</Badge>}</div>
                <span className="h3">{p.headline}</span>
                {p.body && <span className="small muted">{p.body}</span>}
                <span className="small dim">{p.business?.name ?? p.store?.name}</span>
              </Link>
            ))}
          </section>
        )}

        {empty && (
          <section className="empty-feed">
            <span className="h2">Aquí van a aparecer los artículos en venta.</span>
            <span className="muted">Todavía nadie ha publicado. Sube el tuyo y será lo primero que vea cada visitante.</span>
            <div className="row">
              <Link to="/publicar" className="btn btn-primary"><Icon name="plus" size={18} stroke={2.2} />Publicar el primero</Link>
              {!session && <Link to="/registro" className="btn btn-outline">Crear cuenta</Link>}
            </div>
          </section>
        )}

        {f && (f.stores.length > 0 || f.sponsored_stores.length > 0) && (
          <section>
            <SectionHeader title="Tiendas" />
            <div className="grid-3">{[...f.sponsored_stores, ...f.stores.filter((s) => !f.sponsored_stores.some((x) => x.id === s.id))].slice(0, 8).map((s) => <StoreCard key={s.id} s={s} />)}</div>
          </section>
        )}

        {f && f.businesses.length > 0 && (
          <section>
            <SectionHeader title="Negocios" action={<Link to="/negocios" className="link small">Ver todos</Link>} />
            <div className="grid-2">{f.businesses.map((b) => <BusinessCard key={b.id} b={b} />)}</div>
          </section>
        )}

        <section className="sell-steps" aria-labelledby="sell-steps-h">
          <h2 id="sell-steps-h" className="h1">Vender toma tres pasos.</h2>
          <ol className="steps-3">
            <li>
              <span className="step-n">1</span>
              <span className="h3">Toma fotos</span>
              <span className="muted">Hasta 12, desde la cámara del teléfono. Si quieres, la IA propone el título y la descripción a partir de ellas.</span>
            </li>
            <li>
              <span className="step-n">2</span>
              <span className="h3">Pon tallas y cantidades</span>
              <span className="muted">Una sola publicación para todas las tallas y colores. Cuando se vende la última unidad, esa talla se marca agotada.</span>
            </li>
            <li>
              <span className="step-n">3</span>
              <span className="h3">Recibe ofertas</span>
              <span className="muted">Acepta, rechaza o contraoferta. Antes de aceptar ves cuánto recibes después de la comisión.</span>
            </li>
          </ol>
          <div className="row">
            <Link to="/publicar" className="btn btn-primary btn-lg"><Icon name="plus" size={18} stroke={2.2} />Vender</Link>
            <Link to="/publicar?ia=1" className="btn btn-outline btn-lg"><Icon name="sparkle" size={18} />Publicar con IA</Link>
          </div>
        </section>

        <section className="band">
          <div className="band-grid">
            <div className="stack">
              <span className="h2">¿Tienes un negocio?</span>
              <span className="muted">Crea su página en MARKETZONE y paga por aparecer en el inicio o en una categoría. Cada espacio pagado se marca como publicidad y ves cuántas personas lo vieron y le dieron clic.</span>
            </div>
            <div className="row">
              <Link to="/promociona" className="btn btn-white btn-lg">Promocionar mi negocio</Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
