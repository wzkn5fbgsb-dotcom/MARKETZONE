// Servicio al cliente en el motor de demostración (mismas reglas que la migración 1400 del servidor).
import { ApiError } from "../api/backend";
import { uuid as fe } from "../api/demo/db";

function T(code, message, detail) { throw new ApiError(code, message, detail ?? null, 400); }


/* ---------- Motor demo (mismo comportamiento que la parte 8 del SQL) ---------- */
function __mxSupportRedact(t) { return String(t || "").replace(/(\d[ -]?){12,18}\d/g, "[número oculto]"); }
function __mxSupportInstall(E) {
  var h = E.handlers, d = function () {
    var db = E.db;
    if (!db.support_tickets) db.support_tickets = [];
    if (!db.support_messages) db.support_messages = [];
    if (!db.support_kb) db.support_kb = [];
    return db;
  };
  var json = function (t) {
    return { id: t.id, status: t.status, subject: t.subject, topic: t.topic, escalated_reason: t.escalated_reason, created_at: t.created_at, updated_at: t.updated_at,
      messages: d().support_messages.filter(function (m) { return m.ticket_id === t.id; }).sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; })
        .map(function (m) { return { id: m.id, role: m.role, body: m.body, meta: m.meta || {}, helpful: m.helpful == null ? null : m.helpful, created_at: m.created_at }; }) };
  };
  var own = function (id, uid) {
    var t = d().support_tickets.filter(function (x) { return x.id === id; })[0];
    if (!t || (t.user_id !== uid && !E.isAdmin(uid))) T("not_found", "No encontramos esta conversación.");
    return t;
  };
  var admins = function () { return E.db.profiles.filter(function (p) { return p.role === "admin" && p.status === "active"; }); };
  var limit = {};
  h.support_current = function (n, uid) {
    var u = E.requireUser(uid);
    var t = d().support_tickets.filter(function (x) { return x.user_id === u && x.status !== "resolved"; }).sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; })[0];
    if (!t) { t = { id: fe(), user_id: u, status: "open", subject: null, topic: null, escalated_reason: null, created_at: E.iso(), updated_at: E.iso() }; d().support_tickets.push(t); }
    return json(t);
  };
  h.support_new = function (n, uid) {
    var u = E.requireUser(uid);
    d().support_tickets.forEach(function (x) { if (x.user_id === u && (x.status === "open" || x.status === "answered")) { x.status = "resolved"; x.updated_at = E.iso(); } });
    var t = { id: fe(), user_id: u, status: "open", subject: null, topic: null, escalated_reason: null, created_at: E.iso(), updated_at: E.iso() };
    d().support_tickets.push(t);
    return json(t);
  };
  h.support_send = function (n, uid) {
    var u = E.requireUser(uid), t = own(n.p_ticket_id, u), body = String(n.p_body || "").trim();
    if (t.user_id !== u) T("forbidden", "Solo la persona de la conversación puede escribir aquí.");
    if (body.length < 1 || body.length > 2000) T("validation", "Escribe tu mensaje (hasta 2000 caracteres).", { field: "body" });
    var now = Date.now(), l = limit[u] = (limit[u] || []).filter(function (x) { return now - x < 600000; });
    if (l.length >= 40) T("rate_limited", "Has hecho demasiadas solicitudes seguidas. Espera unos minutos e inténtalo de nuevo.");
    l.push(now);
    body = __mxSupportRedact(body);
    d().support_messages.push({ id: fe(), ticket_id: t.id, role: "user", body: body, meta: {}, helpful: null, author_id: u, created_at: E.iso() });
    if (!t.subject) t.subject = body.slice(0, 140);
    if (t.status === "resolved") t.status = "open";
    t.updated_at = E.iso();
    return json(t);
  };
  h.support_ai_reply = function (n, uid) {
    var u = E.requireUser(uid), t = own(n.p_ticket_id, u), meta = n.p_meta || {};
    if (t.user_id !== u) T("forbidden", "No puedes responder en esta conversación.");
    if (!String(n.p_body || "").trim()) T("validation", "Respuesta vacía.");
    var esc = !!meta.escalate, reason = String(meta.escalate_reason || "").trim().slice(0, 500) || null;
    d().support_messages.push({ id: fe(), ticket_id: t.id, role: "ai", body: __mxSupportRedact(n.p_body).slice(0, 4000),
      meta: { escalate: esc, confidence: meta.confidence, topic: meta.topic, actions: Array.isArray(meta.actions) ? meta.actions : undefined, kb_ids: Array.isArray(meta.kb_ids) ? meta.kb_ids : undefined }, helpful: null, created_at: E.iso() });
    if (Array.isArray(meta.kb_ids)) d().support_kb.forEach(function (k) { if (meta.kb_ids.indexOf(k.id) >= 0) k.uses++; });
    var was = t.status;
    if (meta.topic) t.topic = String(meta.topic).slice(0, 30);
    if (esc) { t.status = "needs_human"; t.escalated_reason = reason || "La IA pidió ayuda humana."; }
    t.updated_at = E.iso();
    if (esc && was !== "needs_human") admins().forEach(function (a) { E.notify(a.id, "support_needs_human", "Soporte: un cliente necesita ayuda", reason || t.subject, "/admin/soporte"); });
    return json(t);
  };
  h.support_escalate = function (n, uid) {
    var u = E.requireUser(uid), t = own(n.p_ticket_id, u), was = t.status;
    if (t.user_id !== u) T("forbidden", "No puedes cambiar esta conversación.");
    t.status = "needs_human"; t.escalated_reason = String(n.p_reason || "").trim().slice(0, 500) || "La persona pidió hablar con el equipo."; t.updated_at = E.iso();
    if (was !== "needs_human") admins().forEach(function (a) { E.notify(a.id, "support_needs_human", "Soporte: un cliente pidió hablar con alguien", n.p_reason || t.subject, "/admin/soporte"); });
    return json(t);
  };
  h.support_feedback = function (n, uid) {
    var u = E.requireUser(uid), m = d().support_messages.filter(function (x) { return x.id === n.p_message_id; })[0];
    if (!m || m.role !== "ai") T("not_found", "No encontramos ese mensaje.");
    var t = own(m.ticket_id, u);
    if (t.user_id !== u) T("forbidden", "No puedes calificar este mensaje.");
    m.helpful = !!n.p_helpful;
    return json(t);
  };
  h.support_kb = function () {
    return d().support_kb.filter(function (k) { return k.active; }).sort(function (a, b) { return b.uses - a.uses || (a.updated_at < b.updated_at ? 1 : -1); })
      .slice(0, 200).map(function (k) { return { id: k.id, question: k.question, answer: k.answer }; });
  };
  h.admin_support_queue = function (n, uid) {
    E.requireAdmin(uid);
    var st = n.p_status == null ? "needs_human" : n.p_status;
    var msgs = d().support_messages;
    return d().support_tickets.filter(function (t) {
      var ms = msgs.filter(function (m) { return m.ticket_id === t.id; });
      if (!ms.length) return false;
      if (!st || st === "all") return true;
      if (st === "unhelpful") return ms.some(function (m) { return m.helpful === false; });
      return t.status === st;
    }).sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; }).slice(0, 200).map(function (t) {
      var ms = msgs.filter(function (m) { return m.ticket_id === t.id; }).sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; });
      var p = E.profile(t.user_id) || {}, last = ms[ms.length - 1];
      return { id: t.id, status: t.status, subject: t.subject, topic: t.topic, escalated_reason: t.escalated_reason, updated_at: t.updated_at, created_at: t.created_at,
        user: { id: p.id, username: p.username, display_name: p.display_name }, messages_count: ms.length,
        unhelpful: ms.filter(function (m) { return m.helpful === false; }).length, last: last ? { role: last.role, body: last.body.slice(0, 200) } : null };
    });
  };
  h.admin_support_ticket = function (n, uid) {
    E.requireAdmin(uid);
    var t = d().support_tickets.filter(function (x) { return x.id === n.p_ticket_id; })[0];
    if (!t) T("not_found", "No encontramos esta conversación.");
    var p = E.profile(t.user_id) || {};
    return Object.assign(json(t), { user: { id: p.id, username: p.username, display_name: p.display_name, created_at: p.created_at } });
  };
  h.admin_support_reply = function (n, uid) {
    var a = E.requireAdmin(uid), t = d().support_tickets.filter(function (x) { return x.id === n.p_ticket_id; })[0], body = String(n.p_body || "").trim();
    if (!t) T("not_found", "No encontramos esta conversación.");
    if (body.length < 2 || body.length > 3000) T("validation", "Escribe la respuesta (2 a 3000 caracteres).", { field: "body" });
    var q = String(n.p_question || t.subject || "").trim().slice(0, 300);
    if (n.p_save_kb && q.length < 5) T("validation", "Escribe la pregunta que resuelve esta respuesta (mínimo 5 caracteres).", { field: "question" });
    d().support_messages.push({ id: fe(), ticket_id: t.id, role: "agent", body: body, meta: {}, helpful: null, author_id: a, created_at: E.iso() });
    t.status = "answered"; t.updated_at = E.iso();
    E.notify(t.user_id, "support_reply", "El equipo de soporte te respondió", body.slice(0, 140), "/ayuda");
    if (n.p_save_kb) d().support_kb.push({ id: fe(), question: q, answer: body, active: true, uses: 0, created_by: a, created_at: E.iso(), updated_at: E.iso() });
    return h.admin_support_ticket({ p_ticket_id: t.id }, uid);
  };
  h.admin_support_close = function (n, uid) {
    E.requireAdmin(uid);
    var t = d().support_tickets.filter(function (x) { return x.id === n.p_ticket_id; })[0];
    if (!t) T("not_found", "No encontramos esta conversación.");
    t.status = "resolved"; t.updated_at = E.iso();
    return h.admin_support_ticket(n, uid);
  };
  h.admin_kb_list = function (n, uid) {
    E.requireAdmin(uid);
    return d().support_kb.slice().sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; })
      .map(function (k) { return { id: k.id, question: k.question, answer: k.answer, active: k.active, uses: k.uses, updated_at: k.updated_at }; });
  };
  h.admin_kb_save = function (n, uid) {
    var a = E.requireAdmin(uid), p = n.p || {}, q = String(p.question || "").trim(), ans = String(p.answer || "").trim();
    if (q.length < 5 || q.length > 300) T("validation", "La pregunta debe tener de 5 a 300 caracteres.", { field: "question" });
    if (ans.length < 5 || ans.length > 3000) T("validation", "La respuesta debe tener de 5 a 3000 caracteres.", { field: "answer" });
    if (p.id) {
      var k = d().support_kb.filter(function (x) { return x.id === p.id; })[0];
      if (!k) T("not_found", "No encontramos esa respuesta.");
      k.question = q; k.answer = ans; k.active = p.active !== false; k.updated_at = E.iso();
    } else d().support_kb.push({ id: fe(), question: q, answer: ans, active: p.active !== false, uses: 0, created_by: a, created_at: E.iso(), updated_at: E.iso() });
    return h.admin_kb_list(n, uid);
  };
  h.admin_kb_delete = function (n, uid) {
    E.requireAdmin(uid);
    E.db.support_kb = d().support_kb.filter(function (x) { return x.id !== n.p_id; });
    return h.admin_kb_list(n, uid);
  };
}


export { __mxSupportInstall };
