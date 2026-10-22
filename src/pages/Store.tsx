import { Fragment, useEffect, useState } from "react";
import { useApp } from "../app/state";
import { useAction, useQuery } from "../app/query";
import { Link } from "../app/router";
import { BUSINESS_CATEGORIES, dateOnly } from "../app/format";
import { ProductGrid, SectionHeader } from "../components/product";
import { BusinessCard } from "../components/store";
import { Page } from "../components/layout";
import { Avatar, Badge, Button, Callout, Empty, ErrorBox, Img, Select, Spinner, Stars, useToast } from "../ui/kit";
import { Icon } from "../ui/icons";
import { ReportSheet } from "./Product";
import { BlockButton } from "../components/block";
import { t } from "../i18n";
import { mxCurrentPath, mxShare } from "../mx/fx.js";

function SocialLinks({ links }: { links: Record<string, string> }) {
  const entries = Object.entries(links ?? {}).filter(([, v]) => v && /^https?:\/\//.test(v));
  if (!entries.length) return null;
  return <div className="row">{entries.map(([k, v]) => <a key={k} href={v} target="_blank" rel="noopener noreferrer" className="chip"><Icon name="external" size={14} />{k}</a>)}</div>;
}

export function StorePage({ slug }: { slug: string }) {
  const { api, requireAuth, sessionId, session } = useApp();
  const toast = useToast();
  const res = useQuery(`store:${slug}`, () => api.store(slug));
  const [following, setFollowing] = useState<boolean | null>(null);
  const [followers, setFollowers] = useState<number | null>(null);
  const [sort, setSort] = useState("recent");
  const [reportOpen, setReportOpen] = useState(false);
  useEffect(() => { if (res.data) void api.track({ kind: "store_view", store_id: res.data.store.id, session_id: sessionId }).catch(() => null); }, [res.data?.store.id]); // eslint-disable-line
  const follow = useAction(() => api.toggleFollow(res.data!.store.id), {
    onSuccess: (r) => { setFollowing(r.following); setFollowers(r.followers); },
    onError: (e) => toast(e.message, "bad"),
  });
  if (res.loading) return <Page><Spinner /></Page>;
  if (!res.data) return <Page><ErrorBox error={res.error} onRetry={res.reload} /></Page>;
  const { store: s, products, reviews, business } = res.data;
  const isFollowing = following ?? res.data.is_following;
  const sorted = [...products].sort((a, b) => sort === "price_asc" ? a.price_cents - b.price_cents : sort === "price_desc" ? b.price_cents - a.price_cents : 0);
  const share = () => mxShare({ title: s.name, text: s.name, path: mxCurrentPath(), toast, okMsg: t("Enlace de la tienda copiado. Pégalo donde quieras.") });

  return (
    <Page>
      <div className="stack-lg">
        <div className={`cover accent-${s.accent}`}>
          {s.cover_url ? <Img src={s.cover_url} alt="" /> : <div className="cover-grid" />}
        </div>
        <div className="row between" style={{ alignItems: "flex-end", marginTop: -54, padding: "0 6px", gap: 16 }}>
          <div className="row-nw" style={{ alignItems: "flex-end", gap: 14 }}>
            <Avatar name={s.name} src={s.logo_url} size="lg" />
            <div className="stack" style={{ gap: 4, paddingBottom: 4 }}>
              <div className="row" style={{ gap: 8 }}><h1 className="h1" style={{ fontSize: "clamp(22px, 4vw, 30px)" }}>{s.name}</h1>{s.is_demo && <Badge kind="demo">{t("Tienda demo")}</Badge>}</div>
              <span className="small dim">@{s.owner?.username} {" "}{t("· desde")}{" "}{dateOnly(s.created_at)}</span>
            </div>
          </div>
          <div className="row">
            {res.data.is_owner ? <Link to="/panel/tienda" className="btn btn-dark btn-sm"><Icon name="edit" size={16} />{t("Editar tienda")}</Link>
              : <Button variant={isFollowing ? "outline" : "primary"} size="sm" loading={follow.pending} onClick={() => { if (requireAuth()) void follow.run(); }}>{isFollowing ? t("Siguiendo") : t("Seguir")}</Button>}
            <Button variant="outline" size="sm" icon="share" onClick={share}>{t("Compartir")}</Button>
          </div>
        </div>
        {s.bio && <p className="prose">{s.bio}</p>}
        <SocialLinks links={s.social_links ?? {}} />
        <div className="stats">
          <div className="stat"><div className="eyebrow">{t("Seguidores")}</div><div className="v">{followers ?? s.stats.followers}</div></div>
          <div className="stat"><div className="eyebrow">{t("Publicaciones")}</div><div className="v">{s.stats.active_listings}</div></div>
          <div className="stat"><div className="eyebrow">{t("Ventas verificadas")}</div><div className="v">{s.stats.verified_sales}</div>
            {s.stats.test_sales > 0 && <div className="s">+{s.stats.test_sales} {" "}{t("de prueba (sin dinero real)")}</div>}</div>
          <div className="stat"><div className="eyebrow">{t("Valoración")}</div>
            <div className="v">{s.stats.rating_count ? s.stats.rating_avg?.toFixed(1) : "—"}</div>
            <div className="s">{s.stats.rating_count ? t("{0} reseñas de compras completadas", [s.stats.rating_count]) : t("Sin reseñas todavía")}</div></div>
        </div>
        {business && <BusinessCard b={business} />}

        <section>
          <SectionHeader title={t("Catálogo")} note={products.length === 1 ? t("1 artículo") : t("{0} artículos", [products.length])} action={
            <div style={{ width: 180 }}><Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t("Ordenar catálogo")}>
              <option value="recent">{t("Más recientes")}</option><option value="price_asc">{t("Precio ascendente")}</option><option value="price_desc">{t("Precio descendente")}</option>
            </Select></div>} />
          {sorted.length ? <ProductGrid items={sorted} /> : <Empty title={t("Sin productos publicados")} icon="store">{t("Esta tienda todavía no tiene publicaciones activas.")}</Empty>}
        </section>

        <section>
          <SectionHeader title={t("Reseñas")} note={t("Solo pueden dejarlas quienes recibieron un pedido de esta tienda.")} />
          {reviews.length ? (
            <div className="stack">{reviews.map((r) => (
              <div key={r.id} className="panel stack" style={{ gap: 6 }}>
                <div className="row between"><Stars value={r.rating} /><span className="small dim">{dateOnly(r.created_at)}</span></div>
                {r.body && <p>{r.body}</p>}
                <span className="small dim">@{r.reviewer.username}{r.is_test ? t(" · compra de prueba") : t(" · compra verificada")}</span>
              </div>
            ))}</div>
          ) : <Empty icon="star" title={t("Sin reseñas todavía")}>{t("Las reseñas solo pueden dejarlas compradores con un pedido entregado.")}</Empty>}
        </section>
        {session && !res.data.is_owner && <div className="row"><Button variant="ghost" size="sm" icon="flag" onClick={() => setReportOpen(true)}>{t("Reportar tienda")}</Button><BlockButton userId={s.owner.id} username={s.owner.username} /></div>}
      </div>
      <ReportSheet open={reportOpen} onClose={() => setReportOpen(false)} targetType="store" targetId={s.id} />
    </Page>
  );
}

