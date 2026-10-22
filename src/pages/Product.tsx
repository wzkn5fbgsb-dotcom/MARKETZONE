import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../app/state";
import { invalidate, useAction, useQuery } from "../app/query";
import { Link, navigate, useLocation } from "../app/router";
import { CONDITIONS, money, pct, sizeLabel } from "../app/format";
import type { ProductDetail, Variant } from "../api/types";
import { ConditionTag, FavoriteButton, ProductGrid, SectionHeader } from "../components/product";
import { Page } from "../components/layout";
import { Avatar, Badge, Button, Callout, Countdown, ErrorBox, Field, Img, MoneyInput, Select, Sheet, Spinner, Stars, TextArea, useToast } from "../ui/kit";
import { Icon } from "../ui/icons";
import { BlockButton } from "../components/block";
import { t } from "../i18n";
import { mxCurrentPath, mxShare } from "../mx/fx.js";

export default function Product({ id }: { id: string }) {
  const { api, sessionId } = useApp();
  const loc = useLocation();
  const res = useQuery(`product:${id}`, () => api.product(id));
  useEffect(() => {
    void api.track({ kind: "product_view", product_id: id, campaign_id: loc.query.get("c") ?? undefined, session_id: sessionId }).catch(() => null);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (res.loading) return <Page><Spinner /></Page>;
  if (res.error || !res.data) return <Page><ErrorBox error={res.error} onRetry={res.reload} /><div style={{ marginTop: 16 }}><Link to="/explorar" className="link">{t("Volver a explorar")}</Link></div></Page>;
  return <ProductView d={res.data} />;
}

function ProductView({ d }: { d: ProductDetail }) {
  const { api, requireAuth, reloadAccount, session } = useApp();
  const toast = useToast();
  const p = d.product;
  const colors = useMemo(() => [...new Set(d.variants.map((v) => v.color ?? ""))], [d.variants]);
  const multiColor = colors.length > 1;
  const [color, setColor] = useState(colors.find((c) => d.variants.some((v) => (v.color ?? "") === c && v.available > 0)) ?? colors[0] ?? "");
  const visible = d.variants.filter((v) => !multiColor || (v.color ?? "") === color);
  const firstAvail = visible.find((v) => v.available > 0) ?? null;
  const [variantId, setVariantId] = useState<string | null>(d.variants.length === 1 ? d.variants[0].id : firstAvail?.id ?? null);
  useEffect(() => { if (variantId && !visible.some((v) => v.id === variantId)) setVariantId(visible.find((v) => v.available > 0)?.id ?? null); }, [color]); // eslint-disable-line
  const variant = d.variants.find((v) => v.id === variantId) ?? null;
  const [qty, setQty] = useState(1);
  const [offerOpen, setOfferOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const gal = useRef<HTMLDivElement>(null);
  const totalAvail = d.variants.reduce((n, v) => n + v.available, 0);
  const add = useAction((vId: string, q: number) => api.cartAdd(vId, q), {
    invalidates: ["product:", "cart"],
    onSuccess: () => { toast(t("Añadido al carrito"), "ok"); reloadAccount(); },
    onError: (e) => toast(e.message, "bad"),
  });
  const scrollTo = (i: number) => { setImgIdx(i); gal.current?.scrollTo({ left: i * gal.current.clientWidth, behavior: "smooth" }); };
  const share = () => mxShare({ title: p.title, text: p.title, path: mxCurrentPath(), toast });
  const net = Math.round(p.price_cents * (1 - d.fees.commission_bps / 10000));

  return (
    <Page>
      <div className="split">
        <div className="stack">
          <div className="zone" style={{ borderRadius: 16 }}>
            <div className="gallery" ref={gal} onScroll={(e) => setImgIdx(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
              {(d.images.length ? d.images : [{ id: "x", url: "", storage_path: null }]).map((im, i) => (
                <div key={im.id}><Img src={im.url || null} alt={t("{0} · foto {1}", [p.title, i + 1])} loading={i === 0 ? "eager" : "lazy"} /></div>
              ))}
            </div>
          </div>
          {d.images.length > 1 && (
            <div className="thumbs">
              {d.images.map((im, i) => <button key={im.id} className={i === imgIdx ? "on" : ""} onClick={() => scrollTo(i)} aria-label={t("Ver foto {0}", [i + 1])}><Img src={im.url} alt="" /></button>)}
            </div>
          )}
        </div>

        <div className="split-side stack-lg">
          {d.is_owner && (
            <Callout kind={p.status === "active" && p.moderation_status === "ok" ? "info" : "warn"}>
              <div className="stack" style={{ gap: 8 }}>
                <span>{t("Es tu publicación. Estado:")}{" "}<b>{p.moderation_status === "blocked" ? t("bloqueada por moderación") : { active: t("publicada"), draft: t("borrador"), paused: t("pausada"), removed: t("eliminada") }[p.status]}</b>.</span>
                <div className="row"><Link to={`/publicar/${p.id}`} className="btn btn-sm btn-dark"><Icon name="edit" size={16} />{t("Editar")}</Link><Link to="/panel/catalogo" className="btn btn-sm btn-ghost">{t("Ver en el panel")}</Link>{p.status === "active" && <Link to={`/promociona/campana?producto=${p.id}`} className="btn btn-sm btn-ghost"><Icon name="megaphone" size={16} />{t("Promocionar este artículo")}</Link>}</div>
              </div>
            </Callout>
          )}
          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 6 }}>
              {d.sponsored && <Badge kind="accent">{t("Patrocinado")}</Badge>}
              {p.is_demo && <Badge kind="demo">{t("Producto de ejemplo")}</Badge>}
              {p.ai_assisted && <Badge kind="outline">{t("Descripción asistida por IA")}</Badge>}
            </div>
            {p.brand && <span className="eyebrow">{p.brand}</span>}
            <h1 className="h1" style={{ fontSize: "clamp(24px, 4vw, 32px)" }}>{p.title}</h1>
            <div className="row" style={{ gap: 12, alignItems: "baseline" }}>
              <span className="price" style={{ fontSize: 30 }}>{money(variant?.price_cents ?? p.price_cents)}</span>
              {p.compare_at_cents && <><span className="strike num">{money(p.compare_at_cents)}</span><Badge kind="bad">{t("Bajó de precio")}</Badge></>}
            </div>
            <ConditionTag condition={p.condition} long />
          </div>

          {d.variants.length > 1 || d.variants[0]?.size || d.variants[0]?.color ? (
            <div className="stack">
              {multiColor && (
                <Field label={t("Color")}>
                  <div className="segmented">{colors.map((c) => <button key={c} className={`seg ${c === color ? "on" : ""}`} onClick={() => setColor(c)}>{c || t("Sin color")}</button>)}</div>
                </Field>
              )}
              <Field label={<span className="row between" style={{ width: "100%" }}><span>{t("Talla")}</span><span className="small dim">{totalAvail} {" "}{t("unidad(es) en total")}</span></span>}>
                <div className="sizerun" role="radiogroup" aria-label={t("Talla")}>
                  {visible.map((v) => (
                    <button key={v.id} className={`size ${v.id === variantId ? "on" : ""}`} disabled={v.available <= 0} role="radio" aria-checked={v.id === variantId}
                      onClick={() => { setVariantId(v.id); setQty(1); }}>
                      <span className="s">{v.size ?? t("Única")}</span>
                      <span className="q">{v.available <= 0 ? t("agotada") : v.available === 1 ? t("última") : t("{0} disp.", [v.available])}</span>
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          ) : (
            <span className="small muted">{totalAvail > 0 ? (totalAvail === 1 ? t("Pieza única: solo hay 1") : t("{0} unidades disponibles", [totalAvail])) : t("Agotado")}</span>
          )}

          {d.is_owner && variant && (
            <span className="small dim mono">{t("Tu inventario ·")}{" "}{sizeLabel(variant.size, variant.color)}: {variant.stock_on_hand} {" "}{t("en stock ·")}{" "}{variant.stock_reserved} reservadas</span>
          )}

          {!d.is_owner && (
            <div className="buybar">
              <div className="stack">
                {variant && variant.available > 1 && (
                  <div className="row" style={{ gap: 8 }}>
                    <span className="small dim">{t("Cantidad")}</span>
                    <div style={{ width: 90 }}>
                      <Select value={qty} onChange={(e) => setQty(Number(e.target.value))} aria-label={t("Cantidad")}>
                        {Array.from({ length: Math.min(variant.available, 10) }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                      </Select>
                    </div>
                  </div>
                )}
                <div className="row-nw">
                  <Button variant="primary" size="lg" className="grow" icon="bag" loading={add.pending}
                    disabled={!variant || variant.available <= 0 || !d.is_visible}
                    onClick={() => { if (requireAuth() && variant) void add.run(variant.id, qty); }}>
                    {!variant ? (totalAvail ? t("Elige una talla") : t("Agotado")) : variant.available <= 0 ? t("Agotado") : t("Añadir al carrito")}
                  </Button>
                  <FavoriteButton productId={p.id} initial={d.is_favorite} className="btn btn-outline btn-lg pcard-fav-inline" />
                </div>
                {d.offer_rules.enabled && (
                  d.my_open_offer ? (
                    <Callout kind="info"><div className="stack" style={{ gap: 6 }}>
                      <span>{t("Tu oferta de")}{" "}<b>{money(d.my_open_offer.amount_cents)}</b>: {d.my_open_offer.status === "countered" ? t("el vendedor envió una contraoferta") : d.my_open_offer.status === "accepted" ? t("aceptada, pendiente de pago") : t("esperando respuesta")}.</span>
                      <Countdown to={d.my_open_offer.expires_at} />
                      <Link to="/ofertas" className="link small">{t("Ver mis ofertas")}</Link>
                    </div></Callout>
                  ) : (
                    <Button variant="outline" size="lg" block icon="offer" disabled={!variant || variant.available <= 0}
                      onClick={() => { if (requireAuth()) setOfferOpen(true); }}>{t("Hacer una oferta")}</Button>
                  )
                )}
              </div>
            </div>
          )}

          <Link to={`/tienda/${d.store.slug}`} className="seller-card">
            <Avatar name={d.store.name} src={d.store.logo_url} />
            <div className="stack grow" style={{ gap: 2 }}>
              <span className="row-nw" style={{ gap: 8 }}><b className="ellipsis">{d.store.name}</b>{d.store.is_demo && <Badge kind="demo">{t("Demo")}</Badge>}</span>
              <span className="small dim">@{d.seller.username} · {d.store.stats.active_listings} {" "}{t("publicaciones ·")}{" "}{d.store.stats.verified_sales} {" "}{t("ventas verificadas")}</span>
              <span className="small muted row-nw" style={{ gap: 6 }}>
                {d.store.stats.rating_count ? <><Stars value={d.store.stats.rating_avg ?? 0} size={12} />{d.store.stats.rating_avg?.toFixed(1)} · {d.store.stats.rating_count} {" "}{t("reseñas")}</> : t("Sin reseñas todavía")}
              </span>
            </div>
            <Icon name="chevron" size={18} />
          </Link>

          <div className="stack">
            <span className="eyebrow">{t("Detalles")}</span>
            {p.description && <p className="prose">{p.description}</p>}
            {p.condition === "used_flawed" && p.flaws && <Callout kind="warn"><b>{t("Defectos declarados:")}</b> {p.flaws}</Callout>}
            <dl className="kv">
              <dt>{t("Estado")}</dt><dd>{CONDITIONS[p.condition].label}</dd>
              <dt>{t("Categoría")}</dt><dd>{d.category.name}</dd>
              {p.color && <><dt>{t("Color")}</dt><dd>{p.color}</dd></>}
              {p.material && <><dt>{t("Material")}</dt><dd>{p.material}</dd></>}
              {p.fit && <><dt>{t("Ajuste")}</dt><dd>{p.fit}</dd></>}
              {(p.length_cm || p.weight_grams) && <><dt>{t("Envío")}</dt><dd>{[p.weight_grams && `${p.weight_grams} g`, p.length_cm && `${p.length_cm}×${p.width_cm ?? "?"}×${p.height_cm ?? "?"} cm`].filter(Boolean).join(" · ")}</dd></>}
              <dt>{t("Guardado")}</dt><dd>{d.favorites_count} {d.favorites_count === 1 ? "vez" : "veces"}</dd>
            </dl>
            {p.tags.length > 0 && <div className="row" style={{ gap: 6 }}>{p.tags.map((t) => <Link key={t} to={`/explorar?q=${encodeURIComponent(t)}`} className="chip">#{t}</Link>)}</div>}
          </div>

          <Callout icon="shield">
            <span>{t("Envío:")}{" "}{money(d.fees.shipping_flat_cents)} {" "}{t("por vendedor. Pago verificado por el servidor;")}{" "}{d.fees.test_mode ? <b>{t("modo de prueba activo (no se cobra dinero real)")}</b> : t("pago seguro")}.
              {d.is_owner && <> {" "}{t("Tarifa de MARKETXONE:")}{" "}{pct(d.fees.commission_bps)} {" "}{t("al venderse (recibirías aprox.")}{" "}{money(net)}).</>}</span>
          </Callout>

          <div className="row">
            <Button variant="ghost" size="sm" icon="share" onClick={share}>{t("Compartir")}</Button>
            {!d.is_owner && session && <Button variant="ghost" size="sm" icon="flag" onClick={() => setReportOpen(true)}>{t("Reportar")}</Button>}
            {!d.is_owner && <BlockButton userId={d.seller.id} username={d.seller.username} />}
          </div>
        </div>
      </div>

      {d.similar.length > 0 && (
        <section style={{ marginTop: 48 }}>
          <SectionHeader title={t("Más en {0}", [d.category.name])} />
          <ProductGrid items={d.similar} />
        </section>
      )}

      {variant && <OfferSheet open={offerOpen} onClose={() => setOfferOpen(false)} d={d} variant={variant} />}
      <ReportSheet open={reportOpen} onClose={() => setReportOpen(false)} targetType="product" targetId={p.id} />
    </Page>
  );
}

function OfferSheet({ open, onClose, d, variant }: { open: boolean; onClose: () => void; d: ProductDetail; variant: Variant }) {
  const { api, account, reloadAccount } = useApp();
  const toast = useToast();
  const list = variant.price_cents;
  const min = Math.ceil(list * d.offer_rules.min_percent / 100);
  const ship = d.fees.shipping_flat_cents;
  const addresses = account?.addresses ?? [];
  const [amount, setAmount] = useState<number | null>(Math.round(list * 0.85 / 100) * 100);
  const [addressId, setAddressId] = useState<string>(addresses.find((a) => a.is_default)?.id ?? addresses[0]?.id ?? "");
  const send = useAction(() => api.makeOffer(variant.id, amount ?? 0, 1, addressId || null), {
    invalidates: ["product:", "offers"],
    onSuccess: () => { toast(t("Oferta pagada y enviada. Si el vendedor acepta, la compra queda cerrada."), "ok"); reloadAccount(); onClose(); },
  });
  const suggestions = [0.9, 0.85, 0.8].map((f) => Math.max(min, Math.round((list * f) / 100) * 100)).filter((v, i, a) => v < list && a.indexOf(v) === i);
  const valid = !!amount && amount >= min && amount < list && !!addressId;
  return (
    <Sheet open={open} onClose={onClose} title={t("Hacer una oferta")} footer={
      <><Button variant="ghost" onClick={onClose}>{t("Cancelar")}</Button><Button variant="primary" loading={send.pending} disabled={!valid} onClick={() => void send.run()}>{valid ? t("Ofertar y pagar {0}", [money((amount ?? 0) + ship)]) : t("Ofertar y pagar")}</Button></>
    }>
      <span className="muted small">{d.product.title}, {sizeLabel(variant.size, variant.color)}. Precio publicado: <b>{money(list)}</b></span>
      <div className="row">{suggestions.map((s) => <button key={s} className={`chip ${amount === s ? "on" : ""}`} onClick={() => setAmount(s)}>{money(s)}</button>)}</div>
      <Field label={t("Tu oferta")} hint={t("Mínimo {0} ({1} % del precio). Debe ser menor que {2}.", [money(min), d.offer_rules.min_percent, money(list)])}>
        <MoneyInput cents={amount} onChange={setAmount} />
      </Field>
      {addresses.length > 0 ? (
        <Field label={t("Enviar a")}>
          <Select value={addressId} onChange={(e) => setAddressId(e.target.value)}>
            {addresses.map((a) => <option key={a.id} value={a.id}>{a.full_name}, {a.line1}, {a.city}</option>)}
          </Select>
        </Field>
      ) : (
        <Callout kind="warn">{t("Necesitas una dirección de envío para ofertar.")}{" "}<Link to="/ajustes" className="link">{t("Agrégala en Ajustes")}</Link>.</Callout>
      )}
      {valid && <span className="small">{t("Pagas ahora")}{" "}<b>{money((amount ?? 0) + ship)}</b>{t(": tu oferta de")}{" "}{money(amount ?? 0)} {" "}{t("más")}{" "}{money(ship)} {" "}{t("de envío.")}</span>}
      <ErrorBox error={send.error} />
      <Callout>{t("Pagas al ofertar y el dinero queda retenido. Si el vendedor acepta, el trato está hecho y la compra queda cerrada. Si la rechaza, no responde a tiempo o retiras tu oferta, se libera el pago y no se te cobra nada.")}{d.fees.test_mode ? t(" Por ahora los pagos son de prueba: no se cobra dinero.") : ""}</Callout>
    </Sheet>
  );
}

export function ReportSheet({ open, onClose, targetType, targetId }: { open: boolean; onClose: () => void; targetType: string; targetId: string }) {
  const { api } = useApp();
  const toast = useToast();
  const [reason, setReason] = useState("counterfeit");
  const [details, setDetails] = useState("");
  const send = useAction(() => api.report(targetType, targetId, reason, details), {
    onSuccess: () => { toast(t("Reporte enviado. Lo revisará el equipo de moderación."), "ok"); onClose(); },
  });
  return (
    <Sheet open={open} onClose={onClose} title={t("Reportar")} footer={<><Button variant="ghost" onClick={onClose}>{t("Cancelar")}</Button><Button variant="primary" loading={send.pending} onClick={() => void send.run()}>{t("Enviar reporte")}</Button></>}>
      <Field label={t("Motivo")}>
        <Select value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="counterfeit">{t("Posible falsificación")}</option>
          <option value="prohibited">{t("Producto prohibido")}</option>
          <option value="scam">{t("Posible estafa")}</option>
          <option value="offensive">{t("Contenido ofensivo")}</option>
          <option value="spam">{t("Spam")}</option>
          <option value="other">{t("Otro")}</option>
        </Select>
      </Field>
      <Field label={t("Detalles (opcional)")}><TextArea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} /></Field>
      <ErrorBox error={send.error} />
    </Sheet>
  );
}

export function goLogin() { navigate("/entrar"); }
export { invalidate };
