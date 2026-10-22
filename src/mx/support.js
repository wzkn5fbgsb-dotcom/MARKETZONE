// Servicio al cliente: chat con IA para clientes y bandeja del equipo que enseña a la IA.
import { MXR, mxh, G, r, U, J, I, O, ne, $e, ce, Ee, oe, ga, ko, pa, j, ae, Ta, Y, lt, Se, ge, st, _a } from "./compat.js";
import { MxFxWatcher } from "./fx.js";
import { mxAgo } from "./ui.js";
import { normalizeSupportResult } from "../../supabase/functions/_shared/support-ai";

function mxSupportNormalize(e, kbIds) { return normalizeSupportResult(e, kbIds, r); }

/* ---------- Políticas que conoce el asistente (salen de la configuración real) ---------- */
/* Respuestas locales cuando la IA no está disponible: busca en la base aprendida y en las preguntas frecuentes. */
var MX_SUPPORT_FAQ = [
  { k: /subast|puj|reenlist/i, a: "En Subastas, para pujar retienes un límite más el envío; las pujas suben de $1 en $1. Si ganas, se cobra de lo retenido y al resto se le libera todo.", path: "/subastas", label: "Ver subastas" },
  { k: /oferta/i, a: "Tu oferta se paga al enviarla y queda retenida. Si el vendedor acepta, el trato está hecho; si rechaza o vence, se libera tu dinero completo.", path: "/ofertas", label: "Mis ofertas" },
  { k: /pedido|envi|guía|guia|lleg|rastre/i, a: "En Mis pedidos ves el estado y el número de guía cuando el vendedor lo agrega. Si no llega o no coincide, abre el pedido y toca Reportar un problema.", path: "/pedidos", label: "Mis pedidos" },
  { k: /reembols|devol|dinero de vuelta/i, a: "Los reembolsos se piden desde el pedido con Reportar un problema; el equipo revisa cada caso.", path: "/pedidos", label: "Mis pedidos" },
  { k: /vend|publica/i, a: "Toca Vender, sube tus fotos y la IA propone título y descripción. También puedes subastar desde la pestaña Subastas con 1 foto.", path: "/publicar", label: "Vender" },
  { k: /comisi/i, a: "El vendedor paga una comisión sobre el precio de venta; comprar no tiene comisión.", path: "/terminos", label: "Términos" },
  { k: /cuenta|contraseñ|eliminar|bloque/i, a: "En Ajustes cambias tu perfil y direcciones, bloqueas usuarios o eliminas tu cuenta.", path: "/ajustes", label: "Ajustes" },
  { k: /pago|tarjeta|cobr/i, a: "Por ahora la app está en modo de prueba: no se cobra dinero real ni se usan tarjetas reales.", path: "/carrito", label: "Carrito" }
];
function mxSupportLocal(text, kb) {
  var words = String(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\W+/).filter(function (w) { return w.length > 3; });
  var best = null, score = 0;
  (kb || []).forEach(function (k) {
    var q = (k.question + " " + k.answer).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    var s = words.filter(function (w) { return q.indexOf(w) >= 0; }).length;
    if (s > score) { score = s; best = k; }
  });
  if (best && score >= 2) return { reply: best.answer, actions: [], escalate: false, confidence: "media", topic: "otro", kb_ids: [best.id] };
  var f = MX_SUPPORT_FAQ.filter(function (x) { return x.k.test(text); })[0];
  if (f) return { reply: r(f.a), actions: [{ label: r(f.label), path: f.path }], escalate: false, confidence: "media", topic: "otro", kb_ids: [] };
  return { reply: r("No tengo una respuesta segura para esto. Le paso tu caso al equipo y te responderán aquí mismo."), actions: [], escalate: true, escalate_reason: r("Sin respuesta automática"), confidence: "baja", topic: "otro", kb_ids: [] };
}

async function mxSupportAsk(backend, ctx) {
  var ids = (ctx.kb || []).map(function (k) { return k.id; });
  var last = (ctx.history || []).filter(function (m) { return m.role === "user"; }).slice(-1)[0];
  if (/\b(persona|humano|agente|alguien real|hablar con alguien|operador)\b/i.test(last ? last.body : ""))
    return { reply: r("Claro. Le paso tu caso al equipo de MARKETXONE y te responderán en esta misma conversación. Mientras, puedes seguir usando la app."), actions: [], escalate: true, escalate_reason: r("La persona pidió hablar con el equipo."), confidence: "alta", topic: "otro", kb_ids: [] };
  try {
    var res = await backend.invokeFunction("ai-support", { input: ctx });
    return mxSupportNormalize(res && (res.answer || res), ids);
  } catch (e) {
    return mxSupportLocal(last ? last.body : "", ctx.kb);
  }
}

