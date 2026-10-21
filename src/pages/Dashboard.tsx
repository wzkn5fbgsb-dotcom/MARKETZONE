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

type Tab = "resumen" | "catalogo" | "pedidos" | "ofertas" | "promociones" | "tienda";

export default function Dashboard({ tab }: { tab?: string }) {
  const { session, api } = useApp();
  const t = (["resumen", "catalogo", "pedidos", "ofertas", "promociones", "tienda"].includes(tab ?? "") ? tab : "resumen") as Tab;
  const dash = useQuery(session ? "dashboard" : null, () => api.dashboard());
  if (!session) return <NeedLogin next="/panel" />;
  const d = dash.data;
  return (
    <Page>
      <div className="stack-lg">
        <div className="row between">
          <div className="stack" style={{ gap: 4 }}><span className="eyebrow">Tu panel de ventas</span><h1 className="h1">{d?.stores[0]?.name ?? "Mi tienda"}</h1></div>
          <div className="row">
            {d?.stores[0] && <Link to={`/tienda/${d.stores[0].slug}`} className="btn btn-outline btn-sm"><Icon name="eye" size={16} />Ver tienda</Link>}
            <Link to="/publicar" className="btn btn-primary btn-sm"><Icon name="plus" size={16} />Publicar</Link>
          </div>
        </div>
        <Tabs value={t} onChange={(v) => navigate(`/panel/${v}`, { keepScroll: true })} items={[
          { id: "resumen", label: "Resumen" },
          { id: "catalogo", label: "Catálogo", count: d ? d.listings.active + d.listings.draft + d.listings.paused : undefined },
          { id: "pedidos", label: "Pedidos", count: d?.orders.to_ship || undefined },
          { id: "ofertas", label: "Ofertas", count: d?.offers.awaiting_you || undefined },
          { id: "promociones", label: "Promociones" },
          { id: "tienda", label: "Tienda" },
        ]} />
        {t === "resumen" && (dash.loading ? <Spinner /> : d ? <Overview /> : <ErrorBox error={dash.error} onRetry={dash.reload} />)}
        {t === "catalogo" && <Catalog />}
        {t === "pedidos" && <SellerOrders />}
        {t === "ofertas" && <OfferList role="seller" />}
        {t === "promociones" && <CampaignsShort />}
        {t === "tienda" && <StoreSettings />}
      </div>
    </Page>
  );
}

