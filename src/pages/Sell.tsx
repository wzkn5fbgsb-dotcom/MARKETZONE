import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../app/state";
import { invalidate, useQuery } from "../app/query";
import { Link, navigate, useLocation } from "../app/router";
import { CONDITIONS, money, pct } from "../app/format";
import type { Category, Condition, ListingInput } from "../api/types";
import { ApiError } from "../api/backend";
import { Page } from "../components/layout";
import { Badge, Button, Callout, ErrorBox, Field, Img, Input, MoneyInput, Select, Spinner, TextArea, Toggle, useToast } from "../ui/kit";
import { Icon } from "../ui/icons";
import { compressImage } from "../app/images";
import { aiStatus, analyzeListing, type AiStatus, type ListingAiResult } from "../ai/client";
import { NeedLogin } from "./Account";
import { t } from "../i18n";

type Photo = { url: string; storage_path?: string | null; preview?: string; uploading?: boolean };
type VRow = { id?: string; size: string | null; color: string | null; stock_on_hand: number; stock_reserved?: number };

const PRESETS: Record<string, string[]> = {
  apparel: ["XS", "S", "M", "L", "XL", "XXL"],
  shoes: ["US 6", "US 6.5", "US 7", "US 7.5", "US 8", "US 8.5", "US 9", "US 9.5", "US 10", "US 10.5", "US 11", "US 12", "US 13"],
  numeric: ["26", "28", "29", "30", "31", "32", "33", "34", "36", "38"],
  one_size: [t("Única")],
  none: [],
};

export default function Sell({ id }: { id?: string }) {
  const { session, api } = useApp();
  const existing = useQuery(session && id ? `listing-edit:${id}` : null, () => api.listingForEdit(id!));
  if (!session) return <NeedLogin next={id ? `/publicar/${id}` : "/publicar"} />;
  if (id && existing.loading) return <Page><Spinner /></Page>;
  if (id && existing.error) return <Page><ErrorBox error={existing.error} /></Page>;
  return <ListingEditor key={id ?? "new"} initial={id ? existing.data : undefined} />;
}