async function mxSupportContext(api, g) {
  var safe = function (p) { return p.catch(function () { return null; }); };
  var all = await Promise.all([safe(api.call("support_kb")), safe(api.call("my_orders")), safe(api.call("my_offers", { p_role: "buyer" })),
    safe(api.call("my_auctions", { p_role: "buyer" })), safe(api.call("my_auctions", { p_role: "seller" })), safe(api.call("seller_orders_list", { p_status: null }))]);
  var orders = (all[1] || []).slice(0, 8);
  var details = await Promise.all(orders.slice(0, 3).map(function (o) { return safe(api.call("get_order", { p_order_id: o.id })); }));
  var pickOrder = function (o, i) {
    var dt = details[i];
    return { id: o.id, number: o.number, status: o.status, total: Y(o.total_cents), source: o.source, created_at: o.created_at, fulfillment: o.fulfillment,
      items: dt && dt.seller_orders ? [].concat.apply([], dt.seller_orders.map(function (so) { return (so.items || []).map(function (x) { return x.title + (x.size ? " (" + x.size + ")" : ""); }); })).slice(0, 5) : undefined,
      shipments: dt && dt.seller_orders ? dt.seller_orders.map(function (so) { return { seller_order_id: so.id, status: so.status, carrier: so.carrier, tracking: so.tracking_number, shipped_at: so.shipped_at, delivered_at: so.delivered_at, dispute: so.dispute_status, seller: so.seller && so.seller.username }; }) : undefined };
  };
  return {
    kb: all[0] || [],
    settings: g.settings,
    user: {
      username: g.account && g.account.profile && g.account.profile.username, display_name: g.account && g.account.profile && g.account.profile.display_name,
      orders: orders.map(pickOrder),
      offers: (all[2] || []).slice(0, 6).map(function (o) { return { id: o.id, status: o.status, amount: o.amount_cents != null ? Y(o.amount_cents) : undefined, product: o.product && o.product.title, expires_at: o.expires_at }; }),
      auctions_bidding: (all[3] || []).slice(0, 6).map(function (a) { return { id: a.id, title: a.title, status: a.status, phase: a.phase, price: Y(a.current_price_cents || a.start_price_cents || 0), won: a.viewer && a.viewer.won }; }),
      auctions_selling: (all[4] || []).slice(0, 6).map(function (a) { return { id: a.id, title: a.title, status: a.status, round: a.round }; }),
      sales: (all[5] || []).slice(0, 6).map(function (s) { return { id: s.id, order_number: s.order_number, status: s.status, ship_by: s.ship_by, buyer: s.buyer && s.buyer.username }; })
    }
  };
}

/* ---------- Interfaz del cliente ---------- */
var MX_SUPPORT_CHIPS = ["¿Dónde está mi pedido?", "¿Cómo funcionan las subastas?", "Tengo un problema con un pedido", "¿Cómo vendo algo?", "¿Cuánto cobran de comisión?"];