function Overview() {
  const { api } = useApp();
  const { data: d } = useQuery("dashboard", () => api.dashboard());
  if (!d) return null;
  const rows: [keyof MoneyBlock, string, string][] = [
    ["gross_cents", "Ingresos brutos", "Valor de los artículos vendidos y pagados (incluye los reembolsados)."],
    ["refunds_cents", "Reembolsos", "Importe devuelto a compradores."],
    ["commission_cents", "Comisiones MARKETZONE", `Tarifa del ${pct(d.settings.commission_bps)} sobre ventas no reembolsadas.`],
    ["net_estimated_cents", "Ingresos netos estimados", "Brutos − reembolsos − comisiones. No es dinero recibido."],
    ["pending_settlement_cents", "Pendiente de liquidación", "Neto de ventas pagadas que aún no se ha transferido."],
    ["paid_out_cents", "Liquidado", "Dinero ya transferido a tu cuenta."],
    ["pending_payment_cents", "En pedidos sin pagar", "Pedidos creados pero no pagados: no es un ingreso."],
  ];
  return (
    <div className="stack-lg">
      <div className="stats">
        <Stat label="Unidades disponibles" value={d.listings.units_available} sub={`${d.listings.units_reserved} reservadas`} />
        <Stat label="Publicados" value={d.listings.active} sub={`${d.listings.draft} borradores · ${d.listings.paused} pausados`} />
        <Stat label="Agotados" value={d.listings.sold_out} />
        <Stat label="Ventas completadas" value={d.orders.completed} sub="Entregadas" />
        <Stat label="Pedidos por enviar" value={d.orders.to_ship} sub={`${d.orders.pending_payment} esperando pago`} />
        <Stat label="Ofertas pendientes" value={d.offers.awaiting_you} sub={`${d.offers.accepted_unpaid} aceptadas sin pagar`} />
        <Stat label="Vistas (30 días)" value={d.views_30d} />
        <Stat label="Campañas activas" value={d.campaigns.active} sub={`${d.campaigns.pending} en trámite`} />
      </div>
      <div className="stack">
        <span className="h3">Tu dinero</span><span className="small dim">Lo vendido no es lo cobrado: aquí ves por separado lo pagado, lo pendiente, las comisiones y los reembolsos.</span>
        <div className="table-wrap">
          <table className="table money-table">
            <thead><tr><th>Concepto</th><th>Real</th><th>Prueba</th></tr></thead>
            <tbody>
              {rows.map(([k, label, hint]) => (
                <tr key={k}><td><div>{label}</div><div className="tiny dim">{hint}</div></td><td className="num">{money(d.money_real[k], { always2: true })}</td><td className="num dim">{money(d.money_test[k], { always2: true })}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.settings.test_mode && <Callout kind="warn">Modo de prueba activo: las ventas de la columna “Prueba” no movieron dinero real. Las liquidaciones reales requieren integrar el proveedor de pagos (Stripe Connect).</Callout>}
      </div>
      {d.listings.blocked > 0 && <Callout kind="bad">{d.listings.blocked} publicación(es) bloqueadas por moderación. Revisa las notificaciones.</Callout>}
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
    invalidates: ["catalog", "dashboard", "home", "search:"], onSuccess: (r) => { toast(`${r.updated} publicación(es) actualizadas`, "ok"); setSelected([]); }, onError: (e) => toast(e.message, "bad"),
  });
  const bulkPrice = useAction(() => api.bulkPrice(selected, Number(pctValue)), {
    invalidates: ["catalog", "home", "search:", "product:"], onSuccess: (r) => { toast(`Precio ajustado en ${r.updated} publicación(es)`, "ok"); setSelected([]); }, onError: (e) => toast(e.message, "bad"),
  });
  const c = res.data?.counts;
  const top = categories.filter((x) => !x.parent_id);
  return (
    <div className="stack">
      <div className="cat-strip" style={{ paddingBottom: 0 }}>
        {([["all", "Todo", c?.all], ["active", "Publicados", c?.active], ["draft", "Borradores", c?.draft], ["paused", "Pausados", c?.paused], ["sold_out", "Agotados", c?.sold_out]] as const).map(([id, label, n]) => (
          <button key={id} className={`chip ${filters.status === id ? "on" : ""}`} onClick={() => setFilters({ ...filters, status: id })}>{label}{n !== undefined ? ` · ${n}` : ""}</button>
        ))}
      </div>
      <div className="row">
        <div className="grow" style={{ minWidth: 200 }}><div className="search-box"><Icon name="search" size={18} /><input className="input" type="search" placeholder="Buscar en mi catálogo" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} /></div></div>
        <Button variant="outline" size="sm" icon="filter" onClick={() => setShowFilters(!showFilters)}>Filtros</Button>
      </div>
      {showFilters && (
        <div className="panel grid-3">
          <Field label="Categoría"><Select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}><option value="">Todas</option>{top.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <Field label="Talla"><Input value={filters.size} placeholder="p. ej. M" onChange={(e) => setFilters({ ...filters, size: e.target.value })} /></Field>
          <Field label="Disponibilidad"><Select value={filters.availability} onChange={(e) => setFilters({ ...filters, availability: e.target.value })}><option value="any">Cualquiera</option><option value="in_stock">Con stock</option><option value="sold_out">Sin stock</option></Select></Field>
          <Field label="Precio mínimo"><MoneyInput cents={filters.min} onChange={(v) => setFilters({ ...filters, min: v })} /></Field>
          <Field label="Precio máximo"><MoneyInput cents={filters.max} onChange={(v) => setFilters({ ...filters, max: v })} /></Field>
          <Field label="Ordenar"><Select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}><option value="updated">Última edición</option><option value="published">Fecha de publicación</option><option value="price_asc">Precio ↑</option><option value="price_desc">Precio ↓</option><option value="stock_asc">Menos stock</option></Select></Field>
          <Field label="Publicado desde"><Input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} /></Field>
          <Field label="Publicado hasta"><Input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} /></Field>
        </div>
      )}
      {selected.length > 0 && (
        <div className="bulkbar">
          <b className="small">{selected.length} seleccionada(s)</b>
          <Button size="sm" variant="dark" loading={bulk.pending} onClick={() => void bulk.run("active")}>Publicar</Button>
          <Button size="sm" variant="dark" loading={bulk.pending} onClick={() => void bulk.run("paused")}>Pausar</Button>
          <ConfirmButton confirmLabel="Sí, eliminar" onConfirm={() => void bulk.run("removed")}>Eliminar</ConfirmButton>
          <span className="row-nw" style={{ gap: 6 }}><span className="small">Precio</span>
            <select className="select" style={{ width: 96, minHeight: 34, padding: "4px 28px 4px 10px" }} value={pctValue} onChange={(e) => setPctValue(e.target.value)}>
              {["-30", "-20", "-15", "-10", "-5", "5", "10", "20"].map((x) => <option key={x} value={x}>{Number(x) > 0 ? "+" : ""}{x} %</option>)}</select>
            <Button size="sm" variant="dark" loading={bulkPrice.pending} onClick={() => void bulkPrice.run()}>Aplicar</Button></span>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Cancelar</Button>
        </div>
      )}
      <ErrorBox error={res.error} onRetry={res.reload} />
      {res.loading ? <Spinner /> : res.data?.items.length ? (
        <div className="card">
          {res.data.items.map((it) => <CatalogRow key={it.id} it={it} checked={selected.includes(it.id)}
            onCheck={(v) => setSelected((s) => (v ? [...s, it.id] : s.filter((x) => x !== it.id)))} onHistory={() => setHistoryFor(it)} />)}
        </div>
      ) : <Empty icon="tag" title="No hay publicaciones con estos filtros" action={<Link to="/publicar" className="btn btn-primary">Vender algo</Link>} />}
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
  const savePrice = useAction(() => api.quickPrice(it.id, price ?? 0), { invalidates: ["catalog", "product:", "home", "search:"], onSuccess: () => toast("Precio actualizado", "ok"), onError: (e) => toast(e.message, "bad") });
  const saveStock = useAction((vid: string, q: number) => api.quickStock(vid, q), { invalidates: ["catalog", "dashboard", "product:"], onSuccess: () => toast("Inventario actualizado", "ok"), onError: (e) => { toast(e.message, "bad"); setStocks(Object.fromEntries(it.variants.map((v) => [v.id, String(v.stock_on_hand)]))); } });
  const status = it.moderation_status === "blocked" ? ["blocked", "Bloqueada"] : it.status === "active" && it.available <= 0 ? ["expired", "Agotada"] : [it.status, { active: "Publicada", draft: "Borrador", paused: "Pausada", removed: "Eliminada" }[it.status]];
  return (
    <div className="cat-row">
      <input type="checkbox" aria-label={`Seleccionar ${it.title}`} checked={checked} onChange={(e) => onCheck(e.target.checked)} style={{ width: 20, height: 20, accentColor: "var(--crimson)" }} />
      <Link to={`/p/${it.id}`} className="thumb"><Img src={it.image_url} alt="" /></Link>
      <div className="stack" style={{ gap: 6, minWidth: 0 }}>
        <div className="row between" style={{ alignItems: "flex-start", gap: 8 }}>
          <Link to={`/publicar/${it.id}`} className="clamp-2" style={{ fontWeight: 600 }}>{it.title}</Link>
          <span className="row" style={{ gap: 6 }}>{it.is_demo && <Badge kind="demo">Demo</Badge>}<StatusBadge status={status[0]} label={status[1]} /></span>
        </div>
        <span className="small dim">{it.available} disp. · {it.reserved} reservadas · {it.variants.length} variante(s){it.offers_pending ? ` · ${it.offers_pending} oferta(s)` : ""} · {dateOnly(it.published_at ?? it.created_at)}</span>
        <div className="controls">
          <div style={{ width: 130 }}><MoneyInput cents={price} onChange={setPrice} /></div>
          {price !== it.price_cents && <Button size="sm" variant="primary" loading={savePrice.pending} onClick={() => void savePrice.run()}>Guardar precio</Button>}
          {it.compare_at_cents && <span className="small strike">{money(it.compare_at_cents)}</span>}
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? "Ocultar inventario" : "Inventario"}</Button>
          <Button size="sm" variant="ghost" icon="history" onClick={onHistory}>Movimientos</Button>
        </div>
      </div>
      {open && (
        <div className="cat-variants">
          {it.variants.map((v) => (
            <span key={v.id} className="vchip">
              {sizeLabel(v.size, v.color)}
              <input className="input num" inputMode="numeric" aria-label={`Stock ${sizeLabel(v.size, v.color)}`} value={stocks[v.id] ?? ""} onChange={(e) => setStocks({ ...stocks, [v.id]: e.target.value.replace(/\D/g, "") })} />
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
  const KIND: Record<string, string> = { initial: "Alta", adjustment: "Ajuste", reserve: "Reserva", release: "Liberación", expire: "Reserva vencida", sale: "Venta", restock: "Reposición" };
  return (
    <Sheet open onClose={onClose} title="Movimientos de inventario">
      <span className="small muted">{item.title}</span>
      {res.loading ? <Spinner /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Fecha</th><th>Variante</th><th>Tipo</th><th className="r">Stock</th><th className="r">Reserv.</th></tr></thead>
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
        {[["", "Todos"], ["paid", "Por preparar"], ["preparing", "Preparando"], ["shipped", "Enviados"], ["delivered", "Entregados"], ["pending_payment", "Sin pagar"], ["refunded", "Reembolsados"], ["cancelled", "Cancelados"]].map(([id, label]) => (
          <button key={id} className={`chip ${status === id ? "on" : ""}`} onClick={() => setStatus(id)}>{label}</button>
        ))}
      </div>
      {res.loading ? <Spinner /> : res.data?.length ? res.data.map((so) => <SellerOrderCard key={so.id} so={so} />) : <Empty icon="truck" title="No hay pedidos aquí">Cuando un comprador pague, aparecerá en “Por preparar”.</Empty>}
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
  const step = useAction((s: "preparing" | "shipped" | "delivered") => api.fulfill(so.id, s, carrier, tracking), { invalidates: inv, onSuccess: () => { setShipOpen(false); toast("Pedido actualizado", "ok"); }, onError: (e) => toast(e.message, "bad") });
  const refund = useAction(() => api.refund(so.id, reason, restock), { invalidates: [...inv, "catalog", "product:"], onSuccess: () => { setRefundOpen(false); toast("Reembolso de prueba registrado", "ok"); } });
  const addr = so.shipping_address;
  return (
    <div className="panel stack">
      <div className="row between">
        <span className="row" style={{ gap: 8 }}><Link to={`/pedido/${so.order_id}`} className="mono" style={{ fontWeight: 600 }}>#{so.order_number}</Link>
          <StatusBadge status={so.status} label={FULFILLMENT_STATUS[so.status]} />{so.is_test && <Badge kind="demo">Prueba</Badge>}</span>
        <span className="small dim">{dateTime(so.created_at)} · @{so.buyer?.username}</span>
      </div>
      {so.items.map((it) => <span key={it.id} className="small">{it.quantity} × {it.title} <span className="dim">· {sizeLabel(it.size, it.color)} · {money(it.unit_price_cents)}</span></span>)}
      <span className="small dim">Subtotal {money(so.subtotal_cents)} · comisión {money(so.commission_cents)} · neto {money(so.seller_net_cents)} · envío cobrado {money(so.shipping_cents)}</span>
      {addr && <span className="small muted"><Icon name="truck" size={14} /> {addr.full_name} · {addr.line1}{addr.line2 ? `, ${addr.line2}` : ""}, {addr.city}, {addr.region} {addr.postal_code}</span>}
      {so.status === "pending_payment" && <span className="small dim">Esperando el pago del comprador. No envíes nada todavía.</span>}
      <div className="row" style={{ gap: 6 }}>
        {so.status === "paid" && <Button size="sm" variant="dark" loading={step.pending} onClick={() => void step.run("preparing")}>Marcar en preparación</Button>}
        {(so.status === "paid" || so.status === "preparing") && <Button size="sm" variant="primary" onClick={() => setShipOpen(true)}>Marcar como enviado</Button>}
        {so.status === "shipped" && <Button size="sm" variant="dark" loading={step.pending} onClick={() => void step.run("delivered")}>Marcar como entregado</Button>}
        {(so.status === "paid" || so.status === "preparing") && <Button size="sm" variant="ghost" onClick={() => setRefundOpen(true)}>Reembolsar</Button>}
      </div>
      <Sheet open={shipOpen} onClose={() => setShipOpen(false)} title="Datos de envío" footer={<><Button variant="ghost" onClick={() => setShipOpen(false)}>Cancelar</Button><Button variant="primary" loading={step.pending} onClick={() => void step.run("shipped")}>Confirmar envío</Button></>}>
        <Field label="Transportista (opcional)"><Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="USPS, UPS, FedEx…" /></Field>
        <Field label="Número de seguimiento (opcional)" hint="Escríbelo exactamente como aparece en la etiqueta. MARKETZONE no genera números de seguimiento."><Input value={tracking} onChange={(e) => setTracking(e.target.value)} /></Field>
      </Sheet>
      <Sheet open={refundOpen} onClose={() => setRefundOpen(false)} title="Reembolsar pedido" footer={<><Button variant="ghost" onClick={() => setRefundOpen(false)}>Cancelar</Button><Button variant="danger" loading={refund.pending} disabled={reason.trim().length < 3} onClick={() => void refund.run()}>Reembolsar {money(so.subtotal_cents + so.shipping_cents)}</Button></>}>
        <Field label="Motivo"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="p. ej. artículo dañado en almacén" /></Field>
        <label className="check"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />Devolver las unidades al inventario</label>
        {so.is_test ? <Callout>Reembolso de prueba: no se mueve dinero real.</Callout> : <Callout kind="warn">Los reembolsos reales se tramitarán con el proveedor de pagos (pendiente de integración).</Callout>}
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
      <div className="row between"><span className="small muted">Destaca productos, tu tienda o tu negocio. Las campañas pagadas solo se activan tras confirmar el pago.</span>
        <Link to="/promociona/campana" className="btn btn-primary btn-sm"><Icon name="plus" size={16} />Nueva campaña</Link></div>
      {res.loading ? <Spinner /> : res.data?.length ? res.data.map((c) => (
        <Link key={c.id} to={`/promociona/campanas?id=${c.id}`} className="panel row between">
          <span className="stack" style={{ gap: 2 }}><b>{c.headline}</b><span className="small dim">{money(c.budget_cents)} · {c.duration_days} días · {c.stats.impressions} impresiones · {c.stats.clicks} clics</span></span>
          <Badge kind={tone(c.status) as "ok"}>{CAMPAIGN_STATUS[c.status]}</Badge>
        </Link>
      )) : <Empty icon="megaphone" title="Sin campañas" />}
    </div>
  );
}

export { invalidate };
