import { useEffect, useState } from "react";
import { useApp } from "../app/state";
import { invalidate, useAction, useQuery } from "../app/query";
import { Link, navigate, useLocation } from "../app/router";
import { BUSINESS_CATEGORIES, CAMPAIGN_KIND, CAMPAIGN_STATUS, dateOnly, money, slugify, tone } from "../app/format";
import type { Business, Campaign, CampaignKind } from "../api/types";
import { Page } from "../components/layout";
import { ProductCard } from "../components/product";
import { BusinessCard } from "../components/store";
import { Badge, Button, Callout, ConfirmButton, Empty, ErrorBox, Field, Img, Input, MoneyInput, Select, Spinner, Stat, TextArea, useToast } from "../ui/kit";
import { Icon } from "../ui/icons";
import { NeedLogin } from "./Account";
import { compressImage } from "../app/images";
import { marketingSuggestions } from "../ai/client";
import { ApiError } from "../api/backend";

export function PromoteHome() {
  const { session, account, settings } = useApp();
  const businesses = account?.businesses ?? [];
  return (
    <Page>
      <div className="stack-xl">
        <section className="band">
          <div className="band-grid">
            <div className="stack">
              <span className="eyebrow">Promociona tu negocio</span>
              <h1 className="h1">Haz que tu negocio se vea en MARKETZONE.</h1>
              <span className="muted">Crea una página comercial con catálogo, horarios y contacto. Después, destácala en la portada, promociona productos o publica promociones temporales.</span>
            </div>
            <div className="row">
              <Link to={session ? "/promociona/negocio" : "/entrar?next=/promociona/negocio"} className="btn btn-primary btn-lg">{businesses.length ? "Nueva página" : "Crear página de negocio"}</Link>
              <Link to={session ? "/promociona/campana" : "/entrar?next=/promociona/campana"} className="btn btn-outline btn-lg">Crear campaña</Link>
            </div>
          </div>
        </section>
        <section className="grid-3">
          {(Object.keys(CAMPAIGN_KIND) as CampaignKind[]).map((k) => (
            <div key={k} className="panel stack" style={{ gap: 6 }}><span className="h3">{CAMPAIGN_KIND[k].label}</span><span className="small muted">{CAMPAIGN_KIND[k].hint}</span></div>
          ))}
        </section>
        <section className="stack">
          <span className="eyebrow">Cómo funciona y qué cuesta</span>
          <div className="grid-3">
            <div className="panel stack" style={{ gap: 6 }}><span className="h3">1. Configura</span><span className="small muted">Eliges qué promocionar, el tipo de espacio, la duración y el presupuesto. Ves una vista previa.</span></div>
            <div className="panel stack" style={{ gap: 6 }}><span className="h3">2. Revisión</span><span className="small muted">El equipo de MARKETZONE revisa que el anuncio cumpla las normas (sin descuentos ni testimonios inventados).</span></div>
            <div className="panel stack" style={{ gap: 6 }}><span className="h3">3. Pago y activación</span><span className="small muted">Pagas exactamente el presupuesto indicado (mínimo {money(settings?.min_campaign_cents ?? 500)}). La campaña se activa solo cuando el pago está confirmado.</span></div>
          </div>
          {settings?.test_mode && <Callout kind="warn">Modo de prueba: los pagos de campañas son simulados y no se cobra dinero real. Las campañas así activadas se marcan como “prueba”.</Callout>}
          <span className="small dim">Todo espacio pagado se muestra con la etiqueta “Patrocinado”. Las impresiones y clics no son ventas: las ventas atribuidas solo se mostrarán cuando puedan medirse de forma fiable.</span>
        </section>
        {session && (
          <section className="stack">
            <div className="row between"><span className="h2">Mis negocios</span><Link to="/promociona/campanas" className="link small">Mis campañas</Link></div>
            {businesses.length ? <div className="grid-2">{businesses.map((b) => (
              <div key={b.id} className="stack" style={{ gap: 6 }}>
                <BusinessCard b={{ ...b, description: b.description, store_slug: null }} />
                <div className="row"><Link to={`/promociona/negocio/${b.id}`} className="btn btn-ghost btn-sm"><Icon name="edit" size={16} />Editar</Link><Link to={`/promociona/campana?negocio=${b.id}`} className="btn btn-ghost btn-sm"><Icon name="megaphone" size={16} />Promocionar</Link></div>
              </div>))}</div>
              : <Empty icon="store" title="Aún no tienes páginas de negocio" action={<Link to="/promociona/negocio" className="btn btn-primary">Crear página</Link>} />}
          </section>
        )}
      </div>
    </Page>
  );
}