function MxSupportPage() {
  var g = G(), api = g.api, backend = g.backend, session = g.session, toast = Se();
  var t = MXR.useState(null), err = MXR.useState(null), text = MXR.useState(""), busy = MXR.useState(false);
  var endRef = MXR.useRef(null), boxRef = MXR.useRef(null);
  var load = MXR.useCallback(function () {
    return api.call("support_current").then(function (x) { t[1](x); err[1](null); }).catch(function (e) { err[1](e); });
  }, [api]);
  MXR.useEffect(function () { if (session) load(); }, [session && session.user && session.user.id]);
  MXR.useEffect(function () {
    if (!session) return;
    var iv = setInterval(function () { if (document.visibilityState !== "hidden" && !busy[0]) load(); }, 8000);
    return function () { clearInterval(iv); };
  }, [load, busy[0], session]);
  MXR.useEffect(function () { if (endRef.current) endRef.current.scrollIntoView({ behavior: "smooth", block: "end" }); }, [t[0] && t[0].messages.length, busy[0]]);
  if (!session) return mxh(ga, { next: "/ayuda" });
  if (err[0] && !t[0]) return mxh(ne, null, mxh(oe, { error: err[0], onRetry: load }));
  if (!t[0]) return mxh(ne, null, mxh(Ee, null));
  var ticket = t[0];
  var send = async function (body) {
    body = String(body || "").trim();
    if (!body || busy[0]) return;
    busy[1](true); text[1]("");
    try {
      var after = await api.call("support_send", { p_ticket_id: ticket.id, p_body: body });
      t[1](after);
      if (after.status === "needs_human") { busy[1](false); return; }
      var ctx = await mxSupportContext(api, g);
      ctx.history = after.messages;
      ctx.lang_name = { es: "español", en: "inglés (English)", fr: "francés (français)", zh: "chino simplificado (中文)" }[(document.documentElement.lang || "es").slice(0, 2)] || "español";
      var ans = await mxSupportAsk(backend, ctx);
      var done = await api.call("support_ai_reply", { p_ticket_id: ticket.id, p_body: ans.reply, p_meta: ans });
      t[1](done);
    } catch (e) { toast(e.message || r("No se pudo enviar. Inténtalo de nuevo."), "bad"); text[1](body); }
    finally { busy[1](false); }
  };
  var escalate = function () {
    api.call("support_escalate", { p_ticket_id: ticket.id, p_reason: r("La persona pidió hablar con el equipo.") }).then(function (x) { t[1](x); toast(r("Listo: el equipo te responderá aquí."), "ok"); }).catch(function (e) { toast(e.message, "bad"); });
  };
  var feedback = function (m, ok) {
    api.call("support_feedback", { p_message_id: m.id, p_helpful: ok }).then(function (x) {
      t[1](x);
      if (!ok) toast(r("Gracias. Si quieres, toca «Hablar con una persona»."), "ok");
    }).catch(function () {});
  };
  var fresh = function () { api.call("support_new").then(function (x) { t[1](x); }).catch(function (e) { toast(e.message, "bad"); }); };
  var statusNote = ticket.status === "needs_human" ? r("Tu caso está con el equipo. Te responderán aquí y te llegará una notificación.") :
    ticket.status === "answered" ? r("El equipo te respondió. ¿Algo más?") : null;
  return mxh(ne, { narrow: true }, mxh("div", { className: "mx-sup" },
    mxh("header", { className: "mx-sup-head" },
      mxh("span", { className: "mx-sup-avatar" }, mxh(I, { name: "sparkle", size: 20 })),
      mxh("div", { className: "stack grow", style: { gap: 2 } },
        mxh("b", null, r("Soporte MARKETXONE")),
        mxh("span", { className: "tiny dim" }, r("Asistente con IA · equipo humano cuando lo necesites"))),
      ticket.messages.length ? mxh(U, { variant: "ghost", size: "sm", type: "button", onClick: fresh }, r("Nueva")) : null),
    mxh("div", { className: "mx-sup-log", ref: boxRef, "aria-live": "polite" },
      mxh("div", { className: "mx-msg ai first" },
        mxh("p", null, r("¡Hola{0}! Soy el asistente de MARKETXONE. Puedo revisar tus pedidos, ofertas y subastas y explicarte cualquier cosa de la app.", [g.account && g.account.profile && g.account.profile.display_name ? ", " + g.account.profile.display_name.split(" ")[0] : ""])),
        mxh("span", { className: "tiny dim" }, r("Soy una IA y puedo equivocarme. Las decisiones sobre dinero (reembolsos y disputas) las toma el equipo. Guardamos esta conversación para resolver tu caso y mejorar las respuestas. Nunca te pediremos contraseñas ni números de tarjeta."))),
      ticket.messages.map(function (m) {
        var acts = m.meta && Array.isArray(m.meta.actions) ? m.meta.actions : [];
        return mxh("div", { key: m.id, className: "mx-msg " + m.role },
          m.role === "agent" ? mxh("span", { className: "mx-msg-who" }, r("Equipo MARKETXONE")) : null,
          mxh("p", null, m.body),
          acts.length ? mxh("div", { className: "mx-msg-acts" }, acts.map(function (a, i) { return mxh(O, { key: i, to: a.path, className: "btn btn-outline btn-sm" }, a.label); })) : null,
          m.role === "ai" ? mxh("div", { className: "mx-msg-fb" },
            m.helpful == null ? mxh(MXR.Fragment, null,
              mxh("span", { className: "tiny dim" }, r("¿Te sirvió?")),
              mxh("button", { type: "button", className: "mx-fb", onClick: function () { feedback(m, true); } }, r("Sí")),
              mxh("button", { type: "button", className: "mx-fb", onClick: function () { feedback(m, false); } }, r("No"))) :
              mxh("span", { className: "tiny dim" }, m.helpful ? r("Gracias por tu respuesta") : r("Gracias: lo revisará el equipo"))) : null);
      }),
      busy[0] ? mxh("div", { className: "mx-msg ai typing" }, mxh("i", null), mxh("i", null), mxh("i", null)) : null,
      statusNote ? mxh("div", { className: "mx-sup-note" }, mxh(I, { name: "shield", size: 16 }), statusNote) : null,
      mxh("div", { ref: endRef })),
    !ticket.messages.length ? mxh("div", { className: "mx-sup-chips" }, MX_SUPPORT_CHIPS.map(function (c) { return mxh("button", { key: c, type: "button", className: "mx-chip", onClick: function () { send(r(c)); } }, r(c)); })) : null,
    mxh("form", { className: "mx-sup-input", onSubmit: function (e) { e.preventDefault(); send(text[0]); } },
      mxh("textarea", { className: "input", rows: 1, value: text[0], maxLength: 2000, placeholder: r("Escribe tu pregunta…"), "aria-label": r("Mensaje"),
        onChange: function (e) { text[1](e.target.value); }, onKeyDown: function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text[0]); } } }),
      mxh(U, { variant: "primary", type: "submit", loading: busy[0], disabled: !text[0].trim(), "aria-label": r("Enviar") }, r("Enviar"))),
    ticket.status !== "needs_human" ? mxh("button", { type: "button", className: "link small mx-sup-human", onClick: escalate }, r("Hablar con una persona")) : null));
}