function ListingEditor({ initial }: { initial?: any }) {
  const { api, backend, categories, settings, account, reloadAccount } = useApp();
  const toast = useToast();
  const loc = useLocation();
  const isEdit = !!initial;
  const [photos, setPhotos] = useState<Photo[]>(initial?.images ?? []);
  const [f, setF] = useState({
    title: initial?.title ?? "", description: initial?.description ?? "", brand: initial?.brand ?? "", category_id: initial?.category_id ?? loc.query.get("cat") ?? "",
    condition: (initial?.condition ?? "") as Condition | "", flaws: initial?.flaws ?? "", color: initial?.color ?? "", material: initial?.material ?? "",
    fit: initial?.fit ?? "", price_cents: (initial?.price_cents ?? null) as number | null, tags: (initial?.tags ?? []) as string[],
    offers_enabled: initial?.offers_enabled ?? true, weight_grams: initial?.weight_grams ?? "", length_cm: initial?.length_cm ?? "",
    width_cm: initial?.width_cm ?? "", height_cm: initial?.height_cm ?? "", store_id: initial?.store_id ?? "", ai_assisted: initial?.ai_assisted ?? false,
  });
  const [variants, setVariants] = useState<VRow[]>(initial?.variants?.length ? initial.variants : [{ size: null, color: null, stock_on_hand: 1 }]);
  const [errors, setErrors] = useState<{ field?: string; message: string } | null>(null);
  const [saving, setSaving] = useState<null | "draft" | "active">(null);
  const [tagText, setTagText] = useState("");
  const [showShipping, setShowShipping] = useState(!!initial?.weight_grams);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<ApiError | null>(null);
  const [proposal, setProposal] = useState<ListingAiResult | null>(null);
  const [known, setKnown] = useState({ notes: "", price_idea: "" });
  const top = useRef<HTMLDivElement>(null);
  const wantsAi = loc.query.get("ia") === "1";

  useEffect(() => { void aiStatus(backend).then(setAi); }, [backend]);
  const cat = categories.find((c) => c.id === f.category_id);
  const parentCat = cat?.parent_id ? categories.find((c) => c.id === cat.parent_id) : cat;
  const sizeSystem = cat?.size_system ?? parentCat?.size_system ?? "apparel";
  const required = cat?.required_fields ?? [];
  const uploading = photos.some((p) => p.uploading);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const err = (field: string) => (errors?.field === field ? errors.message : null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files].slice(0, 12 - photos.length);
    for (const file of list) {
      const preview = URL.createObjectURL(file);
      setPhotos((p) => [...p, { url: "", preview, uploading: true }]);
      try {
        const blob = await compressImage(file, 1600, 0.85);
        const up = await backend.uploadImage(blob, { bucket: "product-images", ext: "jpg" });
        setPhotos((p) => p.map((x) => (x.preview === preview ? { url: up.url, storage_path: up.path, preview } : x)));
      } catch (e: any) {
        setPhotos((p) => p.filter((x) => x.preview !== preview));
        toast(e.message ?? t("No se pudo subir la foto. Revisa tu conexión e inténtalo de nuevo."), "bad");
      }
    }
  };

  const runAi = async () => {
    setAiBusy(true); setAiError(null);
    try {
      const res = await analyzeListing(backend, photos.filter((p) => p.url).map((p) => p.url), {
        category_hint: f.category_id || null,
        known: { brand: f.brand, size: variants.map((v) => v.size).filter(Boolean).join(", "), condition: f.condition ? CONDITIONS[f.condition].label : "", notes: known.notes, price_idea: known.price_idea },
        categories: categories.map((c) => ({ id: c.id, name: c.name, parent_id: c.parent_id })),
      });
      setProposal(res);
    } catch (e: any) {
      setAiError(e instanceof ApiError ? e : new ApiError("ai_error", t("La IA no respondió. Puedes continuar manualmente.")));
    } finally { setAiBusy(false); }
  };

  const applyProposal = (title: string) => {
    if (!proposal) return;
    setF((x) => ({
      ...x,
      title: title.slice(0, 120),
      description: proposal.description || x.description,
      category_id: x.category_id || (proposal.category_id && proposal.category_confidence !== "baja" ? proposal.category_id : x.category_id),
      brand: x.brand || (proposal.detected_brand.certainty === "visible" && proposal.detected_brand.value ? proposal.detected_brand.value : x.brand),
      color: x.color || (proposal.attributes.find((a) => /color/i.test(a.name) && a.certainty === "visible")?.value ?? x.color),
      tags: [...new Set([...x.tags, ...proposal.keywords])].slice(0, 15),
      ai_assisted: true,
    }));
    toast(t("Sugerencias aplicadas. Revisa y edita cada campo antes de publicar."), "ok");
  };

  const submit = async (status: "draft" | "active") => {
    setErrors(null);
    if (uploading) { setErrors({ field: "images", message: t("Espera a que terminen de subirse las fotos.") }); return; }
    setSaving(status);
    const payload: ListingInput = {
      id: initial?.id, store_id: f.store_id || null, category_id: f.category_id, title: f.title, description: f.description, brand: f.brand || null,
      condition: f.condition as Condition, flaws: f.flaws || null, color: f.color || null, material: f.material || null, fit: f.fit || null,
      price_cents: f.price_cents ?? 0, tags: f.tags, offers_enabled: f.offers_enabled, status, ai_assisted: f.ai_assisted,
      weight_grams: f.weight_grams ? Number(f.weight_grams) : null, length_cm: f.length_cm ? Number(f.length_cm) : null,
      width_cm: f.width_cm ? Number(f.width_cm) : null, height_cm: f.height_cm ? Number(f.height_cm) : null,
      images: photos.filter((p) => p.url).map((p) => ({ url: p.url, storage_path: p.storage_path ?? null })),
      variants: variants.map((v) => ({ id: v.id, size: v.size, color: v.color, stock_on_hand: v.stock_on_hand })),
    };
    try {
      const res = await api.saveListing(payload);
      invalidate("catalog", "dashboard", "product:", "home", "search:", `listing-edit:${res.id}`);
      reloadAccount();
      toast(res.status === "active" ? (isEdit ? t("Cambios publicados") : t("¡Publicado!")) : t("Borrador guardado"), "ok");
      navigate(res.status === "active" ? `/p/${res.id}` : "/panel/catalogo");
    } catch (e: any) {
      const field = (e?.detail as any)?.field;
      setErrors({ field, message: e.message });
      if (!field) top.current?.scrollIntoView({ behavior: "smooth" });
    } finally { setSaving(null); }
  };

  const commission = settings?.commission_bps ?? 1000;
  const totalUnits = variants.reduce((n, v) => n + (Number(v.stock_on_hand) || 0), 0);
  const groupedCats = useMemo(() => categories.filter((c) => !c.parent_id).map((p) => ({ p, children: categories.filter((c) => c.parent_id === p.id) })), [categories]);

  return (
    <Page narrow>
      <div className="stack-xl" ref={top}>
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">{isEdit ? t("Editar publicación") : t("Nueva publicación")}</span>
          <h1 className="h1">{isEdit ? f.title || t("Editar") : wantsAi ? t("Crear publicación con IA") : t("Vender un artículo")}</h1>
          {isEdit && initial.moderation_status === "blocked" && <Callout kind="bad">{t("Esta publicación fue bloqueada por moderación. Puedes editarla pero no publicarla.")}</Callout>}
        </div>
        {errors && !errors.field && <ErrorBox error={new ApiError("x", errors.message)} />}

        {/* 1 · Fotos */}
        <section className="stack">
          <div className="row between"><span className="h3">{t("1. Fotos")}</span><span className="small dim">{photos.length} {" "}{t("de 12. La primera es la portada.")}</span></div>
          <div className="photo-grid">
            {photos.map((p, i) => (
              <div key={p.preview ?? p.url} className="photo">
                <Img src={p.preview ?? p.url} alt={t("Foto {0}", [i + 1])} />
                {i === 0 && <span className="cover-tag"><Badge kind="accent">{t("Portada")}</Badge></span>}
                {p.uploading && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(11,11,13,.55)" }}><span className="spin" /></div>}
                {!p.uploading && (
                  <div className="ph-actions">
                    {i > 0 ? <button type="button" aria-label={t("Usar como portada")} onClick={() => setPhotos((x) => [x[i], ...x.filter((_, j) => j !== i)])}><Icon name="star" size={15} /></button> : <span />}
                    <button type="button" aria-label={t("Eliminar foto")} onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))}><Icon name="trash" size={15} /></button>
                  </div>
                )}
              </div>
            ))}
            {photos.length < 12 && (
              <label className="photo-add">
                <Icon name="camera" size={24} />
                <span>{t("Añadir fotos")}</span>
                <span className="tiny dim">{t("Cámara o galería")}</span>
                <input type="file" accept="image/*" multiple hidden onChange={(e) => { void onFiles(e.target.files); e.currentTarget.value = ""; }} />
              </label>
            )}
          </div>
          {err("images") && <span className="error-text">{err("images")}</span>}
          <span className="small dim">{t("Consejo: luz natural, fondo liso, foto de la etiqueta, de la suela (sneakers) y de cualquier defecto de cerca.")}</span>
        </section>

        {/* IA */}
        <section className="ai-panel stack">
          <div className="row between"><span className="ai-mark"><Icon name="sparkle" size={14} />{t("Crear publicación con IA")}</span>
            {ai && <Badge kind={ai.available ? "ok" : "outline"}>{ai.available ? (ai.provider === "claude-viewer" ? t("Disponible") : t("Disponible")) : t("No configurada")}</Badge>}</div>
          {!ai ? <span className="small dim">{t("Comprobando disponibilidad…")}</span> : !ai.available ? (
            <span className="small muted">{ai.reason}</span>
          ) : (
            <>
              <span className="small muted">{t("La IA analiza tus fotos y propone título, descripción, categoría y atributos visibles. No inventa modelos, tallas ni materiales, y nunca afirma autenticidad. Tú revisas todo antes de publicar.")}</span>
              <div className="grid-2">
                <Field label={t("Datos que ya conoces (opcional)")} hint={t("Marca, talla, medidas, detalles…")}><Input value={known.notes} onChange={(e) => setKnown({ ...known, notes: e.target.value })} placeholder={t("p. ej. talla M, medidas 60×70 cm")} /></Field>
                <Field label={t("Idea de precio (opcional)")}><Input value={known.price_idea} onChange={(e) => setKnown({ ...known, price_idea: e.target.value })} placeholder={t("p. ej. unos $40")} /></Field>
              </div>
              <div className="row">
                <Button variant="primary" icon="sparkle" loading={aiBusy} disabled={!photos.some((p) => p.url) || uploading} onClick={() => void runAi()}>
                  {proposal ? t("Analizar de nuevo") : t("Analizar fotos")}
                </Button>
                {!photos.some((p) => p.url) && <span className="small dim">{t("Añade al menos una foto.")}</span>}
                {aiBusy && <span className="small dim">{t("Analizando… puede tardar hasta un minuto.")}</span>}
              </div>
            </>
          )}
          <ErrorBox error={aiError} />
          {proposal && <ProposalView p={proposal} categories={categories} onApply={applyProposal} />}
        </section>

        {/* 2 · Datos */}
        <section className="stack">
          <span className="h3">{t("2. Qué vendes")}</span>
          <Field label={t("Título")} required error={err("title")} hint={`${f.title.length}/120`}>
            <Input value={f.title} maxLength={120} onChange={(e) => set("title", e.target.value)} placeholder={t("Marca + tipo + color + detalle")} />
          </Field>
          <Field label={t("Categoría")} required error={err("category_id")}>
            <Select value={f.category_id} onChange={(e) => set("category_id", e.target.value)}>
              <option value="">{t("Selecciona una categoría")}</option>
              {groupedCats.map(({ p, children }) => (
                <optgroup key={p.id} label={p.name}>
                  <option value={p.id}>{p.name} {" "}{t("(general)")}</option>
                  {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label={t("Estado del artículo")} required error={err("condition")}>
            <div className="segmented">
              {(Object.keys(CONDITIONS) as Condition[]).map((c) => (
                <button type="button" key={c} className={`seg ${f.condition === c ? "on" : ""}`} onClick={() => set("condition", c)} title={CONDITIONS[c].hint}>
                  {CONDITIONS[c].label}
                </button>
              ))}
            </div>
          </Field>
          {f.condition === "used_flawed" && (
            <Field label={t("Describe los defectos")} required error={err("flaws")} hint={t("Sé específico: ubicación, tamaño y tipo de defecto.")}>
              <TextArea value={f.flaws} onChange={(e) => set("flaws", e.target.value)} maxLength={1000} />
            </Field>
          )}
          <div className="grid-2">
            <Field label={t("Marca")} required={required.includes("brand")} error={err("brand")}><Input value={f.brand} maxLength={60} onChange={(e) => set("brand", e.target.value)} /></Field>
            <Field label={t("Color")}><Input value={f.color} maxLength={40} onChange={(e) => set("color", e.target.value)} /></Field>
            <Field label={t("Material")} hint={t("Solo si lo conoces (etiqueta).")}><Input value={f.material} maxLength={80} onChange={(e) => set("material", e.target.value)} /></Field>
            {(sizeSystem === "apparel" || sizeSystem === "numeric") && <Field label={t("Ajuste")}><Select value={f.fit} onChange={(e) => set("fit", e.target.value)}>
              <option value="">—</option>{[t("Slim"), t("Regular"), t("Relaxed"), t("Oversize"), t("Boxy"), t("Cropped")].map((x) => <option key={x}>{x}</option>)}</Select></Field>}
          </div>
          <Field label={t("Descripción")} error={err("description")} hint={`${f.description.length}/5000`}>
            <TextArea value={f.description} maxLength={5000} onChange={(e) => set("description", e.target.value)} placeholder={t("Medidas, estado real, detalles, qué incluye…")} />
          </Field>
          <Field label={t("Etiquetas")} error={err("tags")} hint={t("Pulsa Enter para añadir. Máximo 15.")}>
            <div className="row" style={{ gap: 6 }}>
              {f.tags.map((t) => <button type="button" key={t} className="chip on" onClick={() => set("tags", f.tags.filter((x) => x !== t))}>#{t}<span className="x">×</span></button>)}
              <input className="input" style={{ flex: "1 1 160px", minHeight: 38 }} value={tagText} placeholder={t("añadir etiqueta")} onChange={(e) => setTagText(e.target.value)}
                onKeyDown={(e) => { if ((e.key === "Enter" || e.key === ",") && tagText.trim()) { e.preventDefault(); set("tags", [...new Set([...f.tags, tagText.trim().toLowerCase()])].slice(0, 15)); setTagText(""); } }} />
            </div>
          </Field>
        </section>

        {/* 3 · Inventario */}
        <section className="stack">
          <div className="row between"><span className="h3">{t("3. Tallas y cantidades")}</span><span className="small dim">{totalUnits} {" "}{t("unidad(es)")}</span></div>
          <VariantEditor value={variants} onChange={setVariants} sizeSystem={sizeSystem} />
          {err("variants") && <span className="error-text">{err("variants")}</span>}
        </section>

        {/* 4 · Precio */}
        <section className="stack">
          <span className="h3">{t("4. Precio y ofertas")}</span>
          <Field label={t("Precio")} required error={err("price_cents")}><MoneyInput cents={f.price_cents} onChange={(c) => set("price_cents", c)} /></Field>
          {f.price_cents ? (
            <Callout>{t("Tarifa de MARKETZONE:")}{" "}<b>{pct(commission)}</b> {" "}{t("del precio cuando se complete la venta (≈")}{" "}{money(Math.round(f.price_cents * commission / 10000))}{t("). Recibirías ≈")}{" "}<b>{money(f.price_cents - Math.round(f.price_cents * commission / 10000))}</b> {" "}{t("por unidad. El envío (")}{money(settings?.shipping_flat_cents ?? 799)}{t(") lo paga el comprador.")}</Callout>
          ) : null}
          {isEdit && initial.status === "active" && initial.price_cents && f.price_cents && f.price_cents < initial.price_cents && (
            <span className="small" style={{ color: "var(--ok)" }}>{t("Al bajar el precio, el anterior (")}{money(initial.price_cents)}{t(") se mostrará tachado como descuento real.")}</span>
          )}
          <Toggle checked={f.offers_enabled} onChange={(v) => set("offers_enabled", v)} label={t("Aceptar ofertas (mínimo {0} % del precio)", [settings?.min_offer_percent ?? 50])} />
          <button type="button" className="link-btn small" style={{ alignSelf: "flex-start" }} onClick={() => setShowShipping(!showShipping)}>{showShipping ? t("Ocultar") : t("Añadir")} {" "}{t("peso y medidas para envío (opcional)")}</button>
          {showShipping && (
            <div className="grid-2">
              <Field label={t("Peso (g)")}><Input inputMode="numeric" value={f.weight_grams} onChange={(e) => set("weight_grams", e.target.value.replace(/\D/g, ""))} /></Field>
              <Field label={t("Largo × ancho × alto (cm)")}><div className="row-nw" style={{ gap: 6 }}>
                {(["length_cm", "width_cm", "height_cm"] as const).map((k) => <input key={k} className="input" inputMode="decimal" value={f[k]} onChange={(e) => set(k, e.target.value.replace(/[^0-9.]/g, ""))} />)}</div></Field>
            </div>
          )}
          {account && account.stores.length > 1 && (
            <Field label={t("Tienda")}><Select value={f.store_id} onChange={(e) => set("store_id", e.target.value)}>
              <option value="">{t("Tienda principal")}</option>{account.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          )}
        </section>

        {errors && errors.field && <Callout kind="bad">{errors.message}</Callout>}
        <div className="row" style={{ position: "sticky", bottom: "calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px) + 8px)", zIndex: 20, padding: 12, borderRadius: 16, background: "rgba(20,20,24,.95)", border: "1px solid var(--line)" }}>
          <Button variant="primary" size="lg" className="grow" loading={saving === "active"} disabled={!!saving || uploading} onClick={() => void submit("active")}>{isEdit && initial.status === "active" ? t("Guardar y publicar") : t("Publicar")}</Button>
          <Button variant="outline" size="lg" loading={saving === "draft"} disabled={!!saving || uploading} onClick={() => void submit("draft")}>{isEdit && initial.status === "active" ? t("Guardar") : t("Guardar borrador")}</Button>
        </div>
        {isEdit && <Link to={`/p/${initial.id}`} className="link small">{t("Ver publicación")}</Link>}
      </div>
    </Page>
  );
}

function ProposalView({ p, categories, onApply }: { p: ListingAiResult; categories: Category[]; onApply: (title: string) => void }) {
  const opts: [string, string][] = [[t("Búsqueda"), p.titles.search], [t("Descriptivo"), p.titles.descriptive], [t("Comercial"), p.titles.commercial], [t("Breve"), p.titles.short]];
  const [pick, setPick] = useState(p.titles.search || p.titles.descriptive);
  const catName = categories.find((c) => c.id === p.category_id)?.name;
  return (
    <div className="stack" style={{ marginTop: 6 }}>
      <hr className="divider" />
      <span className="h3">{t("Propuesta de la IA")}</span><span className="small dim">{t("Revísala antes de usarla: puedes cambiar cualquier dato.")}</span>
      <div className="stack" style={{ gap: 6 }}>
        {opts.filter(([, t]) => t).map(([k, t]) => (
          <button type="button" key={k} className={`title-option ${pick === t ? "on" : ""}`} onClick={() => setPick(t)}><span className="k">{k}</span><span>{t}</span></button>
        ))}
      </div>
      {p.description && <div className="stack" style={{ gap: 4 }}><span className="label">{t("Descripción propuesta")}</span><p className="small muted" style={{ whiteSpace: "pre-line" }}>{p.description}</p></div>}
      <div className="row small" style={{ gap: 8 }}>
        {catName && <Badge kind="outline">{t("Categoría:")}{" "}{catName} {" "}{t("· confianza")}{" "}{p.category_confidence}</Badge>}
        {p.detected_brand.value && <Badge kind={p.detected_brand.certainty === "visible" ? "ok" : "warn"}>{t("Marca:")}{" "}{p.detected_brand.value} · {p.detected_brand.certainty.replace("_", " ")}</Badge>}
      </div>
      {p.attributes.length > 0 && (
        <div className="row" style={{ gap: 6 }}>{p.attributes.map((a, i) => <Badge key={i} kind={a.certainty === "visible" ? "ok" : a.certainty === "probable" ? "warn" : "outline"}>{a.name}: {a.value} · {a.certainty.replace("_", " ")}</Badge>)}</div>
      )}
      {(p.uncertainties.length > 0 || p.missing_info.length > 0) && (
        <Callout kind="warn"><div className="stack" style={{ gap: 4 }}><b>{t("Confirma estos datos tú mismo")}</b>
          {[...p.missing_info.map((m) => t("Falta: {0}", [m])), ...p.uncertainties].map((u, i) => <span key={i}>• {u}</span>)}</div></Callout>
      )}
      {p.condition_observations.length > 0 && <div className="small muted">{t("Observado en las fotos:")}{" "}{p.condition_observations.join(" · ")}</div>}
      {p.price.min_cents && p.price.max_cents ? (
        <Callout><div className="stack" style={{ gap: 4 }}><span><b>{t("Estimación de la IA:")}</b> {money(p.price.min_cents)} – {money(p.price.max_cents)}</span><span className="small">{p.price.note}</span></div></Callout>
      ) : <span className="small dim">{t("La IA no tiene datos suficientes para estimar un precio.")}</span>}
      {p.photo_tips.length > 0 && <div className="small muted"><b style={{ color: "var(--text)" }}>{t("Mejora tus fotos:")}</b> {p.photo_tips.join(" · ")}</div>}
      <div><Button variant="white" icon="check" onClick={() => onApply(pick)}>{t("Usar este título y las sugerencias")}</Button></div>
    </div>
  );
}

function VariantEditor({ value, onChange, sizeSystem }: { value: VRow[]; onChange: (v: VRow[]) => void; sizeSystem: string }) {
  const initialMatrix = value.length > 1 || value.some((v) => v.color);
  const [mode, setMode] = useState<"single" | "matrix">(initialMatrix ? "matrix" : "single");
  const [sizes, setSizes] = useState<string[]>(() => [...new Set(value.map((v) => v.size).filter(Boolean) as string[])]);
  const [colors, setColors] = useState<string[]>(() => [...new Set(value.map((v) => v.color).filter(Boolean) as string[])]);
  const [customSize, setCustomSize] = useState("");
  const [colorText, setColorText] = useState("");
  const qtyMap = useMemo(() => new Map(value.map((v) => [`${v.color ?? ""}|${v.size ?? ""}`, v])), [value]);
  const presets = PRESETS[sizeSystem] ?? PRESETS.apparel;

  const rebuild = (nextSizes: string[], nextColors: string[]) => {
    const cs = nextColors.length ? nextColors : [""];
    const ss = nextSizes.length ? nextSizes : [""];
    const rows: VRow[] = [];
    for (const c of cs) for (const s of ss) {
      const prev = qtyMap.get(`${c}|${s}`);
      rows.push({ id: prev?.id, size: s || null, color: c || null, stock_on_hand: prev?.stock_on_hand ?? 0, stock_reserved: prev?.stock_reserved });
    }
    onChange(rows);
  };
  const toggleSize = (s: string) => { const next = sizes.includes(s) ? sizes.filter((x) => x !== s) : [...sizes, s]; setSizes(next); rebuild(next, colors); };
  const addColor = () => { const c = colorText.trim(); if (!c || colors.includes(c)) return; const next = [...colors, c]; setColors(next); setColorText(""); rebuild(sizes, next); };
  const setQty = (c: string, s: string, q: number) => onChange(value.map((v) => ((v.color ?? "") === c && (v.size ?? "") === s ? { ...v, stock_on_hand: q } : v)));
  const single = value[0] ?? { size: null, color: null, stock_on_hand: 1 };

  return (
    <div className="stack">
      <div className="segmented">
        <button type="button" className={`seg ${mode === "single" ? "on" : ""}`} onClick={() => { setMode("single"); onChange([{ ...single, stock_on_hand: single.stock_on_hand || 1 }]); }}>{t("Artículo único o una sola talla")}</button>
        <button type="button" className={`seg ${mode === "matrix" ? "on" : ""}`} onClick={() => { setMode("matrix"); if (!sizes.length && single.size) setSizes([single.size]); }}>{t("Varias tallas o colores")}</button>
      </div>
      {mode === "single" ? (
        <div className="grid-3">
          <Field label={t("Talla")}>
            {sizeSystem === "none" ? <Input value={single.size ?? ""} placeholder="p. ej. 30 ml" onChange={(e) => onChange([{ ...single, size: e.target.value || null }])} />
              : <Select value={single.size ?? ""} onChange={(e) => onChange([{ ...single, size: e.target.value || null }])}>
                <option value="">{t("Sin talla")}</option>{presets.map((s) => <option key={s}>{s}</option>)}
                {single.size && !presets.includes(single.size) && <option>{single.size}</option>}
              </Select>}
          </Field>
          <Field label={t("Cantidad")}><Input inputMode="numeric" value={String(single.stock_on_hand)} onChange={(e) => onChange([{ ...single, stock_on_hand: Number(e.target.value.replace(/\D/g, "")) || 0 }])} /></Field>
          {single.stock_reserved ? <span className="small dim" style={{ alignSelf: "end" }}>{single.stock_reserved} {" "}{t("reservada(s)")}</span> : null}
        </div>
      ) : (
        <>
          <Field label={t("Tallas disponibles")} hint={t("Toca para añadir o quitar tallas.")}>
            <div className="segmented">
              {[...presets, ...sizes.filter((s) => !presets.includes(s))].map((s) => <button type="button" key={s} className={`seg ${sizes.includes(s) ? "on" : ""}`} onClick={() => toggleSize(s)}>{s}</button>)}
              <input className="input" style={{ width: 110, minHeight: 38 }} placeholder={t("otra talla")} value={customSize} onChange={(e) => setCustomSize(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && customSize.trim()) { e.preventDefault(); toggleSize(customSize.trim()); setCustomSize(""); } }} />
            </div>
          </Field>
          <Field label={t("Colores (opcional)")} hint={t("Añade un color para combinar talla y color.")}>
            <div className="row" style={{ gap: 6 }}>
              {colors.map((c) => <button type="button" key={c} className="chip on" onClick={() => { const next = colors.filter((x) => x !== c); setColors(next); rebuild(sizes, next); }}>{c}<span className="x">×</span></button>)}
              <input className="input" style={{ flex: "1 1 140px", minHeight: 38 }} placeholder={t("p. ej. Negra")} value={colorText} onChange={(e) => setColorText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addColor(); } }} />
              <Button type="button" size="sm" variant="outline" onClick={addColor}>{t("Añadir")}</Button>
            </div>
          </Field>
          <div className="vgrid">
            <table>
              <thead><tr><th />{(sizes.length ? sizes : ["—"]).map((s) => <th key={s}>{s}</th>)}</tr></thead>
              <tbody>
                {(colors.length ? colors : [""]).map((c) => (
                  <tr key={c}>
                    <th className="rowh">{c || t("Cantidad")}</th>
                    {(sizes.length ? sizes : [""]).map((s) => {
                      const row = qtyMap.get(`${c}|${s}`);
                      const q = row?.stock_on_hand ?? 0;
                      return (
                        <td key={s}>
                          <input className={`input qty num ${q === 0 ? "zero" : ""}`} inputMode="numeric" aria-label={t("Cantidad {0} {1}", [c, s])} value={String(q)}
                            onChange={(e) => setQty(c, s, Number(e.target.value.replace(/\D/g, "")) || 0)} />
                          {row?.stock_reserved ? <div className="tiny dim center">{row.stock_reserved} res.</div> : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className="small dim">{t("Las tallas con 0 unidades se muestran como agotadas. Cada combinación tiene su propio inventario y no se puede vender más de lo disponible.")}</span>
        </>
      )}
    </div>
  );
}