export function BusinessEditor({ id }: { id?: string }) {
  const { session, account, api, backend, reloadAccount } = useApp();
  const toast = useToast();
  const existing = account?.businesses.find((b) => b.id === id);
  const [f, setF] = useState<Partial<Business>>(existing ?? { category: "moda", contact: {}, hours: {}, social_links: {} });
  const [hoursText, setHoursText] = useState(Object.entries(existing?.hours ?? {}).map(([d, h]) => `${d}: ${h}`).join("\n"));
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (existing && !f.id) { setF(existing); setHoursText(Object.entries(existing.hours ?? {}).map(([d, h]) => `${d}: ${h}`).join("\n")); } }, [existing]); // eslint-disable-line
  const save = useAction(() => {
    const hours = Object.fromEntries(hoursText.split("\n").map((l) => l.split(":")).filter((p) => p.length >= 2 && p[0].trim()).map(([d, ...h]) => [d.trim(), h.join(":").trim()]));
    return api.saveBusiness({ ...f, hours, slug: f.slug || slugify(f.name ?? "") });
  }, { onSuccess: (b) => { reloadAccount(); invalidate("business"); toast("Página guardada", "ok"); navigate(`/negocio/${b.slug}`); } });
  if (!session) return <NeedLogin next="/promociona/negocio" />;
  if (id && !account) return <Page><Spinner /></Page>;
  const upload = async (k: "logo_url" | "cover_url", file?: File) => {
    if (!file) return;
    setBusy(k);
    try { const up = await backend.uploadImage(await compressImage(file, k === "logo_url" ? 500 : 1600), { bucket: "media", ext: "jpg" }); setF((x) => ({ ...x, [k]: up.url })); }
    catch (e: any) { toast(e.message, "bad"); } finally { setBusy(null); }
  };
  return (
    <Page narrow>
      <form className="stack-lg" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
        <div className="stack" style={{ gap: 6 }}><h1 className="h1">{id ? "Editar negocio" : "Crear página de negocio"}</h1></div>
        <div className="cover accent-crimson" style={{ height: 130 }}>{f.cover_url ? <Img src={f.cover_url} alt="" /> : <div className="cover-grid" />}</div>
        <div className="row">
          <label className="btn btn-outline btn-sm">{busy === "logo_url" ? <span className="spin" /> : <Icon name="camera" size={16} />}Logotipo<input type="file" accept="image/*" hidden onChange={(e) => void upload("logo_url", e.target.files?.[0])} /></label>
          <label className="btn btn-outline btn-sm">{busy === "cover_url" ? <span className="spin" /> : <Icon name="camera" size={16} />}Portada<input type="file" accept="image/*" hidden onChange={(e) => void upload("cover_url", e.target.files?.[0])} /></label>
        </div>
        <Field label="Nombre del negocio" required><Input value={f.name ?? ""} maxLength={80} required onChange={(e) => setF({ ...f, name: e.target.value, slug: id ? f.slug : slugify(e.target.value) })} /></Field>
        <Field label="Dirección de la página" hint={`…/negocio/${f.slug || "tu-negocio"}`}><Input value={f.slug ?? ""} onChange={(e) => setF({ ...f, slug: slugify(e.target.value) })} /></Field>
        <div className="grid-2">
          <Field label="Categoría"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(BUSINESS_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Ubicación general (opcional)" hint="Ciudad o zona; no pongas tu dirección exacta si no quieres."><Input value={f.location ?? ""} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        </div>
        <Field label="Descripción" hint={`${(f.description ?? "").length}/2000`}><TextArea value={f.description ?? ""} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Horario (una línea por día o rango)" hint="Formato: Lun–Vie: 10:00–18:00"><TextArea value={hoursText} onChange={(e) => setHoursText(e.target.value)} style={{ minHeight: 80 }} /></Field>
        <div className="grid-2">
          <Field label="Correo de contacto (opcional)"><Input type="email" value={f.contact?.email ?? ""} onChange={(e) => setF({ ...f, contact: { ...f.contact, email: e.target.value } })} /></Field>
          <Field label="Teléfono / WhatsApp (opcional)"><Input type="tel" value={f.contact?.phone ?? ""} onChange={(e) => setF({ ...f, contact: { ...f.contact, phone: e.target.value } })} /></Field>
          <Field label="Instagram (enlace)"><Input type="url" value={f.social_links?.instagram ?? ""} onChange={(e) => setF({ ...f, social_links: { ...f.social_links, instagram: e.target.value } })} /></Field>
          <Field label="Sitio web"><Input type="url" value={f.social_links?.website ?? ""} onChange={(e) => setF({ ...f, social_links: { ...f.social_links, website: e.target.value } })} /></Field>
        </div>
        <Field label="Catálogo vinculado" hint="Muestra en la página los productos de una de tus tiendas.">
          <Select value={f.store_id ?? ""} onChange={(e) => setF({ ...f, store_id: e.target.value || null })}>
            <option value="">Sin catálogo</option>{account?.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Información para clientes (opcional)" hint="Políticas de cambios, cómo comprar, servicios permitidos…"><TextArea value={f.customer_info ?? ""} maxLength={2000} onChange={(e) => setF({ ...f, customer_info: e.target.value })} /></Field>
        <ErrorBox error={save.error} />
        <div className="row"><Button variant="primary" size="lg" type="submit" loading={save.pending}>Guardar página</Button><Link to="/promociona" className="btn btn-ghost btn-lg">Cancelar</Link></div>
      </form>
    </Page>
  );
}

export function CampaignWizard() {
  const { session, account, api, backend, settings, categories } = useApp();
  const toast = useToast();
  const loc = useLocation();
  const catalog = useQuery(session ? "catalog:promo" : null, () => api.catalog({ status: "active", limit: 100 }));
  const [f, setF] = useState({ kind: "promoted_product" as CampaignKind, business_id: loc.query.get("negocio") ?? "", store_id: "", product_id: loc.query.get("producto") ?? "",
    headline: "", body: "", budget_cents: (settings?.min_campaign_cents ?? 500) * 5 as number | null, duration_days: 7, category_id: "" });
  const [ideas, setIdeas] = useState<{ title: string; text: string }[]>([]);
  const [ideasBusy, setIdeasBusy] = useState(false);
  const [ideasError, setIdeasError] = useState<ApiError | null>(null);
  const create = useAction(async (submit: boolean) => {
    const c = await api.saveCampaign({ ...f, business_id: f.business_id || null, store_id: f.store_id || null, product_id: f.product_id || null, category_id: f.category_id || null });
    return submit ? api.submitCampaign(c.id) : c;
  }, { invalidates: ["campaigns", "dashboard"], onSuccess: (c) => { toast(c.status === "pending_review" ? "Campaña enviada a revisión" : "Borrador guardado", "ok"); navigate(`/promociona/campanas?id=${c.id}`); } });
  if (!session) return <NeedLogin next="/promociona/campana" />;
  const needsProduct = ["promoted_product", "featured_offer", "category_spotlight"].includes(f.kind);
  const needsBiz = ["home_store", "temporary_promo"].includes(f.kind);
  const products = catalog.data?.items ?? [];
  const product = products.find((p) => p.id === f.product_id);
  const biz = account?.businesses.find((b) => b.id === f.business_id);
  const getIdeas = async () => {
    setIdeasBusy(true); setIdeasError(null);
    try {
      const r = await marketingSuggestions(backend, { task: "headlines", business: biz ? { name: biz.name, category: biz.category, description: biz.description } : undefined,
        product: product ? { title: product.title, price_cents: product.price_cents } : undefined });
      setIdeas(r.suggestions);
    } catch (e: any) { setIdeasError(e); } finally { setIdeasBusy(false); }
  };
  return (
    <Page narrow>
      <div className="stack-lg">
        <h1 className="h1">Nueva campaña</h1>
        <Field label="Tipo de promoción">
          <div className="stack" style={{ gap: 6 }}>{(Object.keys(CAMPAIGN_KIND) as CampaignKind[]).map((k) => (
            <button key={k} type="button" className={`title-option ${f.kind === k ? "on" : ""}`} onClick={() => setF({ ...f, kind: k })}>
              <span className="stack" style={{ gap: 2 }}><b>{CAMPAIGN_KIND[k].label}</b><span className="small muted">{CAMPAIGN_KIND[k].hint}</span></span></button>))}</div>
        </Field>
        {needsProduct && (
          <Field label="Producto" required hint={products.length ? undefined : "Necesitas al menos un producto publicado."}>
            <Select value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })}><option value="">Elige un producto</option>{products.map((p) => <option key={p.id} value={p.id}>{p.title} · {money(p.price_cents)}</option>)}</Select>
          </Field>
        )}
        {f.kind === "category_spotlight" && (
          <Field label="Categoría donde destacar" hint="Por defecto, la del producto."><Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
            <option value="">Categoría del producto</option>{categories.filter((c) => !c.parent_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        )}
        <div className="grid-2">
          <Field label={needsBiz ? "Negocio" : "Negocio (opcional)"}>
            <Select value={f.business_id} onChange={(e) => setF({ ...f, business_id: e.target.value })}><option value="">—</option>{account?.businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
          </Field>
          {needsBiz && <Field label="o tienda"><Select value={f.store_id} onChange={(e) => setF({ ...f, store_id: e.target.value })}><option value="">—</option>{account?.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
        </div>
        {needsBiz && !account?.businesses.length && !account?.stores.length && <Callout>Primero <Link to="/promociona/negocio" className="link">crea una página de negocio</Link> o publica un producto para tener tienda.</Callout>}
        <Field label="Titular" required hint={`${f.headline.length}/80 · sin descuentos ni resultados inventados`}><Input value={f.headline} maxLength={80} onChange={(e) => setF({ ...f, headline: e.target.value })} /></Field>
        <Field label="Texto (opcional)" hint={`${f.body.length}/300`}><TextArea value={f.body} maxLength={300} onChange={(e) => setF({ ...f, body: e.target.value })} style={{ minHeight: 80 }} /></Field>
        <div className="ai-panel stack">
          <span className="ai-mark"><Icon name="sparkle" size={14} />Ideas con IA</span>
          <span className="small muted">Propuestas de titulares a partir de tu negocio o producto. Revísalas y edítalas: la IA no inventa descuentos, testimonios ni resultados.</span>
          <div><Button size="sm" variant="dark" icon="sparkle" loading={ideasBusy} onClick={() => void getIdeas()}>Sugerir titulares</Button></div>
          <ErrorBox error={ideasError} />
          {ideas.map((s, i) => <button key={i} type="button" className="title-option" onClick={() => setF({ ...f, headline: (s.title || s.text).slice(0, 80) })}><span>{s.title || s.text}</span></button>)}
        </div>
        <div className="grid-2">
          <Field label="Presupuesto (lo que pagarás)" required hint={`Mínimo ${money(settings?.min_campaign_cents ?? 500)}. Sin cargos ocultos.`}><MoneyInput cents={f.budget_cents} onChange={(v) => setF({ ...f, budget_cents: v })} /></Field>
          <Field label="Duración"><Select value={f.duration_days} onChange={(e) => setF({ ...f, duration_days: Number(e.target.value) })}>{[1, 3, 7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} día(s)</option>)}</Select></Field>
        </div>
        <div className="stack">
          <span className="eyebrow">Vista previa</span>
          <div className="preview-frame">
            {needsProduct && product ? (
              <div style={{ maxWidth: 220 }}><ProductCard p={{ id: product.id, title: product.title, brand: product.brand, price_cents: product.price_cents, compare_at_cents: product.compare_at_cents, condition: product.condition, category_id: product.category_id, status: product.status, is_demo: product.is_demo, image_url: product.image_url, sizes: product.variants.map((v) => ({ size: v.size, color: v.color, available: v.available })), available: product.available, seller: { id: "", username: "" }, store: { slug: "", name: "Tu tienda" }, is_favorite: false, sponsored: true, published_at: product.published_at, created_at: product.created_at }} /></div>
            ) : (
              <div className="promo-card"><Badge kind="accent">{f.kind === "temporary_promo" ? "Promoción" : "Patrocinado"}</Badge><span className="h3">{f.headline || "Tu titular aparecerá aquí"}</span>{f.body && <span className="small muted">{f.body}</span>}<span className="small dim">{biz?.name ?? account?.stores.find((s) => s.id === f.store_id)?.name ?? "Tu negocio"}</span></div>
            )}
          </div>
          <span className="small dim">Pagarás {money(f.budget_cents)} por {f.duration_days} día(s) una vez aprobada. La campaña no se activa sin pago confirmado.</span>
        </div>
        <ErrorBox error={create.error} />
        <div className="row"><Button variant="primary" size="lg" loading={create.pending} onClick={() => void create.run(true)}>Enviar a revisión</Button><Button variant="outline" size="lg" loading={create.pending} onClick={() => void create.run(false)}>Guardar borrador</Button></div>
      </div>
    </Page>
  );
}

export function CampaignsPage() {
  const { session, api } = useApp();
  const loc = useLocation();
  const focus = loc.query.get("id");
  const res = useQuery(session ? "campaigns" : null, () => api.campaigns());
  if (!session) return <NeedLogin next="/promociona/campanas" />;
  return (
    <Page narrow>
      <div className="stack-lg">
        <div className="row between"><h1 className="h1">Mis campañas</h1><Link to="/promociona/campana" className="btn btn-primary btn-sm"><Icon name="plus" size={16} />Nueva</Link></div>
        {res.loading ? <Spinner /> : res.data?.length ? res.data.map((c) => <CampaignCard key={c.id} c={c} open={c.id === focus} />)
          : <Empty icon="megaphone" title="Todavía no tienes campañas" action={<Link to="/promociona/campana" className="btn btn-primary">Crear campaña</Link>} />}
      </div>
    </Page>
  );
}

function CampaignCard({ c, open }: { c: Campaign; open: boolean }) {
  const { api, settings } = useApp();
  const toast = useToast();
  const [show, setShow] = useState(open);
  const stats = useQuery(show ? `campaign-stats:${c.id}` : null, () => api.campaignStats(c.id));
  const inv = ["campaigns", "home", "dashboard", `campaign-stats:${c.id}`];
  const submit = useAction(() => api.submitCampaign(c.id), { invalidates: inv, onSuccess: () => toast("Enviada a revisión", "ok") });
  const pay = useAction(() => api.payCampaignTest(c.id), { invalidates: inv, onSuccess: () => toast("Pago de prueba confirmado: campaña activa", "ok") });
  const pause = useAction((p: boolean) => api.pauseCampaign(c.id, p), { invalidates: inv });
  const del = useAction(() => api.deleteCampaign(c.id), { invalidates: inv, onSuccess: () => toast("Campaña eliminada", "ok") });
  const s = stats.data;
  const max = Math.max(1, ...(s?.daily ?? []).map((d) => d.impressions));
  return (
    <div className="panel stack">
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div className="stack" style={{ gap: 3 }}>
          <span className="eyebrow">{CAMPAIGN_KIND[c.kind].label}</span>
          <b>{c.headline}</b>
          <span className="small dim">{c.product?.title ?? c.business?.name ?? c.store?.name} · {money(c.budget_cents)} · {c.duration_days} días{c.starts_at ? ` · ${dateOnly(c.starts_at)} – ${dateOnly(c.ends_at)}` : ""}</span>
        </div>
        <span className="row" style={{ gap: 6 }}>{c.is_test && <Badge kind="demo">Prueba</Badge>}<Badge kind={tone(c.status) as "ok"}>{CAMPAIGN_STATUS[c.status]}</Badge></span>
      </div>
      {c.review_note && <span className="small muted">Nota de revisión: {c.review_note}</span>}
      {c.status === "pending_payment" && (
        <Callout kind="warn"><div className="stack" style={{ gap: 8 }}>
          <span>Aprobada. Se activará cuando se confirme el pago de <b>{money(c.budget_cents)}</b>.</span>
          {settings?.test_mode ? <div><Button size="sm" variant="primary" loading={pay.pending} onClick={() => void pay.run()}>Pagar {money(c.budget_cents)} (prueba, sin cobro)</Button></div>
            : <span>El pago real requiere el proveedor de pagos (pendiente de integración).</span>}
        </div></Callout>
      )}
      <ErrorBox error={submit.error ?? pay.error ?? pause.error ?? del.error} />
      <div className="row" style={{ gap: 6 }}>
        {c.status === "draft" && <Button size="sm" variant="primary" loading={submit.pending} onClick={() => void submit.run()}>Enviar a revisión</Button>}
        {c.status === "active" && <Button size="sm" variant="dark" icon="pause" onClick={() => void pause.run(true)}>Pausar</Button>}
        {c.status === "paused" && <Button size="sm" variant="dark" icon="play" onClick={() => void pause.run(false)}>Reanudar</Button>}
        {(c.status === "draft" || c.status === "rejected") && <ConfirmButton confirmLabel="Eliminar" onConfirm={() => void del.run()} icon="trash">Eliminar</ConfirmButton>}
        <Button size="sm" variant="ghost" icon="chart" onClick={() => setShow(!show)}>{show ? "Ocultar estadísticas" : "Estadísticas"}</Button>
      </div>
      {show && (s ? (
        <div className="stack">
          <div className="stats">
            <Stat label="Impresiones" value={s.impressions} />
            <Stat label="Clics" value={s.clicks} sub={s.ctr !== null ? `CTR ${s.ctr} %` : "—"} />
            <Stat label="Visitas" value={s.product_views} />
            <Stat label="Seguidores nuevos" value={s.new_followers} />
          </div>
          {s.daily.length > 0 && <div className="chart-bars" aria-label="Impresiones por día">{s.daily.map((d) => <div key={d.day} title={`${d.day}: ${d.impressions} impresiones, ${d.clicks} clics`} style={{ height: `${(d.impressions / max) * 100}%` }}><i style={{ height: `${d.impressions ? (d.clicks / d.impressions) * 100 : 0}%` }} /></div>)}</div>}
          <span className="small dim">{s.attribution_note}</span>
        </div>
      ) : <Spinner />)}
    </div>
  );
}

export { ErrorBox };
