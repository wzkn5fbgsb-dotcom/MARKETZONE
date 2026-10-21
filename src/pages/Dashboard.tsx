import { useEffect, useState } from "react";
import { useApp } from "../app/state";
import { invalidate, useAction, useQuery } from "../app/query";
import { Link, navigate } from "../app/router";
import { CAMPAIGN_STATUS, FULFILLMENT_STATUS, dateOnly, dateTime, money, pct, sizeLabel, tone } from "../app/format";
import type { CatalogItem, MoneyBlock, SellerOrder } from "../api/types";
import { Page } from "../components/layout";
import { Badge, Button, Callout, ConfirmButton, Empty, ErrorBox, Field, Img, Input, MoneyInput, Select, Sheet, Spinner, Stat, StatusBadge, Tabs, useToast } from "../ui/kit";
import { Icon } from "../ui/icons";
import { NeedLogin, StoreSettings } from "./Account";
import { OfferList } from "./Commerce";
import { t } from "../i18n";

type Tab = "resumen" | "catalogo" | "pedidos" | "ofertas" | "promociones" | "tienda";

export default function Dashboard({ tab }: { tab?: string }) {
  const { session, api } = useApp();
  const cur = (["resumen", "catalogo", "pedidos", "ofertas", "promociones", "tienda"].includes(tab ?? "") ? tab : "resumen") as Tab;
  const dash = useQuery(session ? "dashboard" : null, () => api.dashboard());
  if (!session) return <NeedLogin next="/panel" />;
  const d = dash.data;
  return (
    <Page>
      <div className="stack-lg">
        <div className="row between">
          <div className="stack" style={{ gap: 4 }}><span className="eyebrow">{t("Tu panel de ventas")}</span><h1 className="h1">{d?.stores[0]?.name ?? t("Mi tienda")}</h1></div>
          <div className="row">
            {d?.stores[0] && <Link to={`/tienda/${d.stores[0].slug}`} className="btn btn-outline btn-sm"><Icon name="eye" size={16} />{t("Ver tienda")}</Link>}
            {d?.stores[0] && <Link to={`/promociona/campana?tipo=home_store&tienda=${d.stores[0].id}`} className="btn btn-outline btn-sm"><Icon name="megaphone" size={16} />{t("Promocionar mi tienda")}</Link>}
            <Link to="/publicar" className="btn btn-primary btn-sm"><Icon name="plus" size={16} />{t("Publicar")}</Link>
          </div>
        </div>
        <Tabs value={cur} onChange={(v) => navigate(`/panel/${v}`, { keepScroll: true })} items={[
          { id: "resumen", label: t("Resumen") },
          { id: "catalogo", label: t("Catálogo"), count: d ? d.listings.active + d.listings.draft + d.listings.paused : undefined },
          { id: "pedidos", label: t("Pedidos"), count: d?.orders.to_ship || undefined },
          { id: "ofertas", label: t("Ofertas"), count: d?.offers.awaiting_you || undefined },
          { id: "promociones", label: t("Promociones") },
          { id: "tienda", label: t("Tienda") },
        ]} />
        {cur === "resumen" && (dash.loading ? <Spinner /> : d ? <Overview /> : <ErrorBox error={dash.error} onRetry={dash.reload} />)}
        {cur === "catalogo" && <Catalog />}
        {cur === "pedidos" && <SellerOrders />}
        {cur === "ofertas" && <OfferList role="seller" />}
        {cur === "promociones" && <CampaignsShort />}
        {cur === "tienda" && <StoreSettings />}
      </div>
    </Page>
  );
}

