import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../app/state";
import { invalidate, useAction, useQuery } from "../app/query";
import { Link, navigate } from "../app/router";
import { CAMPAIGN_KIND, CAMPAIGN_STATUS, OFFER_STATUS, ORDER_STATUS, dateTime, money, pct, tone } from "../app/format";
import { Page } from "../components/layout";
import { Badge, Button, Callout, ConfirmButton, Empty, ErrorBox, Field, Input, MoneyInput, Spinner, Stat, Tabs, Toggle, useToast } from "../ui/kit";
import { NeedLogin } from "./Account";

const TABS = ["resumen", "ajustes", "campanas", "reportes", "publicaciones", "usuarios", "tiendas", "negocios", "pedidos", "ofertas", "pagos", "auditoria"] as const;
type T = (typeof TABS)[number];
const LABEL: Record<T, string> = { resumen: "Resumen", ajustes: "Comisiones y ajustes", campanas: "Campañas", reportes: "Reportes", publicaciones: "Publicaciones", usuarios: "Usuarios",
  tiendas: "Tiendas", negocios: "Negocios", pedidos: "Pedidos", ofertas: "Ofertas", pagos: "Pagos", auditoria: "Auditoría" };

export default function Admin({ tab }: { tab?: string }) {
  const { session, account, accountLoading } = useApp();
  const t = (TABS as readonly string[]).includes(tab ?? "") ? (tab as T) : "resumen";
  if (!session) return <NeedLogin next="/admin" />;
  if (accountLoading) return <Page><Spinner /></Page>;
  if (!account?.is_admin) return <Page narrow><Callout kind="bad">Esta sección es solo para administradores. Los permisos se comprueban en el servidor: ocultar o mostrar botones no concede acceso.</Callout></Page>;
  return (
    <Page>
      <div className="stack-lg">
        <div className="stack" style={{ gap: 4 }}><span className="eyebrow">Administración</span><h1 className="h1">Panel de MARKETZONE</h1></div>
        <Tabs value={t} onChange={(v) => navigate(`/admin/${v}`, { keepScroll: true })} items={TABS.map((id) => ({ id, label: LABEL[id] }))} />
        {t === "resumen" && <Overview />}
        {t === "ajustes" && <SettingsForm />}
        {t === "campanas" && <EntityList entity="campaigns" />}
        {t === "reportes" && <EntityList entity="reports" />}
        {t === "publicaciones" && <EntityList entity="products" />}
        {t === "usuarios" && <EntityList entity="users" />}
        {t === "tiendas" && <EntityList entity="stores" />}
        {t === "negocios" && <EntityList entity="businesses" />}
        {t === "pedidos" && <EntityList entity="orders" />}
        {t === "ofertas" && <EntityList entity="offers" />}
        {t === "pagos" && <EntityList entity="payments" />}
        {t === "auditoria" && <EntityList entity="audit" />}
      </div>
    </Page>
  );
}

function Overview() {
  const { api } = useApp();
  const res = useQuery("admin:overview", () => api.adminOverview());
  if (res.loading) return <Spinner />;
  if (!res.data) return <ErrorBox error={res.error} onRetry={res.reload} />;
  const d = res.data;
  const sum = (o: Record<string, number> | null) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
  return (
    <div className="stack-lg">
      <div className="stats">
        <Stat label="Usuarios" value={d.users} sub={`${d.suspended_users} suspendidos`} />
        <Stat label="Vendedores" value={d.sellers} />
        <Stat label="Tiendas" value={d.stores} sub={`${d.businesses} negocios`} />
        <Stat label="Publicaciones" value={sum(d.products)} sub={`${d.products?.active ?? 0} activas · ${d.blocked_products} bloqueadas`} />
        <Stat label="Pedidos reales" value={sum(d.orders_real)} sub={`${d.orders_real?.paid ?? 0} pagados`} />
        <Stat label="Pedidos de prueba" value={sum(d.orders_test)} sub={`${d.orders_test?.paid ?? 0} pagados`} />
        <Stat label="Ofertas abiertas" value={d.open_offers} />
        <Stat label="Reportes abiertos" value={d.open_reports} />
        <Stat label="Campañas por revisar" value={d.campaigns_pending_review} sub={`${d.campaigns_active} activas`} />
        <Stat label="Reembolsos pendientes" value={d.refunds_pending} />
      </div>
      <div className="table-wrap"><table className="table money-table">
        <thead><tr><th>Dinero</th><th>Real</th><th>Prueba</th></tr></thead>
        <tbody>
          <tr><td>Volumen de ventas pagadas (GMV)</td><td className="num">{money(d.gmv_real_cents, { always2: true })}</td><td className="num dim">{money(d.gmv_test_cents, { always2: true })}</td></tr>
          <tr><td>Comisiones de la plataforma</td><td className="num">{money(d.commission_real_cents, { always2: true })}</td><td className="num dim">{money(d.commission_test_cents, { always2: true })}</td></tr>
        </tbody></table></div>
      <span className="small dim">Comisión vigente: {pct(d.settings.commission_bps)} · modo de prueba {d.settings.test_mode ? "activado" : "desactivado"}.</span>
    </div>
  );
}