function MxGlobal() {
  var path = _a().path;
  MXR.useEffect(function () {
    var m = document.querySelector("main.page");
    if (!m) return;
    m.classList.remove("mx-enter"); void m.offsetWidth; m.classList.add("mx-enter");
  }, [path]);
  return mxh(MxFxWatcher, null);
}

/* ---------- Bandeja del equipo ---------- */
function MxAdminSupport() {
  var g = G(), api = g.api, toast = Se();
  var tab = MXR.useState("needs_human"), sel = MXR.useState(null);
  if (!g.session) return mxh(ga, { next: "/admin/soporte" });
  if (g.account && !g.account.is_admin) return mxh(ne, null, mxh($e, { icon: "shield", title: r("Solo para el equipo") }, r("Esta sección requiere permisos de administración.")));
  return mxh(ne, null, mxh("div", { className: "stack-lg" },
    mxh("div", { className: "stack", style: { gap: 4 } },
      mxh(O, { to: "/admin", className: "link small row-nw", style: { gap: 4 } }, mxh(I, { name: "back", size: 16 }), r("Administración")),
      mxh("h1", { className: "h1" }, r("Soporte al cliente")),
      mxh("span", { className: "small muted" }, r("Contesta lo que la IA no pudo resolver. Si marcas «Enseñar a la IA», la respuesta se guarda y el asistente la usará con los siguientes clientes."))),
    mxh(ko, { value: tab[0], onChange: function (v) { tab[1](v); sel[1](null); }, items: [
      { id: "needs_human", label: r("Necesitan persona") }, { id: "unhelpful", label: r("Respuestas que no sirvieron") }, { id: "all", label: r("Todas") }, { id: "kb", label: r("Lo que sabe la IA") }] }),
    tab[0] === "kb" ? mxh(MxKbEditor, null) : sel[0] ? mxh(MxAdminTicket, { id: sel[0], onBack: function () { sel[1](null); } }) : mxh(MxAdminQueue, { status: tab[0], onOpen: sel[1], key: tab[0] })));
}

