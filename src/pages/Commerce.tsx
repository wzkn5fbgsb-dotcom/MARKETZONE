import { useEffect, useState } from "react";
import { useApp } from "../app/state";
import { invalidate, useAction, useQuery } from "../app/query";
import { Link, navigate, useLocation } from "../app/router";
import { FULFILLMENT_STATUS, OFFER_STATUS, ORDER_STATUS, dateTime, money, pct, sizeLabel, tone } from "../app/format";
import type { CartLine, Offer, Order, SellerOrder } from "../api/types";
import { Page } from "../components/layout";
import { Badge, Button, Callout, ConfirmButton, Countdown, Empty, ErrorBox, Field, Img, MoneyInput, Select, Sheet, Spinner, StatusBadge, Stars, Tabs, TextArea, useToast } from "../ui/kit";
import { Icon } from "../ui/icons";
import { AddressForm, NeedLogin } from "./Account";

const ISSUE: Record<NonNullable<CartLine["issue"]>, string> = {
  unavailable: "Ya no está disponible", own_item: "Es tu propio producto", demo_item: "Producto de ejemplo: no se puede comprar",
  sold_out: "Agotado", insufficient_stock: "No hay suficientes unidades",
};

export function CartPage() {
  const { api, session, account, reloadAccount, settings } = useApp();
  const toast = useToast();
  const cart = useQuery(session ? "cart" : null, () => api.cart());
  const [addressId, setAddressId] = useState<string>("");
  const [addingAddr, setAddingAddr] = useState(false);
  useEffect(() => { if (!addressId && account?.addresses.length) setAddressId(account.addresses.find((a) => a.is_default)?.id ?? account.addresses[0].id); }, [account, addressId]);
  const update = useAction((id: string, q: number) => api.cartUpdate(id, q), { invalidates: ["cart"], onSuccess: () => reloadAccount(), onError: (e) => toast(e.message, "bad") });
  const checkout = useAction(() => api.checkout(addressId), {
    invalidates: ["cart", "product:", "orders"],
    onSuccess: (r) => { reloadAccount(); navigate(`/pedido/${r.order_id}`); },
    onError: () => cart.reload(),
  });
  if (!session) return <NeedLogin next="/carrito" />;
  const c = cart.data;
  const conflict = checkout.error?.code === "cart_conflict" ? (checkout.error.detail as any)?.issues as { title: string; issue: string; available?: number }[] : null;
  return (
    <Page>
      <div className="stack-lg">
        <h1 className="h1">Carrito</h1>
        {cart.loading ? <Spinner /> : !c?.lines.length ? (
          <Empty icon="bag" title="Tu carrito está vacío" action={<Link to="/categorias" className="btn btn-primary">Ver categorías</Link>}>Añade productos eligiendo la talla en su página.</Empty>
        ) : (
          <div className="split">
            <div className="stack">
              {c.lines.map((l) => (
                <div key={l.id} className="offer-card" style={{ borderColor: l.issue ? "rgba(220,20,60,.45)" : undefined }}>
                  <Link to={`/p/${l.product_id}`} className="thumb"><Img src={l.image_url} alt={l.title} /></Link>
                  <div className="stack" style={{ gap: 6, minWidth: 0 }}>
                    <div className="row between" style={{ alignItems: "flex-start" }}>
                      <Link to={`/p/${l.product_id}`} className="clamp-2" style={{ fontWeight: 600 }}>{l.title}</Link>
                      <span className="price">{money(l.line_total_cents)}</span>
                    </div>
                    <span className="small dim">{sizeLabel(l.size, l.color)} · {money(l.unit_price_cents)} c/u · {l.store.name}</span>
                    {l.issue && <span className="error-text">{ISSUE[l.issue]}{l.issue === "insufficient_stock" ? ` (quedan ${l.available})` : ""}</span>}
                    <div className="row" style={{ gap: 8 }}>
                      <div style={{ width: 86 }}>
                        <Select value={l.quantity} aria-label="Cantidad" onChange={(e) => void update.run(l.id, Number(e.target.value))}>
                          {Array.from({ length: Math.max(l.quantity, Math.min(l.available, 10)) }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                        </Select>
                      </div>
                      <Button size="sm" variant="ghost" icon="trash" onClick={() => void update.run(l.id, 0)}>Quitar</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="split-side stack">
              <div className="panel stack">
                <span className="eyebrow">Resumen</span>
                <dl className="kv">
                  <dt>Subtotal</dt><dd className="num" style={{ textAlign: "right" }}>{money(c.subtotal_cents, { always2: true })}</dd>
                  <dt>Envío</dt><dd className="num" style={{ textAlign: "right" }}>{money(c.shipping_cents, { always2: true })}<div className="tiny dim">{money(c.shipping_flat_cents)} por vendedor</div></dd>
                  <dt>Impuestos</dt><dd className="num" style={{ textAlign: "right" }}>{money(c.tax_cents, { always2: true })}<div className="tiny dim">No se aplican en modo de prueba</div></dd>
                  <dt><b>Total</b></dt><dd className="price" style={{ textAlign: "right", fontSize: 20 }}>{money(c.total_cents, { always2: true })}</dd>
                </dl>
                <hr className="divider" />
                <span className="eyebrow">Dirección de envío</span>
                {account?.addresses.length && !addingAddr ? (
                  <>
                    <Select value={addressId} onChange={(e) => setAddressId(e.target.value)} aria-label="Dirección">
                      {account.addresses.map((a) => <option key={a.id} value={a.id}>{a.full_name} · {a.line1}, {a.city}</option>)}
                    </Select>
                    <button className="link-btn small" style={{ alignSelf: "flex-start" }} onClick={() => setAddingAddr(true)}>Añadir otra dirección</button>
                  </>
                ) : <AddressForm onSaved={(a) => { setAddressId(a.id); setAddingAddr(false); }} onCancel={account?.addresses.length ? () => setAddingAddr(false) : undefined} />}
                {conflict && (
                  <Callout kind="bad"><div className="stack" style={{ gap: 4 }}><b>{checkout.error!.message}</b>
                    {conflict.map((i, k) => <span key={k}>• {i.title}: {ISSUE[i.issue as keyof typeof ISSUE] ?? i.issue}{i.available !== undefined ? ` (disponibles: ${i.available})` : ""}</span>)}</div></Callout>
                )}
                {checkout.error && !conflict && <ErrorBox error={checkout.error} />}
                <Button variant="primary" size="lg" block loading={checkout.pending} disabled={c.has_issues || !addressId || addingAddr} onClick={() => void checkout.run()}>Confirmar pedido</Button>
                {c.has_issues && <span className="small error-text">Quita o ajusta los artículos marcados para continuar.</span>}
                <span className="small dim">El servidor vuelve a comprobar precios y stock. Al confirmar, reservamos las unidades durante {c.hold_minutes} minutos mientras completas el pago.</span>
                {settings?.test_mode && <Callout kind="warn">Modo de prueba: el pago es simulado y no se cobra dinero real.</Callout>}
              </div>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}

export function OrdersPage() {
  const { api, session } = useApp();
  const res = useQuery(session ? "orders" : null, () => api.orders());
  if (!session) return <NeedLogin next="/pedidos" />;
  return (
    <Page narrow>
      <div className="stack-lg">
        <h1 className="h1">Mis pedidos</h1>
        {res.loading ? <Spinner /> : res.data?.length ? (
          <div className="stack" style={{ gap: 10 }}>{res.data.map((o) => (
            <Link key={o.id} to={`/pedido/${o.id}`} className="order-card">
              <div className="mini-thumbs">{(o.preview ?? []).slice(0, 3).map((u, i) => <div key={i}><Img src={u} alt="" /></div>)}</div>
              <div className="stack" style={{ gap: 3, minWidth: 0 }}>
                <span className="row" style={{ gap: 8 }}><b className="mono">#{o.number}</b><StatusBadge status={o.status} label={ORDER_STATUS[o.status]} />{o.is_test && <Badge kind="demo">Prueba</Badge>}</span>
                <span className="small dim">{o.items_count} artículo(s) · {dateTime(o.created_at)}{o.source === "offer" ? " · desde oferta" : ""}</span>
                {o.status === "pending_payment" && <Countdown to={o.payment_due_at} prefix="Paga antes de" />}
              </div>
              <span className="price">{money(o.total_cents)}</span>
            </Link>
          ))}</div>
        ) : <Empty icon="box" title="Todavía no tienes pedidos" action={<Link to="/categorias" className="btn btn-outline">Ver categorías</Link>}>Aquí aparecerán tus compras con su estado de pago y envío.</Empty>}
      </div>
    </Page>
  );
}

export function OrderPage({ id }: { id: string }) {
  const { api, session, account, reloadAccount, settings } = useApp();
  const toast = useToast();
  const res = useQuery(session ? `order:${id}` : null, () => api.order(id));
  const pay = useAction(() => api.payTest(id), {
    invalidates: [`order:${id}`, "orders", "offers", "product:"],
    onSuccess: (r) => { reloadAccount(); toast(r.status === "paid" ? "Pago de prueba confirmado" : "El plazo de pago venció y se liberó la reserva", r.status === "paid" ? "ok" : "bad"); },
  });
  const cancel = useAction(() => api.cancelOrder(id), { invalidates: [`order:${id}`, "orders", "offers"], onSuccess: () => toast("Pedido cancelado y reserva liberada", "ok") });
  const setAddr = useAction((addressId: string) => api.setOrderAddress(id, addressId), { invalidates: [`order:${id}`] });
  if (!session) return <NeedLogin next={`/pedido/${id}`} />;
  if (res.loading) return <Page><Spinner /></Page>;
  if (!res.data) return <Page><ErrorBox error={res.error} onRetry={res.reload} /></Page>;
  const o = res.data;
  const isBuyer = o.viewer_role === "buyer";
  const needsAddress = isBuyer && o.status === "pending_payment" && !o.shipping_address?.line1;
  return (
    <Page narrow>
      <div className="stack-lg">
        <Link to={isBuyer ? "/pedidos" : "/panel/pedidos"} className="row-nw small muted" style={{ gap: 4 }}><Icon name="back" size={16} />{isBuyer ? "Mis pedidos" : "Pedidos de mi tienda"}</Link>
        <div className="row between">
          <div className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">Pedido {o.source === "offer" ? "desde oferta aceptada" : ""}</span>
            <h1 className="h1 mono" style={{ fontFamily: "var(--font-mono)" }}>#{o.number}</h1>
            <span className="small dim">{dateTime(o.created_at)}</span>
          </div>
          <div className="row" style={{ gap: 6 }}><StatusBadge status={o.status} label={ORDER_STATUS[o.status]} />{o.is_test && <Badge kind="demo">Pedido de prueba</Badge>}</div>
        </div>

        {o.status === "pending_payment" && isBuyer && (
          <div className="panel stack" style={{ borderColor: "rgba(220,20,60,.45)" }}>
            <div className="row between"><b>Pendiente de pago</b><Countdown to={o.payment_due_at} /></div>
            <span className="small muted">Las unidades están reservadas para ti hasta {dateTime(o.payment_due_at)}. Si no se paga a tiempo, la reserva se libera automáticamente.</span>
            {needsAddress && (
              account?.addresses.length ? (
                <Field label="Elige la dirección de envío">
                  <Select defaultValue="" onChange={(e) => e.target.value && void setAddr.run(e.target.value)}>
                    <option value="" disabled>Selecciona…</option>
                    {account.addresses.map((a) => <option key={a.id} value={a.id}>{a.full_name} · {a.line1}</option>)}
                  </Select>
                </Field>
              ) : <AddressForm onSaved={(a) => void setAddr.run(a.id)} />
            )}
            <ErrorBox error={pay.error ?? cancel.error} />
            <div className="row">
              {o.is_test && settings?.test_mode ? (
                <Button variant="primary" size="lg" loading={pay.pending} disabled={needsAddress} onClick={() => void pay.run()}>Pagar {money(o.total_cents)} (prueba, sin cobro)</Button>
              ) : <Callout kind="warn">El pago real requiere integrar el proveedor de pagos (pendiente de configuración).</Callout>}
              <ConfirmButton confirmLabel="Sí, cancelar" onConfirm={() => void cancel.run()} variant="ghost" size="lg">Cancelar pedido</ConfirmButton>
            </div>
            {o.is_test && <span className="small dim">Modo de prueba: no se cobra dinero real ni se piden datos de tarjeta.</span>}
          </div>
        )}

        {o.seller_orders.map((so) => <SellerOrderBlock key={so.id} so={so} order={o} />)}

        {isBuyer && (
          <div className="panel stack">
            <span className="eyebrow">Importe</span>
            <dl className="kv">
              <dt>Subtotal</dt><dd className="num">{money(o.subtotal_cents, { always2: true })}</dd>
              <dt>Envío</dt><dd className="num">{money(o.shipping_cents, { always2: true })}</dd>
              <dt>Impuestos</dt><dd className="num">{money(o.tax_cents, { always2: true })}</dd>
              <dt><b>Total</b></dt><dd className="price">{money(o.total_cents, { always2: true })}</dd>
            </dl>
            {o.payments.map((p, i) => <span key={i} className="small dim">Pago {p.provider === "test" ? "de prueba (sin dinero real)" : p.provider} · {p.status === "succeeded" ? "confirmado" : p.status} · {money(p.amount_cents, { always2: true })} · {dateTime(p.created_at)}</span>)}
            {o.refunds.map((r, i) => <span key={i} className="small dim">Reembolso {r.is_test ? "de prueba" : ""} · {money(r.amount_cents, { always2: true })} · {r.status} · {r.reason}</span>)}
          </div>
        )}

        {o.shipping_address?.line1 && (
          <div className="panel stack" style={{ gap: 4 }}>
            <span className="eyebrow">Envío a</span>
            <span>{o.shipping_address.full_name}</span>
            <span className="small muted">{o.shipping_address.line1}{o.shipping_address.line2 ? `, ${o.shipping_address.line2}` : ""} · {o.shipping_address.city}, {o.shipping_address.region} {o.shipping_address.postal_code}</span>
          </div>
        )}
      </div>
    </Page>
  );
}

function SellerOrderBlock({ so, order }: { so: SellerOrder; order: Order }) {
  const { api } = useApp();
  const toast = useToast();
  const isBuyer = order.viewer_role === "buyer";
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const confirm = useAction(() => api.confirmDelivery(so.id), { invalidates: [`order:${order.id}`], onSuccess: () => toast("Entrega confirmada", "ok") });
  const review = useAction(() => api.review(so.id, rating, body), { invalidates: [`order:${order.id}`, "store:"], onSuccess: () => toast("Gracias por tu reseña", "ok") });
  const steps: [string, string][] = [["paid", "Pagado"], ["preparing", "Preparando"], ["shipped", "Enviado"], ["delivered", "Entregado"]];
  const idx = ["paid", "preparing", "shipped", "delivered"].indexOf(so.status);
  return (
    <div className="panel stack">
      <div className="row between">
        <span className="row" style={{ gap: 8 }}><Icon name="store" size={18} /><b>{so.store?.name ?? so.seller.username}</b></span>
        <StatusBadge status={so.status} label={FULFILLMENT_STATUS[so.status]} />
      </div>
      {so.items.map((it) => (
        <div key={it.id} className="row-nw" style={{ gap: 12 }}>
          <div style={{ width: 52, aspectRatio: "4 / 5", borderRadius: 8, overflow: "hidden", flex: "none" }}><Img src={it.image_url} alt="" /></div>
          <div className="stack grow" style={{ gap: 2 }}>
            {it.product_id ? <Link to={`/p/${it.product_id}`} className="clamp-2">{it.title}</Link> : <span>{it.title}</span>}
            <span className="small dim">{sizeLabel(it.size, it.color)} · {it.quantity} × {money(it.unit_price_cents)}</span>
          </div>
          <span className="num">{money(it.line_total_cents)}</span>
        </div>
      ))}
      {idx >= 0 && (
        <div className="row" style={{ gap: 14 }}>
          {steps.map(([k, l], i) => <span key={k} className={`step ${i <= idx ? "on" : ""}`}><span className="n">{i <= idx ? <Icon name="check" size={12} /> : i + 1}</span>{l}</span>)}
        </div>
      )}
      {so.status === "shipped" || so.status === "delivered" ? (
        <span className="small muted">{so.carrier || so.tracking_number ? `Seguimiento: ${so.carrier ?? ""} ${so.tracking_number ?? ""}` : "El vendedor no añadió número de seguimiento."}</span>
      ) : null}
      {!isBuyer && <span className="small dim">Comisión {pct(so.commission_bps)}: {money(so.commission_cents)} · Neto estimado para el vendedor: {money(so.seller_net_cents)}</span>}
      {isBuyer && so.status === "shipped" && <div><Button variant="dark" size="sm" loading={confirm.pending} onClick={() => void confirm.run()}>Confirmar que lo recibí</Button></div>}
      {isBuyer && so.status === "delivered" && !so.review && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">Califica esta compra</span>
          <div className="row" style={{ gap: 4 }}>{[1, 2, 3, 4, 5].map((n) => <button key={n} className="icon-btn" onClick={() => setRating(n)} aria-label={`${n} estrellas`}>
            <Icon name="star" size={24} fill={n <= rating ? "#F2B544" : undefined} style={{ color: n <= rating ? "#F2B544" : "var(--line)" }} /></button>)}</div>
          <TextArea placeholder="¿Cómo fue la compra? (opcional)" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} />
          <ErrorBox error={review.error} />
          <div><Button variant="primary" size="sm" loading={review.pending} onClick={() => void review.run()}>Publicar reseña</Button></div>
        </div>
      )}
      {so.review && <span className="row small" style={{ gap: 8 }}><Stars value={so.review.rating} />{so.review.body}</span>}
      <ErrorBox error={confirm.error} />
    </div>
  );
}

// ------------------------------------------------------------------ Ofertas
export function OffersPage() {
  const { session } = useApp();
  const loc = useLocation();
  const [tab, setTab] = useState<"buyer" | "seller">((loc.query.get("rol") as "seller") ?? "buyer");
  if (!session) return <NeedLogin next="/ofertas" />;
  return (
    <Page narrow>
      <div className="stack-lg">
        <h1 className="h1">Ofertas</h1>
        <Tabs value={tab} onChange={setTab} items={[{ id: "buyer", label: "Enviadas" }, { id: "seller", label: "Recibidas" }]} />
        <OfferList role={tab} />
      </div>
    </Page>
  );
}

export function OfferList({ role }: { role: "buyer" | "seller" }) {
  const { api } = useApp();
  const res = useQuery(`offers:${role}`, () => api.offers(role));
  if (res.loading) return <Spinner />;
  if (res.error) return <ErrorBox error={res.error} onRetry={res.reload} />;
  if (!res.data?.length) return <Empty icon="offer" title={role === "buyer" ? "No has enviado ofertas" : "No has recibido ofertas"}>{role === "buyer" ? "En cualquier producto que acepte ofertas verás el botón “Hacer una oferta”." : "Cuando un comprador te ofrezca un precio, aparecerá aquí."}</Empty>;
  const open = res.data.filter((o) => ["pending", "countered", "accepted"].includes(o.status));
  const closed = res.data.filter((o) => !["pending", "countered", "accepted"].includes(o.status));
  return (
    <div className="stack">
      {open.map((o) => <OfferCard key={o.id} o={o} />)}
      {closed.length > 0 && <span className="eyebrow" style={{ marginTop: 12 }}>Historial</span>}
      {closed.map((o) => <OfferCard key={o.id} o={o} />)}
    </div>
  );
}

function OfferCard({ o }: { o: Offer }) {
  const { api, settings } = useApp();
  const toast = useToast();
  const [counterOpen, setCounterOpen] = useState(false);
  const [counter, setCounter] = useState<number | null>(Math.round((o.amount_cents + o.list_price_cents) / 2 / 100) * 100);
  const act = useAction((a: "accept" | "decline" | "counter" | "cancel", amt?: number) => api.respondOffer(o.id, a, amt), {
    invalidates: ["offers:", "product:", "dashboard", "orders"],
    onSuccess: (r) => {
      setCounterOpen(false);
      if (r.conflict) toast("El artículo se agotó: la oferta se canceló sin cargos", "bad");
      else toast({ accepted: "Oferta aceptada: se creó la compra pendiente de pago", declined: "Oferta rechazada", countered: "Contraoferta enviada", cancelled: "Oferta retirada" }[r.status as string] ?? "Hecho", "ok");
    },
    onError: (e) => toast(e.message, "bad"),
  });
  const mine = o.viewer_role;
  const myTurn = (o.status === "pending" || o.status === "countered") && o.awaiting === mine;
  const commission = settings ? Math.round(o.amount_cents * o.quantity * settings.commission_bps / 10000) : 0;
  return (
    <div className="offer-card">
      <Link to={`/p/${o.product.id}`} className="thumb"><Img src={o.product.image_url} alt={o.product.title} /></Link>
      <div className="stack" style={{ gap: 8, minWidth: 0 }}>
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <Link to={`/p/${o.product.id}`} className="clamp-2" style={{ fontWeight: 600 }}>{o.product.title}</Link>
            <span className="small dim">{sizeLabel(o.variant?.size ?? null, o.variant?.color ?? null)} · {mine === "buyer" ? `Vendedor @${o.seller.username}` : `Comprador @${o.buyer.username}`}</span>
          </div>
          <Badge kind={tone(o.status) as "ok"}>{OFFER_STATUS[o.status]}</Badge>
        </div>
        <div className="ladder">
          <span>Publicado <b>{money(o.list_price_cents)}</b></span><Icon name="chevron" size={12} />
          <span>Oferta <b>{money(o.offer_cents)}</b></span>
          {o.amount_cents !== o.offer_cents && <><Icon name="chevron" size={12} /><span>Contraoferta <b>{money(o.amount_cents)}</b></span></>}
        </div>
        {(o.status === "pending" || o.status === "countered") && <Countdown to={o.expires_at} prefix={myTurn ? "Responde antes de" : "Vence en"} />}
        {o.status === "accepted" && o.order && (
          <div className="row" style={{ gap: 8 }}>
            <Countdown to={o.order.payment_due_at} prefix="Pago pendiente ·" />
            {mine === "buyer" ? <Link to={`/pedido/${o.order.id}`} className="btn btn-primary btn-sm">Pagar {money(o.order.total_cents)}</Link>
              : <span className="small dim">Unidad reservada hasta que el comprador pague.</span>}
          </div>
        )}
        {o.status === "completed" && o.order && <Link to={`/pedido/${o.order.id}`} className="link small">Ver pedido #{o.order.number}</Link>}
        {myTurn && (
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" variant="primary" loading={act.pending} onClick={() => void act.run("accept")}>Aceptar {money(o.amount_cents)}</Button>
            {mine === "seller" && o.status === "pending" && <Button size="sm" variant="dark" onClick={() => setCounterOpen(true)}>Contraofertar</Button>}
            <ConfirmButton confirmLabel="Rechazar" onConfirm={() => void act.run("decline")}>Rechazar</ConfirmButton>
          </div>
        )}
        {mine === "seller" && myTurn && settings && <span className="tiny dim">Si aceptas: comisión {pct(settings.commission_bps)} ≈ {money(commission)}; recibirías ≈ {money(o.amount_cents * o.quantity - commission)} cuando se pague.</span>}
        {mine === "buyer" && (o.status === "pending" || o.status === "countered") && !myTurn && <div><ConfirmButton confirmLabel="Retirar" onConfirm={() => void act.run("cancel")} variant="ghost">Retirar oferta</ConfirmButton></div>}
        {mine === "buyer" && o.status === "countered" && <div><ConfirmButton confirmLabel="Retirar" onConfirm={() => void act.run("cancel")} variant="ghost">Retirar oferta</ConfirmButton></div>}
        <details className="small dim"><summary style={{ cursor: "pointer" }}>Historial</summary>
          <div className="timeline" style={{ marginTop: 8 }}>{o.events.map((e, i) => (
            <div key={i} className="tl-item on"><span className="tl-dot" /><span>{{ offer: "Oferta", counter: "Contraoferta", accept: "Aceptada", decline: "Rechazada", cancel: "Cancelada", expire: "Expirada", complete: "Compra completada", conflict: "Conflicto de inventario" }[e.kind] ?? e.kind}
              {e.amount_cents ? ` · ${money(e.amount_cents)}` : ""} · {dateTime(e.created_at)}{e.note ? ` — ${e.note}` : ""}</span></div>
          ))}</div>
        </details>
      </div>
      <Sheet open={counterOpen} onClose={() => setCounterOpen(false)} title="Contraoferta" footer={<><Button variant="ghost" onClick={() => setCounterOpen(false)}>Cancelar</Button>
        <Button variant="primary" loading={act.pending} disabled={!counter || counter <= o.amount_cents || counter >= o.list_price_cents} onClick={() => void act.run("counter", counter ?? 0)}>Enviar contraoferta</Button></>}>
        <span className="muted small">Oferta del comprador: {money(o.amount_cents)} · Precio publicado: {money(o.list_price_cents)}</span>
        <Field label="Tu contraoferta" hint={`Entre ${money(o.amount_cents + 1)} y ${money(o.list_price_cents - 1)}`}><MoneyInput cents={counter} onChange={setCounter} /></Field>
      </Sheet>
    </div>
  );
}

export { invalidate };