export function BusinessPage({ slug }: { slug: string }) {
  const { api, sessionId } = useApp();
  const toast = useToast();
  const res = useQuery(`business:${slug}`, () => api.business(slug));
  useEffect(() => { if (res.data) void api.track({ kind: "business_view", business_id: res.data.business.id, session_id: sessionId }).catch(() => null); }, [res.data?.business.id]); // eslint-disable-line
  if (res.loading) return <Page><Spinner /></Page>;
  if (!res.data) return <Page><ErrorBox error={res.error} onRetry={res.reload} /></Page>;
  const { business: b, store, products, promotions } = res.data;
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast(t("Copiado"), "ok"); } catch { toast(text); } };
  const contact = Object.entries(b.contact ?? {}).filter(([, v]) => v);
  return (
    <Page>
      <div className="stack-lg">
        <div className="cover accent-crimson">{b.cover_url ? <Img src={b.cover_url} alt="" /> : <div className="cover-grid" />}</div>
        <div className="row-nw" style={{ marginTop: -54, padding: "0 6px", alignItems: "flex-end", gap: 14 }}>
          <Avatar name={b.name} src={b.logo_url} size="lg" />
          <div className="stack" style={{ gap: 4, paddingBottom: 4 }}>
            <div className="row" style={{ gap: 8 }}><h1 className="h1" style={{ fontSize: "clamp(22px, 4vw, 30px)" }}>{b.name}</h1>{b.is_demo && <Badge kind="demo">{t("Negocio demo")}</Badge>}</div>
            <span className="eyebrow">{BUSINESS_CATEGORIES[b.category]}{b.location ? ` · ${b.location}` : ""}</span>
          </div>
        </div>
        {res.data.is_owner && <div className="row"><Link to={`/promociona/negocio/${b.id}`} className="btn btn-dark btn-sm"><Icon name="edit" size={16} />{t("Editar página")}</Link><Link to="/promociona/campana" className="btn btn-primary btn-sm"><Icon name="megaphone" size={16} />{t("Crear campaña")}</Link></div>}
        {promotions.map((p) => (
          <div key={p.id} className="promo-card"><div className="row between"><Badge kind="accent">{t("Promoción")}</Badge>{p.is_test && <Badge kind="demo">{t("Prueba, sin cobro")}</Badge>}</div>
            <span className="h3">{p.headline}</span>{p.body && <span className="muted small">{p.body}</span>}</div>
        ))}
        <div className="grid-2" style={{ alignItems: "start" }}>
          <div className="stack">
            <span className="eyebrow">{t("Sobre el negocio")}</span>
            <p className="prose">{b.description || t("Sin descripción.")}</p>
            {b.customer_info && <Callout>{b.customer_info}</Callout>}
            <SocialLinks links={b.social_links} />
          </div>
          <div className="panel stack">
            {Object.keys(b.hours ?? {}).length > 0 && (
              <div className="stack" style={{ gap: 6 }}><span className="eyebrow">{t("Horario")}</span>
                <dl className="kv">{Object.entries(b.hours).map(([d, h]) => <Fragment key={d}><dt>{d}</dt><dd>{h}</dd></Fragment>)}</dl></div>
            )}
            {contact.length > 0 && (
              <div className="stack" style={{ gap: 6 }}><span className="eyebrow">{t("Contacto")}</span>
                {contact.map(([k, v]) => (
                  <div key={k} className="row between"><span className="small"><span className="dim">{k}: </span><span className="mono">{v}</span></span>
                    <Button size="sm" variant="ghost" icon="copy" onClick={() => copy(v)}>{t("Copiar")}</Button></div>
                ))}</div>
            )}
            {b.location && <span className="small muted row-nw"><Icon name="map" size={16} />{b.location} {" "}{t("(ubicación general)")}</span>}
          </div>
        </div>
        {store && (
          <section>
            <SectionHeader title={t("Catálogo de {0}", [store.name])} action={<Link to={`/tienda/${store.slug}`} className="link small">{t("Ver tienda")}</Link>} />
            {products.length ? <ProductGrid items={products} /> : <Empty title={t("Sin productos todavía")} />}
          </section>
        )}
      </div>
    </Page>
  );
}