function MxAdminQueue(props) {
  var api = G().api;
  var q = ge("support:queue:" + props.status, function () { return api.call("admin_support_queue", { p_status: props.status }); }, { staleMs: 3000 });
  MXR.useEffect(function () { var t = setInterval(q.reload, 8000); return function () { clearInterval(t); }; }, [q.reload]);
  if (q.loading) return mxh(Ee, null);
  if (q.error) return mxh(oe, { error: q.error, onRetry: q.reload });
  if (!q.data || !q.data.length) return mxh($e, { icon: "check", title: props.status === "needs_human" ? r("Nadie está esperando") : r("Sin conversaciones") }, r("La IA está resolviendo todo por ahora."));
  return mxh("div", { className: "stack" }, q.data.map(function (t) {
    return mxh("button", { key: t.id, type: "button", className: "offer-card mx-q", onClick: function () { props.onOpen(t.id); } },
      mxh("div", { className: "stack", style: { gap: 4, minWidth: 0, textAlign: "left" } },
        mxh("div", { className: "row between" }, mxh("b", { className: "clamp-1" }, t.subject || r("(sin asunto)")), mxh(J, { kind: t.status === "needs_human" ? "warn" : t.status === "resolved" ? "outline" : "ok" }, mxSupportStatus(t.status))),
        mxh("span", { className: "small dim" }, "@" + (t.user && t.user.username || "?") + " · " + mxAgo(t.updated_at, Date.now()) + (t.topic ? " · " + t.topic : "") + (t.unhelpful ? " · " + r("{0} sin servir", [t.unhelpful]) : "")),
        t.escalated_reason ? mxh("span", { className: "small" }, t.escalated_reason) : null,
        t.last ? mxh("span", { className: "small muted clamp-2" }, (t.last.role === "user" ? "👤 " : t.last.role === "agent" ? "🧑‍💼 " : "✦ ") + t.last.body) : null));
  }));
}
function mxSupportStatus(s) { return { open: r("Abierta"), needs_human: r("Necesita persona"), answered: r("Respondida"), resolved: r("Cerrada") }[s] || s; }

function MxAdminTicket(props) {
  var api = G().api, toast = Se();
  var q = ge("support:ticket:" + props.id, function () { return api.call("admin_support_ticket", { p_ticket_id: props.id }); }, { staleMs: 2000 });
  var body = MXR.useState(""), save = MXR.useState(true), question = MXR.useState(null), pending = MXR.useState(false);
  if (q.loading) return mxh(Ee, null);
  if (q.error) return mxh(oe, { error: q.error, onRetry: q.reload });
  var t = q.data, qv = question[0] == null ? (t.subject || "") : question[0];
  var reply = function (e) {
    e.preventDefault(); pending[1](true);
    api.call("admin_support_reply", { p_ticket_id: t.id, p_body: body[0], p_save_kb: save[0], p_question: qv }).then(function () {
      toast(save[0] ? r("Respuesta enviada y guardada para la IA") : r("Respuesta enviada"), "ok"); body[1](""); st("support:"); q.reload();
    }).catch(function (x) { toast(x.message, "bad"); }).finally(function () { pending[1](false); });
  };
  return mxh("div", { className: "stack-lg" },
    mxh("button", { type: "button", className: "link small row-nw", onClick: props.onBack, style: { gap: 4 } }, mxh(I, { name: "back", size: 16 }), r("Volver a la bandeja")),
    mxh("div", { className: "row between" }, mxh("div", { className: "stack", style: { gap: 2 } }, mxh("b", null, t.subject || r("(sin asunto)")), mxh("span", { className: "small dim" }, "@" + (t.user && t.user.username))),
      mxh(J, { kind: t.status === "needs_human" ? "warn" : "outline" }, mxSupportStatus(t.status))),
    t.escalated_reason ? mxh(ce, { kind: "warn" }, t.escalated_reason) : null,
    mxh("div", { className: "mx-sup-log admin" }, t.messages.map(function (m) {
      return mxh("div", { key: m.id, className: "mx-msg " + m.role },
        mxh("span", { className: "mx-msg-who" }, m.role === "user" ? r("Cliente") : m.role === "agent" ? r("Equipo") : r("IA") + (m.meta && m.meta.confidence ? " · " + m.meta.confidence : "")),
        mxh("p", null, m.body),
        m.helpful === false ? mxh(J, { kind: "bad" }, r("No le sirvió")) : m.helpful ? mxh(J, { kind: "ok" }, r("Le sirvió")) : null);
    })),
    mxh("form", { className: "panel stack", onSubmit: reply },
      mxh(j, { label: r("Tu respuesta al cliente") }, mxh(Ta, { value: body[0], rows: 4, maxLength: 3000, onChange: function (e) { body[1](e.target.value); } })),
      mxh("label", { className: "row-nw", style: { gap: 10 } }, mxh("input", { type: "checkbox", checked: save[0], onChange: function (e) { save[1](e.target.checked); }, style: { width: 20, height: 20 } }),
        mxh("span", null, mxh("b", null, r("Enseñar a la IA")), " ", mxh("span", { className: "small muted" }, r("Guarda esta respuesta para que la IA conteste sola la próxima vez.")))),
      save[0] ? mxh(j, { label: r("Pregunta que resuelve"), hint: r("Escríbela general, sin datos personales.") }, mxh(ae, { value: qv, maxLength: 300, onChange: function (e) { question[1](e.target.value); } })) : null,
      mxh("div", { className: "row", style: { gap: 8 } },
        mxh(U, { variant: "primary", type: "submit", loading: pending[0], disabled: body[0].trim().length < 2 }, r("Enviar respuesta")),
        t.status !== "resolved" ? mxh(U, { variant: "ghost", type: "button", onClick: function () { api.call("admin_support_close", { p_ticket_id: t.id }).then(function () { st("support:"); q.reload(); }); } }, r("Cerrar caso")) : null)));
}