function SettingsForm() {
  const { api } = useApp();
  const toast = useToast();
  const res = useQuery("admin:overview", () => api.adminOverview());
  const [f, setF] = useState<Record<string, number | boolean>>({});
  useEffect(() => { if (res.data) setF({ ...res.data.settings } as any); }, [res.data]);
  const save = useAction(() => api.adminSettings({
    commission_bps: f.commission_bps, shipping_flat_cents: f.shipping_flat_cents, checkout_hold_minutes: f.checkout_hold_minutes,
    offer_response_minutes: f.offer_response_minutes, offer_payment_minutes: f.offer_payment_minutes, min_offer_percent: f.min_offer_percent,
    min_campaign_cents: f.min_campaign_cents, test_mode: f.test_mode,
  }), { invalidates: ["admin:", "settings", "dashboard"], onSuccess: () => toast("Ajustes guardados", "ok") });
  if (!res.data) return <Spinner />;
  const num = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: Number(e.target.value.replace(/\D/g, "")) });
  return (
    <form className="stack-lg" style={{ maxWidth: 680 }} onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <div className="grid-2">
        <Field label="Comisión por venta (%)" hint="Se aplica a ventas nuevas; los pedidos guardan la tarifa vigente al crearse.">
          <Input inputMode="decimal" value={String((f.commission_bps as number) / 100)} onChange={(e) => setF({ ...f, commission_bps: Math.round(Number(e.target.value.replace(",", ".")) * 100) || 0 })} />
        </Field>
        <Field label="Envío por vendedor"><MoneyInput cents={f.shipping_flat_cents as number} onChange={(v) => setF({ ...f, shipping_flat_cents: v ?? 0 })} /></Field>
        <Field label="Reserva en checkout (minutos)"><Input inputMode="numeric" value={String(f.checkout_hold_minutes ?? "")} onChange={num("checkout_hold_minutes")} /></Field>
        <Field label="Plazo de respuesta a ofertas (minutos)"><Input inputMode="numeric" value={String(f.offer_response_minutes ?? "")} onChange={num("offer_response_minutes")} /></Field>
        <Field label="Plazo de pago de oferta aceptada (minutos)" hint="Para probar la expiración, usa 1–2 minutos."><Input inputMode="numeric" value={String(f.offer_payment_minutes ?? "")} onChange={num("offer_payment_minutes")} /></Field>
        <Field label="Oferta mínima (% del precio)"><Input inputMode="numeric" value={String(f.min_offer_percent ?? "")} onChange={num("min_offer_percent")} /></Field>
        <Field label="Presupuesto mínimo de campaña"><MoneyInput cents={f.min_campaign_cents as number} onChange={(v) => setF({ ...f, min_campaign_cents: v ?? 0 })} /></Field>
      </div>
      <Toggle checked={!!f.test_mode} onChange={(v) => setF({ ...f, test_mode: v })} label="Modo de prueba (pagos simulados, sin dinero real)" />
      {!res.data.settings.real_payments_ready && <Callout kind="warn">El modo de prueba no puede desactivarse hasta integrar y verificar el proveedor de pagos. El servidor rechazará el cambio.</Callout>}
      <ErrorBox error={save.error} />
      <div><Button variant="primary" type="submit" loading={save.pending}>Guardar ajustes</Button></div>
    </form>
  );
}