export function BusinessesPage() {
  const { api } = useApp();
  const [cat, setCat] = useState("");
  const res = useQuery(`businesses:${cat}`, () => api.businesses({ category: cat || undefined }));
  return (
    <Page>
      <div className="stack-lg">
        <div className="row between">
          <h1 className="h1">{t("Negocios")}</h1>
          <Link to="/promociona" className="btn btn-primary"><Icon name="megaphone" size={18} />{t("Promociona tu negocio")}</Link>
        </div>
        <div className="cat-strip">
          <button className={`chip ${!cat ? "on" : ""}`} onClick={() => setCat("")}>{t("Todos")}</button>
          {Object.entries(BUSINESS_CATEGORIES).map(([k, v]) => <button key={k} className={`chip ${cat === k ? "on" : ""}`} onClick={() => setCat(k)}>{v}</button>)}
        </div>
        <ErrorBox error={res.error} onRetry={res.reload} />
        {res.loading ? <Spinner /> : res.data?.length ? <div className="grid-2">{res.data.map((b) => <BusinessCard key={b.id} b={b} />)}</div>
          : <Empty icon="store" title={t("No hay negocios en esta categoría")} action={<Link to="/promociona/negocio" className="btn btn-outline">{t("Crear página de negocio")}</Link>} />}
        <span className="small dim">{t("Los negocios marcados como “Patrocinado” pagaron por aparecer primero.")}</span>
      </div>
    </Page>
  );
}
