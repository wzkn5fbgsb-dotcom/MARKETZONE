import { useApp } from "../app/state";
import { useQuery } from "../app/query";
import { Link, withQuery } from "../app/router";
import { GridSkeleton, ProductGrid, Rail, SectionHeader } from "../components/product";
import { BusinessCard, StoreCard } from "../components/store";
import { Badge, Button, ErrorBox, Img } from "../ui/kit";
import { Icon } from "../ui/icons";
import { artDataUri } from "../app/art";

const CAT_ART: Record<string, string> = {
  ropa: "art:jacket:denim:stone:0:", sneakers: "art:sneaker:white:noir:0:crimson", streetwear: "art:hoodie:heather:fog:0:",
  accesorios: "art:cap:black:stone:0:", bolsos: "art:crossbody:tan:blush:0:", belleza: "art:serum:amber:sage:0:cream",
};

export default function Home() {
  const { api, categories, config } = useApp();
  const feed = useQuery("home", () => api.home());
  const top = categories.filter((c) => !c.parent_id);
  const f = feed.data;
  const collage = (f?.featured.length ? f.featured : f?.recent ?? []).slice(0, 3);
  const empty = f && !f.recent.length;

  return (
    <main className="page" style={{ paddingTop: 0 }}>
      <div className="wrap stack-xl">
        <section className="hero">
          <div className="stack-lg">
            <span className="eyebrow">Moda · Sneakers · Streetwear · Reventa</span>
            <h1 className="display">Compra, vende y <em>negocia</em> en tu zona.</h1>
            <p className="hero-lede">Publica una vez con todas tus tallas, recibe ofertas, vende con stock que nunca se duplica y crea publicaciones con IA desde el teléfono.</p>
            <div className="row">
              <Link to="/publicar" className="btn btn-primary btn-lg"><Icon name="plus" size={18} />Vender ahora</Link>
              <Link to="/promociona" className="btn btn-outline btn-lg"><Icon name="megaphone" size={18} />Promociona tu negocio</Link>
            </div>
          </div>
          <div className="hero-collage">
            {collage.map((p) => (
              <Link key={p.id} to={`/p/${p.id}`} className="zone" aria-label={p.title}><Img src={p.image_url} alt={p.title} loading="eager" /></Link>
            ))}
          </div>
        </section>

        <section>
          <SectionHeader title="Categorías" eyebrow="Explora" action={<Link to="/explorar" className="link small">Ver todo</Link>} />
          <div className="cat-tiles">
            {(top.length ? top : []).map((c) => (
              <Link key={c.id} to={withQuery("/explorar", { cat: c.id })} className="cat-tile">
                <img src={artDataUri(CAT_ART[c.id] ?? "art:tee:black:stone:0:")} alt="" loading="lazy" />
                <span>{c.name}</span>
                <small>{c.active_count} publicaciones</small>
              </Link>
            ))}
            {!top.length && Array.from({ length: 6 }, (_, i) => <div key={i} className="skel" style={{ aspectRatio: "1 / 1.05", borderRadius: 14 }} />)}
          </div>
        </section>

        <ErrorBox error={feed.error} onRetry={feed.reload} />
        {feed.loading && <GridSkeleton />}

        {f && f.promoted.length > 0 && (
          <section>
            <SectionHeader title="Productos promocionados" eyebrow="Patrocinado" note="Publicaciones pagadas por sus vendedores. Siempre se identifican como publicidad." />
            <Rail items={f.promoted} />
          </section>
        )}

        {f && f.featured.length > 0 && (
          <section>
            <SectionHeader title="Destacados" eyebrow="Selección" action={<Link to={withQuery("/explorar", { sort: "popular" })} className="link small">Más populares</Link>} />
            <ProductGrid items={f.featured} />
          </section>
        )}

        {f && f.deals.length > 0 && (
          <section>
            <SectionHeader title="Bajaron de precio" eyebrow="Descuentos reales" note="Solo aparecen artículos cuyo precio anterior estuvo publicado." action={<Link to={withQuery("/explorar", { deals: 1 })} className="link small">Ver todos</Link>} />
            <Rail items={f.deals} />
          </section>
        )}

        {f && f.promos.length > 0 && (
          <section className="grid-2">
            {f.promos.map((p) => (
              <Link key={p.campaign_id} to={p.business ? `/negocio/${p.business.slug}` : p.store ? `/tienda/${p.store.slug}` : "/negocios"} className="promo-card">
                <div className="row between"><Badge kind="accent">Promoción</Badge>{p.is_test && <Badge kind="demo">Demo · sin cobro</Badge>}</div>
                <span className="h3">{p.headline}</span>
                {p.body && <span className="small muted">{p.body}</span>}
                <span className="small dim">{p.business?.name ?? p.store?.name}</span>
              </Link>
            ))}
          </section>
        )}

        {f && f.recent.length > 0 && (
          <section>
            <SectionHeader title="Recién publicado" eyebrow="Novedades" action={<Link to="/explorar" className="link small">Explorar</Link>} />
            <ProductGrid items={f.recent} wide />
          </section>
        )}

        {empty && (
          <section className="band">
            <div className="stack">
              <span className="h2">Todavía no hay publicaciones.</span>
              <span className="muted">Sé de los primeros vendedores de MARKETZONE: tus productos aparecerán aquí en cuanto los publiques.</span>
              <div><Link to="/publicar" className="btn btn-primary">Publicar mi primer producto</Link></div>
            </div>
          </section>
        )}

        {f && (f.stores.length > 0 || f.sponsored_stores.length > 0) && (
          <section>
            <SectionHeader title="Tiendas populares" eyebrow="Tiendas" />
            <div className="grid-3">{[...f.sponsored_stores, ...f.stores.filter((s) => !f.sponsored_stores.some((x) => x.id === s.id))].slice(0, 8).map((s) => <StoreCard key={s.id} s={s} />)}</div>
          </section>
        )}

        {f && f.businesses.length > 0 && (
          <section>
            <SectionHeader title="Negocios destacados" eyebrow="Negocios" action={<Link to="/negocios" className="link small">Directorio</Link>} />
            <div className="grid-2">{f.businesses.map((b) => <BusinessCard key={b.id} b={b} />)}</div>
          </section>
        )}

        <section className="band">
          <div className="band-grid">
            <div className="stack">
              <span className="ai-mark"><Icon name="sparkle" size={14} />Crear publicación con IA</span>
              <span className="h2">Sube fotos. Revisa la propuesta. Publica.</span>
              <span className="muted">La IA sugiere título, descripción, categoría y atributos visibles. Señala lo que no puede confirmar —talla, material, autenticidad— para que tú decidas.</span>
            </div>
            <div className="row">
              <Link to="/publicar?ia=1" className="btn btn-primary btn-lg"><Icon name="sparkle" size={18} />Crear con IA</Link>
              <Link to="/publicar" className="btn btn-outline btn-lg">Publicar manualmente</Link>
            </div>
          </div>
        </section>

        <section className="band" style={{ background: "var(--bg-2)" }}>
          <div className="band-grid">
            <div className="stack">
              <span className="eyebrow">Para negocios</span>
              <span className="h2">Promociona tu negocio en MARKETZONE.</span>
              <span className="muted">Página comercial propia, productos destacados y campañas con estadísticas. Cada espacio pagado se identifica como publicidad.</span>
            </div>
            <div className="row">
              <Link to="/promociona" className="btn btn-white btn-lg">Empezar</Link>
              {config.mode === "demo" && <Button variant="ghost" onClick={() => undefined} disabled>Pagos en modo de prueba</Button>}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