function EntityList({ entity }: { entity: string }) {
  const { api } = useApp();
  const toast = useToast();
  const [q, setQ] = useState("");
  const res = useQuery(`admin:${entity}:${q}`, () => api.adminList<any>(entity, { q, limit: 100 }));
  const mod = useAction((ent: string, id: string, action: string, note?: string) => api.adminModerate(ent, id, action, note), {
    invalidates: ["admin:", "home", "search:", "product:"], onSuccess: () => toast("Acción registrada en la auditoría", "ok"), onError: (e) => toast(e.message, "bad"),
  });
  const items = res.data?.items ?? [];
  const searchable = ["users", "stores", "businesses", "products", "orders"].includes(entity);
  return (
    <div className="stack">
      {searchable && <div className="search-box" style={{ maxWidth: 420 }}><input className="input" style={{ paddingLeft: 16 }} placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
      <ErrorBox error={res.error} onRetry={res.reload} />
      {res.loading ? <Spinner /> : !items.length ? <Empty title="Sin elementos" /> : (
        <div className="stack" style={{ gap: 8 }}>
          {items.map((it) => <AdminRow key={it.id} entity={entity} it={it} act={(ent, action, note) => void mod.run(ent, it.id, action, note)} busy={mod.pending} />)}
        </div>
      )}
    </div>
  );
}

function AdminRow({ entity, it, act, busy }: { entity: string; it: any; act: (ent: string, action: string, note?: string) => void; busy: boolean }) {
  const [note, setNote] = useState("");
  const line = (title: ReactNode, sub: ReactNode, badges: ReactNode, actions: ReactNode) => (
    <div className="panel stack" style={{ gap: 8, padding: 14 }}>
      <div className="row between" style={{ alignItems: "flex-start" }}><div className="stack" style={{ gap: 2, minWidth: 0 }}><b className="ellipsis">{title}</b><span className="small dim">{sub}</span></div><span className="row" style={{ gap: 6 }}>{badges}</span></div>
      {actions && <div className="row" style={{ gap: 6 }}>{actions}</div>}
    </div>
  );
  switch (entity) {
    case "campaigns": return line(it.headline, `${CAMPAIGN_KIND[it.kind as keyof typeof CAMPAIGN_KIND]?.label} · @${it.owner} · ${money(it.budget_cents)} · ${it.duration_days} días · ${it.product?.title ?? it.business?.name ?? it.store?.name ?? ""}`,
      <>{it.is_demo && <Badge kind="demo">Demo</Badge>}{it.is_test && <Badge kind="demo">Prueba</Badge>}<Badge kind={tone(it.status) as "ok"}>{CAMPAIGN_STATUS[it.status as keyof typeof CAMPAIGN_STATUS]}</Badge></>,
      it.status === "pending_review" ? <><input className="input" style={{ maxWidth: 260, minHeight: 34 }} placeholder="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button size="sm" variant="primary" disabled={busy} onClick={() => act("campaign", "approve", note)}>Aprobar (queda pendiente de pago)</Button>
        <Button size="sm" variant="danger" disabled={busy} onClick={() => act("campaign", "reject", note)}>Rechazar</Button></>
        : it.status === "active" || it.status === "paused" ? <ConfirmButton confirmLabel="Finalizar" onConfirm={() => act("campaign", "finish")}>Finalizar campaña</ConfirmButton> : null);
    case "reports": return line(`${it.target_type} · ${it.reason}`, `@${it.reporter} · ${dateTime(it.created_at)}${it.details ? ` · “${it.details}”` : ""}`,
      <Badge kind={tone(it.status) as "ok"}>{it.status}</Badge>,
      ["open", "reviewing"].includes(it.status) ? <>
        {it.target_type === "product" && <Link to={`/p/${it.target_id}`} className="btn btn-ghost btn-sm">Ver producto</Link>}
        {it.target_type === "product" && <Button size="sm" variant="danger" disabled={busy} onClick={() => act("product", "block", "Bloqueado por reporte")}>Bloquear producto</Button>}
        <Button size="sm" variant="dark" disabled={busy} onClick={() => act("report", "resolved")}>Resuelto</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("report", "dismissed")}>Descartar</Button></> : null);
    case "products": return line(<Link to={`/p/${it.id}`}>{it.title}</Link>, `@${it.seller?.username} · ${money(it.price_cents)} · ${it.available} disp.`,
      <>{it.is_demo && <Badge kind="demo">Demo</Badge>}<Badge kind={it.moderation_status === "blocked" ? "bad" : tone(it.status) as "ok"}>{it.moderation_status === "blocked" ? "bloqueada" : it.status}</Badge></>,
      it.moderation_status === "blocked" ? <Button size="sm" variant="dark" disabled={busy} onClick={() => act("product", "unblock")}>Desbloquear</Button>
        : <ConfirmButton confirmLabel="Bloquear" onConfirm={() => act("product", "block", "Moderación")}>Bloquear</ConfirmButton>);
    case "users": return line(`${it.display_name} (@${it.username})`, `${it.email ?? ""} · ${it.products} publicaciones · ${dateTime(it.created_at)}`,
      <>{it.role === "admin" && <Badge kind="accent">Admin</Badge>}<Badge kind={tone(it.status) as "ok"}>{it.status}</Badge></>,
      <>{it.status === "active" ? <ConfirmButton confirmLabel="Suspender" onConfirm={() => act("user", "suspend")}>Suspender</ConfirmButton> : <Button size="sm" variant="dark" onClick={() => act("user", "activate")}>Reactivar</Button>}
        {it.role === "admin" ? <ConfirmButton confirmLabel="Quitar admin" onConfirm={() => act("user", "remove_admin")}>Quitar admin</ConfirmButton> : <ConfirmButton confirmLabel="Hacer admin" onConfirm={() => act("user", "make_admin")}>Hacer admin</ConfirmButton>}</>);
    case "stores": return line(<Link to={`/tienda/${it.slug}`}>{it.name}</Link>, `@${it.owner?.username} · ${it.stats.active_listings} publicaciones`,
      <>{it.is_demo && <Badge kind="demo">Demo</Badge>}<Badge kind={tone(it.status) as "ok"}>{it.status}</Badge></>,
      it.status === "active" ? <ConfirmButton confirmLabel="Suspender" onConfirm={() => act("store", "suspend")}>Suspender</ConfirmButton> : <Button size="sm" variant="dark" onClick={() => act("store", "activate")}>Reactivar</Button>);
    case "businesses": return line(<Link to={`/negocio/${it.slug}`}>{it.name}</Link>, `${it.category} · ${it.location ?? ""}`,
      <>{it.is_demo && <Badge kind="demo">Demo</Badge>}<Badge kind={tone(it.status) as "ok"}>{it.status}</Badge></>,
      it.status === "active" ? <ConfirmButton confirmLabel="Suspender" onConfirm={() => act("business", "suspend")}>Suspender</ConfirmButton> : <Button size="sm" variant="dark" onClick={() => act("business", "activate")}>Reactivar</Button>);
    case "orders": return line(<Link to={`/pedido/${it.id}`}>#{it.number}</Link>, `@${it.buyer} · ${money(it.total_cents)} · ${it.source} · ${dateTime(it.created_at)} · ${(it.sellers ?? []).map((s: any) => `@${s.username} ${s.status} (com. ${money(s.commission_cents)})`).join(", ")}`,
      <>{it.is_test && <Badge kind="demo">Prueba</Badge>}<Badge kind={tone(it.status) as "ok"}>{ORDER_STATUS[it.status as keyof typeof ORDER_STATUS]}</Badge></>, null);
    case "offers": return line(it.product?.title, `@${it.buyer.username} → @${it.seller.username} · ${money(it.offer_cents)} → ${money(it.amount_cents)} (lista ${money(it.list_price_cents)})`,
      <Badge kind={tone(it.status) as "ok"}>{OFFER_STATUS[it.status as keyof typeof OFFER_STATUS]}</Badge>, null);
    case "payments": return line(`${it.provider} · ${money(it.amount_cents, { always2: true })}`, `${it.order_number ? `Pedido #${it.order_number}` : "Campaña"} · ${dateTime(it.created_at)} · ref ${it.provider_ref ?? "—"}`,
      <>{it.is_test && <Badge kind="demo">Prueba</Badge>}<Badge kind={tone(it.status) as "ok"}>{it.status}</Badge></>, null);
    case "audit": return line(it.action, `@${it.actor ?? "sistema"} · ${it.target_type} ${it.target_id ?? ""} · ${dateTime(it.created_at)}`, null, null);
    default: return null;
  }
}

export { invalidate };