function MxKbEditor() {
  var api = G().api, toast = Se();
  var q = ge("support:kb", function () { return api.call("admin_kb_list"); }, { staleMs: 3000 });
  var edit = MXR.useState(null);
  var saveIt = function (e) {
    e.preventDefault();
    api.call("admin_kb_save", { p: edit[0] }).then(function () { toast(r("Guardado. La IA ya lo sabe."), "ok"); edit[1](null); q.reload(); }).catch(function (x) { toast(x.message, "bad"); });
  };
  if (q.loading) return mxh(Ee, null);
  if (q.error) return mxh(oe, { error: q.error, onRetry: q.reload });
  return mxh("div", { className: "stack-lg" },
    mxh("span", { className: "small muted" }, r("Además de esto, la IA conoce las reglas de la app (pagos, ofertas, subastas, envíos, disputas, comisión) y los pedidos de cada cliente.")),
    edit[0] ? mxh("form", { className: "panel stack", onSubmit: saveIt },
      mxh(j, { label: r("Pregunta") }, mxh(ae, { value: edit[0].question, maxLength: 300, onChange: function (e) { edit[1](Object.assign({}, edit[0], { question: e.target.value })); } })),
      mxh(j, { label: r("Respuesta") }, mxh(Ta, { value: edit[0].answer, rows: 4, maxLength: 3000, onChange: function (e) { edit[1](Object.assign({}, edit[0], { answer: e.target.value })); } })),
      mxh("label", { className: "row-nw", style: { gap: 10 } }, mxh("input", { type: "checkbox", checked: edit[0].active !== false, onChange: function (e) { edit[1](Object.assign({}, edit[0], { active: e.target.checked })); }, style: { width: 20, height: 20 } }), r("Activa")),
      mxh("div", { className: "row", style: { gap: 8 } }, mxh(U, { variant: "primary", type: "submit" }, r("Guardar")), mxh(U, { variant: "ghost", type: "button", onClick: function () { edit[1](null); } }, r("Cancelar")))) :
      mxh(U, { variant: "outline", icon: "plus", type: "button", onClick: function () { edit[1]({ question: "", answer: "", active: true }); } }, r("Agregar respuesta")),
    (q.data || []).length ? mxh("div", { className: "stack" }, q.data.map(function (k) {
      return mxh("div", { key: k.id, className: "panel stack", style: { gap: 6 } },
        mxh("div", { className: "row between" }, mxh("b", null, k.question), mxh(J, { kind: k.active ? "ok" : "outline" }, k.active ? r("Activa") : r("Pausada"))),
        mxh("span", { className: "small muted" }, k.answer),
        mxh("div", { className: "row between" }, mxh("span", { className: "tiny dim" }, r("Usada {0} veces", [k.uses])),
          mxh("div", { className: "row", style: { gap: 6 } },
            mxh(U, { variant: "ghost", size: "sm", type: "button", onClick: function () { edit[1]({ id: k.id, question: k.question, answer: k.answer, active: k.active }); } }, r("Editar")),
            mxh(pa, { confirmLabel: r("Borrar"), onConfirm: function () { api.call("admin_kb_delete", { p_id: k.id }).then(q.reload); } }, r("Borrar")))));
    })) : mxh($e, { icon: "sparkle", title: r("Todavía no hay respuestas aprendidas") }, r("Cuando contestes en la bandeja con «Enseñar a la IA», aparecerán aquí.")));
}

export { MxSupportPage, MxAdminSupport, MxGlobal };