function Overview() {
  const { api } = useApp();
  const { data: d } = useQuery("dashboard", () => api.dashboard());
  if (!d) return null;
  const rows: [keyof MoneyBlock, string, string][] = [
    ["gross_cents", t("Ingresos brutos"), t("Valor de los artículos vendidos y pagados (incluye los reembolsados).")],
    ["refunds_cents", t("Reembolsos"), t("Importe devuelto a compradores.")],
    ["commission_cents", t("Comisiones MARKETZONE"), t("Tarifa del {0} sobre ventas no reembolsadas.", [pct(d.settings.commission_bps)])],
    ["net_estimated_cents", t("Ingresos netos estimados"), t("Brutos − reembolsos − comisiones. No es dinero recibido.")],
    ["pending_settlement_cents", t("Pendiente de liquidación"), t("Neto de ventas pagadas que aún no se ha transferido.")],
    ["paid_out_cents", t("Liquidado"), t("Dinero ya transferido a tu cuenta.")],
    ["pending_payment_cents", t("En pedidos sin pagar"), t("Pedidos creados pero no pagados: no es un ingreso.")],
  ];
  return (
    <div className="stack-lg">
      <div className="stats">
        <Stat label={t("Unidades disponibles")} value={d.listings.units_available} sub={t("{0} reservadas", [d.listings.units_reserved])} />
        <Stat label={t("Publicados")} value={d.listings.active} sub={t("{0} borradores · {1} pausados", [d.listings.draft, d.listings.paused])} />
        <Stat label={t("Agotados")} value={d.listings.sold_out} />
        <Stat label={t("Ventas completadas")} value={d.orders.completed} sub={t("Entregadas")} />
        <Stat label={t("Pedidos por enviar")} value={d.orders.to_ship} sub={t("{0} esperando pago", [d.orders.pending_payment])} />
        <Stat label={t("Ofertas pendientes")} value={d.offers.awaiting_you} sub={t("{0} aceptadas sin pagar", [d.offers.accepted_unpaid])} />
        <Stat label={t("Vistas (30 días)")} value={d.views_30d} />
        <Stat label={t("Campañas activas")} value={d.campaigns.active} sub={t("{0} en trámite", [d.campaigns.pending])} />
      </div>
      <div className="stack">
        <span className="h3">{t("Tu dinero")}</span><span className="small dim">{t("Lo vendido no es lo cobrado: aquí ves por separado lo pagado, lo pendiente, las comisiones y los reembolsos.")}</span>
        <div className="table-wrap">
          <table className="table money-table">
            <thead><tr><th>{t("Concepto")}</th><th>{t("Real")}</th><th>{t("Prueba")}</th></tr></thead>
            <tbody>
              {rows.map(([k, label, hint]) => (
                <tr key={k}><td><div>{label}</div><div className="tiny dim">{hint}</div></td><td className="num">{money(d.money_real[k], { always2: true })}</td><td className="num dim">{money(d.money_test[k], { always2: true })}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.settings.test_mode && <Callout kind="warn">{t("Modo de prueba activo: las ventas de la columna “Prueba” no movieron dinero real. Las liquidaciones reales requieren integrar el proveedor de pagos (Stripe Connect).")}</Callout>}
      </div>
      {d.listings.blocked > 0 && <Callout kind="bad">{d.listings.blocked} {" "}{t("publicación(es) bloqueadas por moderación. Revisa las notificaciones.")}</Callout>}
    </div>
  );
}

function Catalog() {
  const { api, categories } = useApp();
  const toast = useToast();
  const [filters, setFilters] = useState({ q: "", status: "all", category: "", size: "", min: null as number | null, max: null as number | null, availability: "any", sort: "updated", date_from: "", date_to: "" });
  const [selected, setSelected] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [historyFor, setHistoryFor] = useState<CatalogItem | null>(null);
  const [pctValue, setPctValue] = useState("-10");
  const key = `catalog:${JSON.stringify(filters)}`;
  const res = useQuery(key, () => api.catalog({ ...filters, min_price_cents: filters.min, max_price_cents: filters.max, category: filters.category || null, size: filters.size || null, date_from: filters.date_from || null, date_to: filters.date_to ? `${filters.date_to}T23:59:59Z` : null }));
  useEffect(() => setSelected([]), [key]);
  const bulk = useAction((status: "active" | "paused" | "removed") => api.setListingStatus(selected, status), {
    invalidates: ["catalog", "dashboard", "home", "search:"], onSuccess: (r) => { toast(t("{0} publicación(es) actualizadas", [r.updated]), "ok"); setSelected([]); }, onError: (e) => toast(e.message, "bad"),
  });
  const bulkPrice = useAction(() => api.bulkPrice(selected, Number(pctValue)), {
    invalidates: ["catalog", "home", "search:", "product:"], onSuccess: (r) => { toast(t("Precio ajustado en {0} publicación(es)", [r.updated]), "ok"); setSelected([]); }, onError: (e) => toast(e.message, "bad"),
  });
  const c = res.data?.counts;
  const top = categories.filter((x) => !x.parent_id);
  return (
    <div className="stack">
      <div className="cat-strip" style={{ paddingBottom: 0 }}>
        {([["all", t("Todo"), c?.all], ["active", t("Publicados"), c?.active], ["draft", t("Borradores"), c?.draft], ["paused", t("Pausados"), c?.paused], ["sold_out", t("Agotados"), c?.sold_out]] as const).map(([id, label, n]) => (
          <button key={id} className={`chip ${filters.status === id ? "on" : ""}`} onClick={() => setFilters({ ...filters, status: id })}>{label}{n !== undefined ? ` · ${n}` : ""}</button>
        ))}
      </div>
      <div className="row">
        <div className="grow" style={{ minWidth: 200 }}><div className="search-box"><Icon name="search" size={18} /><input className="input" type="search" placeholder={t("Buscar en mi catálogo")} value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} /></div></div>
        <Button variant="outline" size="sm" icon="filter" onClick={() => setShowFilters(!showFilters)}>{t("Filtros")}</Button>
      </div>
      {showFilters && (
        <div className="panel grid-3">
          <Field label={t("Categoría")}><Select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}><option value="">{t("Todas")}</option>{top.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <Field label={t("Talla")}><Input value={filters.size} placeholder="p. ej. M" onChange={(e) => setFilters({ ...filters, size: e.target.value })} /></Field>
          <Field label={t("Disponibilidad")}><Select value={filters.availability} onChange={(e) => setFilters({ ...filters, availability: e.target.value })}><option value="any">{t("Cualquiera")}</option><option value="in_stock">{t("Con stock")}</option><option value="sold_out">{t("Sin stock")}</option></Select></Field>
          <Field label={t("Precio mínimo")}><MoneyInput cents={filters.min} onChange={(v) => setFilters({ ...filters, min: v })} /></Field>
          <Field label={t("Precio máximo")}><MoneyInput cents={filters.max} onChange={(v) => setFilters({ ...filters, max: v })} /></Field>
          <Field label={t("Ordenar")}><Select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}><option value="updated">{t("Última edición")}</option><option value="published">{t("Fecha de publicación")}</option><option value="price_asc">{t("Precio ↑")}</option><option value="price_desc">{t("Precio ↓")}</option><option value="stock_asc">{t("Menos stock")}</option></Select></Field>
          <Field label={t("Publicado desde")}><Input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} /></Field>
          <Field label={t("Publicado hasta")}><Input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} /></Field>
        </div>
      )}
      {selected.length > 0 && (
        <div className="bulkbar">
          <b className="small">{selected.length} {" "}{t("seleccionada(s)")}</b>
          <Button size="sm" variant="dark" loading={bulk.pending} onClick={() => void bulk.run("active")}>{t("Publicar")}</Button>
          <Button size="sm" variant="dark" loading={bulk.pending} onClick={() => void bulk.run("paused")}>{t("Pausar")}</Button>
          <ConfirmButton confirmLabel={t("Sí, eliminar")} onConfirm={() => void bulk.run("removed")}>{t("Eliminar")}</ConfirmButton>
          <span className="row-nw" style={{ gap: 6 }}><span className="small">{t("Precio")}</span>
            <select className="select" style={{ width: 96, minHeight: 34, padding: "4px 28px 4px 10px" }} value={pctValue} onChange={(e) => setPctValue(e.target.value)}>
              {["-30", "-20", "-15", "-10", "-5", "5", "10", "20"].map((x) => <option key={x} value={x}>{Number(x) > 0 ? "+" : ""}{x} %</option>)}</select>
            <Button size="sm" variant="dark" loading={bulkPrice.pending} onClick={() => void bulkPrice.run()}>{t("Aplicar")}</Button></span>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>{t("Cancelar")}</Button>
        </div>
      )}
      <ErrorBox error={res.error} onRetry={res.reload} />
      {res.loading ? <Spinner /> : res.data?.items.length ? (
        <div className="card">
          {res.data.items.map((it) => <CatalogRow key={it.id} it={it} checked={selected.includes(it.id)}
            onCheck={(v) => setSelected((s) => (v ? [...s, it.id] : s.filter((x) => x !== it.id)))} onHistory={() => setHistoryFor(it)} />)}
        </div>
      ) : <Empty icon="tag" title={t("No hay publicaciones con estos filtros")} action={<Link to="/publicar" className="btn btn-primary">{t("Vender algo")}</Link>} />}
      {historyFor && <HistorySheet item={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

function CatalogRow({ it, checked, onCheck, onHistory }: { it: CatalogItem; checked: boolean; onCheck: (v: boolean) => void; onHistory: () => void }) {
  const { api } = useApp();
  const toast = useToast();
  const [price, setPrice] = useState<number | null>(it.price_cents);
  const [stocks, setStocks] = useState<Record<string, string>>(() => Object.fromEntries(it.variants.map((v) => [v.id, String(v.stock_on_hand)])));
  const [open, setOpen] = useState(false);
  useEffect(() => { setPrice(it.price_cents); setStocks(Object.fromEntries(it.variants.map((v) => [v.id, String(v.stock_on_hand)]))); }, [it]);
  const savePrice = useAction(() => api.quickPrice(it.id, price ?? 0), { invalidates: ["catalog", "product:", "home", "search:"], onSuccess: () => toast(t("Precio actualizado"), "ok"), onError: (e) => toast(e.message, "bad") });
  const saveStock = useAction((vid: string, q: number) => api.quickStock(vid, q), { invalidates: ["catalog", "dashboard", "product:"], onSuccess: () => toast(t("Inventario actualizado"), "ok"), onError: (e) => { toast(e.message, "bad"); setStocks(Object.fromEntries(it.variants.map((v) => [v.id, String(v.stock_on_hand)]))); } });
  const status = it.moderation_status === "blocked" ? ["blocked", t("Bloqueada")] : it.status === "active" && it.available <= 0 ? ["expired", t("Agotada")] : [it.status, { active: t("Publicada"), draft: t("Borrador"), paused: t("Pausada"), removed: t("Eliminada") }[it.status]];
  return (
    <div className="cat-row">
      <input type="checkbox" aria-label={t("Seleccionar {0}", [it.title])} checked={checked} onChange={(e) => onCheck(e.target.checked)} style={{ width: 20, height: 20, accentColor: "var(--crimson)" }} />
      <Link to={`/p/${it.id}`} className="thumb"><Img src={it.image_url} alt="" /></Link>
      <div className="stack" style={{ gap: 6, minWidth: 0 }}>
        <div className="row between" style={{ alignItems: "flex-start", gap: 8 }}>
          <Link to={`/publicar/${it.id}`} className="clamp-2" style={{ fontWeight: 600 }}>{it.title}</Link>
          <span className="row" style={{ gap: 6 }}>{it.is_demo && <Badge kind="demo">{t("Demo")}</Badge>}<StatusBadge status={status[0]} label={status[1]} /></span>
        </div>
        <span className="small dim">{it.available} {" "}{t("disp. ·")}{" "}{it.reserved} {" "}{t("reservadas ·")}{" "}{it.variants.length} {" "}{t("variante(s)")}{it.offers_pending ? t(" · {0} oferta(s)", [it.offers_pending]) : ""} · {dateOnly(it.published_at ?? it.created_at)}</span>
        <div className="controls">
          <div style={{ width: 130 }}><MoneyInput cents={price} onChange={setPrice} /></div>
          {price !== it.price_cents && <Button size="sm" variant="primary" loading={savePrice.pending} onClick={() => void savePrice.run()}>{t("Guardar precio")}</Button>}
          {it.compare_at_cents && <span className="small strike">{money(it.compare_at_cents)}</span>}
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? t("Ocultar inventario") : t("Inventario")}</Button>
          <Button size="sm" variant="ghost" icon="history" onClick={onHistory}>{t("Movimientos")}</Button>
        </div>
      </div>
      {open && (
        <div className="cat-variants">
          {it.variants.map((v) => (
            <span key={v.id} className="vchip">
              {sizeLabel(v.size, v.color)}
              <input className="input num" inputMode="numeric" aria-label={t("Stock {0}", [sizeLabel(v.size, v.color)])} value={stocks[v.id] ?? ""} onChange={(e) => setStocks({ ...stocks, [v.id]: e.target.value.replace(/\D/g, "") })} />
              {String(v.stock_on_hand) !== stocks[v.id] && <Button size="sm" variant="primary" loading={saveStock.pending} onClick={() => void saveStock.run(v.id, Number(stocks[v.id] || 0))}>OK</Button>}
              {v.stock_reserved > 0 && <span className="tiny dim">{v.stock_reserved} res.</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function HistorySheet({ item, onClose }: { item: CatalogItem; onClose: () => void }) {
  const { api } = useApp();
  const res = useQuery(`history:${item.id}`, () => api.inventoryHistory(item.id));
  const KIND: Record<string, string> = { initial: t("Alta"), adjustment: t("Ajuste"), reserve: t("Reserva"), release: t("Liberación"), expire: t("Reserva vencida"), sale: t("Venta"), restock: t("Reposición") };
  return (
    <Sheet open onClose={onClose} title={t("Movimientos de inventario")}>
      <span className="small muted">{item.title}</span>
      {res.loading ? <Spinner /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("Fecha")}</th><th>{t("Variante")}</th><th>{t("Tipo")}</th><th className="r">{t("Stock")}</th><th className="r">{t("Reserv.")}</th></tr></thead>
          <tbody>{(res.data ?? []).map((m) => (
            <tr key={m.id}><td className="small">{dateTime(m.created_at)}</td><td className="small">{sizeLabel(m.size, m.color)}</td><td className="small">{KIND[m.kind] ?? m.kind}</td>
              <td className="r num">{m.on_hand_delta ? `${m.on_hand_delta > 0 ? "+" : ""}${m.on_hand_delta} → ` : ""}{m.on_hand_after}</td>
              <td className="r num">{m.reserved_delta ? `${m.reserved_delta > 0 ? "+" : ""}${m.reserved_delta} → ` : ""}{m.reserved_after}</td></tr>
          ))}</tbody></table></div>
      )}
    </Sheet>
  );
}

function SellerOrders() {
  const { api } = useApp();
  const [status, setStatus] = useState("");
  const res = useQuery(`seller-orders:${status}`, () => api.sellerOrders(status || null));
  return (
    <div className="stack">
      <div className="cat-strip" style={{ paddingBottom: 0 }}>
        {[["", t("Todos")], ["paid", t("Por preparar")], ["preparing", t("Preparando")], ["shipped", t("Enviados")], ["delivered", t("Entregados")], ["pending_payment", t("Sin pagar")], ["refunded", t("Reembolsados")], ["cancelled", t("Cancelados")]].map(([id, label]) => (
          <button key={id} className={`chip ${status === id ? "on" : ""}`} onClick={() => setStatus(id)}>{label}</button>
        ))}
      </div>
      {res.loading ? <Spinner /> : res.data?.length ? res.data.map((so) => <SellerOrderCard key={so.id} so={so} />) : <Empty icon="truck" title={t("No hay pedidos aquí")}>{t("Cuando un comprador pague, aparecerá en “Por preparar”.")}</Empty>}
    </div>
  );
}

function SellerOrderCard({ so }: { so: SellerOrder }) {
  const { api } = useApp();
  const toast = useToast();
  const [shipOpen, setShipOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const inv = ["seller-orders", "dashboard", `order:${so.order_id}`];
  const step = useAction((s: "preparing" | "shipped") => api.fulfill(so.id, s, carrier, tracking), { invalidates: inv, onSuccess: () => { setShipOpen(false); toast(t("Pedido actualizado"), "ok"); }, onError: (e) => toast(e.message, "bad") });
  const refund = useAction(() => api.refund(so.id, reason, restock), { invalidates: [...inv, "catalog", "product:"], onSuccess: () => { setRefundOpen(false); toast(t("Reembolso de prueba registrado"), "ok"); } });
  const addr = so.shipping_address;
  return (
    <div className="panel stack">
      <div className="row between">
        <span className="row" style={{ gap: 8 }}><Link to={`/pedido/${so.order_id}`} className="mono" style={{ fontWeight: 600 }}>#{so.order_number}</Link>
          <StatusBadge status={so.status} label={FULFILLMENT_STATUS[so.status]} />{so.is_test && <Badge kind="demo">{t("Prueba")}</Badge>}</span>
        <span className="small dim">{dateTime(so.created_at)} · @{so.buyer?.username}</span>
      </div>
      {so.items.map((it) => <span key={it.id} className="small">{it.quantity} × {it.title} <span className="dim">· {sizeLabel(it.size, it.color)} · {money(it.unit_price_cents)}</span></span>)}
      <span className="small dim">{t("Subtotal")}{" "}{money(so.subtotal_cents)} {" "}{t("· comisión")}{" "}{money(so.commission_cents)} {" "}{t("· neto")}{" "}{money(so.seller_net_cents)} {" "}{t("· envío cobrado")}{" "}{money(so.shipping_cents)}</span>
      {addr && <span className="small muted"><Icon name="truck" size={14} /> {addr.full_name} · {addr.line1}{addr.line2 ? `, ${addr.line2}` : ""}, {addr.city}, {addr.region} {addr.postal_code}</span>}
      {so.status === "pending_payment" && <span className="small dim">{t("Esperando el pago del comprador. No envíes nada todavía.")}</span>}
      {so.dispute_status === "open" && <Callout kind="warn">{t("El comprador reportó un problema. Tu pago queda retenido mientras el equipo lo revisa. Tu cuenta no tiene ninguna sanción.")}</Callout>}
      {so.status === "shipped" && so.dispute_status !== "open" && so.auto_complete_at && <span className="small dim">{t("Recibes tu pago cuando el comprador confirme la entrega, o automáticamente el")}{" "}{new Date(so.auto_complete_at).toLocaleDateString()} {" "}{t("si no reporta ningún problema.")}</span>}
      <div className="row" style={{ gap: 6 }}>
        {so.status === "paid" && <Button size="sm" variant="dark" loading={step.pending} onClick={() => void step.run("preparing")}>{t("Marcar en preparación")}</Button>}
        {(so.status === "paid" || so.status === "preparing") && <Button size="sm" variant="primary" onClick={() => setShipOpen(true)}>{t("Marcar como enviado")}</Button>}
        {(so.status === "paid" || so.status === "preparing") && <Button size="sm" variant="ghost" onClick={() => setRefundOpen(true)}>{t("Reembolsar")}</Button>}
      </div>
      <Sheet open={shipOpen} onClose={() => setShipOpen(false)} title={t("Datos de envío")} footer={<><Button variant="ghost" onClick={() => setShipOpen(false)}>{t("Cancelar")}</Button><Button variant="primary" loading={step.pending} onClick={() => void step.run("shipped")}>{t("Confirmar envío")}</Button></>}>
        <Field label={t("Transportista (opcional)")}><Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder={t("USPS, UPS, FedEx…")} /></Field>
        <Field label={t("Número de guía (recomendado)")} hint={t("Con guía, el pago se libera 7 días después del envío si no hay reportes; sin guía, a los 21 días. Escríbelo tal como aparece en la etiqueta.")}><Input value={tracking} onChange={(e) => setTracking(e.target.value)} /></Field>
      </Sheet>
      <Sheet open={refundOpen} onClose={() => setRefundOpen(false)} title={t("Reembolsar pedido")} footer={<><Button variant="ghost" onClick={() => setRefundOpen(false)}>{t("Cancelar")}</Button><Button variant="danger" loading={refund.pending} disabled={reason.trim().length < 3} onClick={() => void refund.run()}>{t("Reembolsar")}{" "}{money(so.subtotal_cents + so.shipping_cents)}</Button></>}>
        <Field label={t("Motivo")}><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("p. ej. artículo dañado en almacén")} /></Field>
        <label className="check"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />{t("Devolver las unidades al inventario")}</label>
        {so.is_test ? <Callout>{t("Reembolso de prueba: no se mueve dinero real.")}</Callout> : <Callout kind="warn">{t("Los reembolsos reales se tramitarán con el proveedor de pagos (pendiente de integración).")}</Callout>}
        <ErrorBox error={refund.error} />
      </Sheet>
    </div>
  );
}

function CampaignsShort() {
  const { api } = useApp();
  const res = useQuery("campaigns", () => api.campaigns());
  return (
    <div className="stack">
      <div className="row between"><span className="small muted">{t("Destaca productos, tu tienda o tu negocio. Las campañas pagadas solo se activan tras confirmar el pago.")}</span>
        <Link to="/promociona/campana" className="btn btn-primary btn-sm"><Icon name="plus" size={16} />{t("Nueva campaña")}</Link></div>
      {res.loading ? <Spinner /> : res.data?.length ? res.data.map((c) => (
        <Link key={c.id} to={`/promociona/campanas?id=${c.id}`} className="panel row between">
          <span className="stack" style={{ gap: 2 }}><b>{c.headline}</b><span className="small dim">{money(c.budget_cents)} · {c.duration_days} {" "}{t("días ·")}{" "}{c.stats.impressions} {" "}{t("impresiones ·")}{" "}{c.stats.clicks} clics</span></span>
          <Badge kind={tone(c.status) as "ok"}>{CAMPAIGN_STATUS[c.status]}</Badge>
        </Link>
      )) : <Empty icon="megaphone" title={t("Sin campañas")} />}
    </div>
  );
}

export { invalidate };
