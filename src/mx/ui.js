// Subastas en vivo: lista, sala con pujas, crear subasta (con IA), mis subastas e inicio.
import { MXR, mxh, G, r, U, J, I, O, ne, $e, ce, Ee, oe, ga, ko, Ia, na, qt, pa, j, ae, Ta, Te, Zl, Y, ja, wt, lt, Gt, Se, ge, st, Ce, _a, St,
  Ka, Vl, kt, Hl, Us, vp } from "./compat.js";
import { MX_CONDITIONS, MX_DURATIONS } from "./engine.js";
import { MX_MEASURE_HINTS, mxAnalyzeAuction } from "./ai.js";
import { mxShare } from "./fx.js";
import { MxSupportPage, MxAdminSupport } from "./support.js";

function mxUseNow(ms) {
  var s = MXR.useState(Date.now());
  MXR.useEffect(function () {
    var t = setInterval(function () { s[1](Date.now()); }, ms || 250);
    return function () { clearInterval(t); };
  }, [ms]);
  return s[0];
}

function mxClock(ms) {
  if (ms <= 0) return "0:00";
  var s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  if (h >= 24) return r("{0} d {1} h", [Math.floor(h / 24), h % 24]);
  if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(x).padStart(2, "0");
  return m + ":" + String(x).padStart(2, "0");
}

function mxDollars(c) { return Y(c); }

function mxAgo(iso, now) {
  var s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return r("hace {0} s", [s]);
  if (s < 3600) return r("hace {0} min", [Math.floor(s / 60)]);
  return ja(iso);
}

function MxLiveDot(props) {
  return mxh("span", { className: "mx-live" + (props && props.small ? " sm" : "") }, mxh("i", null), r("EN VIVO"));
}

function MxPhaseBadge(props) {
  var a = props.a, now = props.now, offset = props.offset || 0, t = now + offset;
  if (a.phase === "live") return mxh(MxLiveDot, null);
  if (a.phase === "upcoming") return mxh(J, { kind: "info" }, r("Empieza en {0}", [mxClock(Date.parse(a.starts_at) - t)]));
  if (a.phase === "closing") return mxh(J, { kind: "warn" }, r("Cerrando…"));
  if (a.status === "awaiting_seller") return mxh(J, { kind: "warn" }, r("Esperando al vendedor"));
  if (a.status === "sold") return mxh(J, { kind: "ok" }, r("Vendida"));
  if (a.status === "unsold") return mxh(J, { kind: "muted" }, r("Sin pujas"));
  if (a.status === "relisted") return mxh(J, { kind: "muted" }, r("Reenlistada"));
  if (a.status === "cancelled") return mxh(J, { kind: "bad" }, r("Cancelada"));
  return null;
}

function MxPrice(props) {
  var a = props.a, price = a.final_price_cents != null ? a.final_price_cents : a.current_price_cents;
  return mxh("div", { className: "stack", style: { gap: 0 } },
    mxh("span", { className: "tiny dim" }, price != null ? (a.phase === "live" ? r("Puja actual") : r("Precio final")) : r("Precio inicial")),
    mxh("span", { className: "price mx-num", style: { fontSize: props.size || 20 } }, mxDollars(price != null ? price : a.start_price_cents)));
}

function MxCard(props) {
  var a = props.a, now = props.now, end = a.phase === "upcoming" ? null : Date.parse(a.ends_at) - now;
  return mxh(O, { to: "/subasta/" + a.id, className: "mx-card" },
    mxh("div", { className: "mx-card-media" },
      mxh(na, { src: a.image_url, alt: a.title }),
      mxh("div", { className: "mx-card-top" }, mxh(MxPhaseBadge, { a: a, now: now }), a.is_demo ? mxh(J, { kind: "demo" }, r("Ejemplo")) : null),
      a.phase === "live" ? mxh("div", { className: "mx-card-clock" + (end < 30000 ? " hot" : "") }, mxh(I, { name: "clock", size: 14 }), mxClock(end)) : null),
    mxh("div", { className: "mx-card-body" },
      mxh("span", { className: "clamp-2 mx-card-title" }, a.title),
      mxh("div", { className: "row between", style: { alignItems: "flex-end" } },
        mxh(MxPrice, { a: a }),
        mxh("span", { className: "tiny dim" }, a.bid_count === 1 ? r("1 puja") : r("{0} pujas", [a.bid_count])))));
}

function MxRules(props) {
  var s = props.s || {};
  var ship = s.shipping_cents != null ? mxDollars(s.shipping_cents) : "$7.99";
  return mxh("details", { className: "panel mx-rules", open: !!props.open },
    mxh("summary", null, mxh(I, { name: "shield", size: 18 }), mxh("b", null, r("Cómo funcionan las subastas"))),
    mxh("ol", { className: "small muted" },
      mxh("li", null, r("Para pujar entras con tu dinero: retenemos el límite que tú eliges más el envío ({0}). Sin dinero retenido no se puede pujar.", [ship])),
      mxh("li", null, r("El precio sube de dólar en dólar. Tus pujas nunca pueden pasar tu límite; puedes subirlo cuando quieras.")),
      mxh("li", null, r("Si alguien puja en los últimos segundos, el reloj se extiende {0} s para que nadie gane de último segundo.", [s.extend_seconds || 15])),
      mxh("li", null, r("Si ganas, se cobra el precio final + envío de lo que ya tenías retenido. Si no ganas, se libera todo al instante.")),
      mxh("li", null, r("El vendedor acepta la venta o la reenlista en {0} min; si no responde, se confirma sola. Puede reenlistar máximo {1} veces: en la última ronda la venta es obligatoria.", [s.decision_minutes || 60, s.max_rounds ? s.max_rounds - 1 : 3])),
      mxh("li", null, r("El vendedor tiene {0} días para enviar con número de guía. Si no envía, se te reembolsa.", [s.ship_days || 3])),
      mxh("li", null, r("Las subastas son de fotos: fotos claras, medidas, estado y detalles. Si algo no coincide, repórtalo desde tu pedido."))));
}

/* ---------------- Lista de subastas ---------------- */
function MxAuctionsPage() {
  var g = G(), api = g.api, route = _a();
  var tabState = MXR.useState(route.query.get("tab") || "live"), tab = tabState[0];
  var q = ge("auctions:" + tab, function () { return api.call("list_auctions", { p: { tab: tab } }); }, { staleMs: 3000 });
  var now = mxUseNow(1000);
  MXR.useEffect(function () {
    var t = setInterval(function () { if (document.visibilityState !== "hidden") q.reload(); }, tab === "ended" ? 15000 : 4000);
    return function () { clearInterval(t); };
  }, [tab, q.reload]);
  var items = q.data || [];
  return mxh(ne, null, mxh("div", { className: "stack-lg" },
    mxh("div", { className: "stack", style: { gap: 12 } },
      mxh("div", { className: "stack", style: { gap: 4 } },
        mxh("h1", { className: "h1" }, r("Subastas")),
        mxh("span", { className: "small muted" }, r("Pujas de $1 en $1. Si ganas, ya está pagado."))),
      mxh("div", { className: "row", style: { gap: 8 } },
        mxh(O, { to: "/subastas/nueva", className: "btn btn-primary btn-sm" }, mxh(I, { name: "plus", size: 16 }), r("Subastar")),
        mxh(O, { to: "/mis-subastas", className: "btn btn-outline btn-sm" }, r("Mis subastas")))),
    mxh(ko, { value: tab, onChange: tabState[1], items: [
      { id: "live", label: r("En vivo") }, { id: "upcoming", label: r("Próximas") }, { id: "ended", label: r("Terminadas") }] }),
    mxh(oe, { error: q.error, onRetry: q.reload }),
    q.loading ? mxh(Ee, null) : items.length ?
      mxh("div", { className: "mx-grid" }, items.map(function (a) { return mxh(MxCard, { key: a.id, a: a, now: now }); })) :
      mxh($e, { icon: "clock", title: tab === "live" ? r("No hay subastas en vivo ahora") : tab === "upcoming" ? r("No hay subastas programadas") : r("Todavía no terminan subastas"),
        action: mxh(O, { to: "/subastas/nueva", className: "btn btn-primary" }, r("Subastar un artículo")) },
        r("Sube una foto y la IA llena el resto.")),
    mxh(MxRules, null)));
}

/* ---------------- Sala de subasta ---------------- */
function mxUseAuction(id) {
  var api = G().api;
  var st = MXR.useState({ data: null, error: null, offset: 0 }), state = st[0], set = st[1];
  var busy = MXR.useRef(false);
  var load = MXR.useCallback(function () {
    if (busy.current) return Promise.resolve();
    busy.current = true;
    var t0 = Date.now();
    return api.call("get_auction", { p_id: id }).then(function (d) {
      var t1 = Date.now();
      set({ data: d, error: null, offset: Date.parse(d.server_now) - (t0 + t1) / 2 });
    }).catch(function (e) {
      set(function (s) { return Object.assign({}, s, { error: e }); });
    }).finally(function () { busy.current = false; });
  }, [api, id]);
  MXR.useEffect(function () { load(); }, [load]);
  var phase = state.data ? (state.data.status === "open" ? state.data.phase : state.data.status) : null;
  MXR.useEffect(function () {
    var ms = phase === "live" || phase === "closing" ? 1500 : phase === "upcoming" ? 3000 : phase === "awaiting_seller" ? 4000 : 15000;
    var t = setInterval(function () { if (document.visibilityState !== "hidden") load(); }, ms);
    return function () { clearInterval(t); };
  }, [load, phase]);
  return {
    data: state.data, error: state.error, offset: state.offset, reload: load,
    set: function (d) { set(function (s) { return Object.assign({}, s, { data: d }); }); }
  };
}

function MxGallery(props) {
  var imgs = props.images.length ? props.images : [{ id: "x", url: null }];
  var idx = MXR.useState(0), zoom = MXR.useState(null), ref = MXR.useRef(null);
  var go = function (i) { idx[1](i); if (ref.current) ref.current.scrollTo({ left: i * ref.current.clientWidth, behavior: "smooth" }); };
  return mxh("div", { className: "stack", style: { gap: 8 } },
    mxh("div", { className: "zone mx-gallery-wrap" },
      mxh("div", { className: "gallery", ref: ref, onScroll: function (e) { idx[1](Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth)); } },
        imgs.map(function (im, i) {
          return mxh("button", { key: im.id, type: "button", className: "mx-shot", onClick: function () { zoom[1](im.url); }, "aria-label": r("Ampliar foto {0}", [i + 1]) },
            mxh(na, { src: im.url, alt: r("{0} · foto {1}", [props.title, i + 1]), loading: i === 0 ? "eager" : "lazy" }));
        })),
      mxh("span", { className: "mx-count" }, r("Foto {0} de {1}", [idx[0] + 1, imgs.length])),
      mxh("span", { className: "mx-zoom-hint" }, mxh(I, { name: "search", size: 14 }), r("Toca para ampliar"))),
    imgs.length > 1 ? mxh("div", { className: "thumbs" }, imgs.map(function (im, i) {
      return mxh("button", { key: im.id, className: i === idx[0] ? "on" : "", onClick: function () { go(i); }, "aria-label": r("Ver foto {0}", [i + 1]) }, mxh(na, { src: im.url, alt: "" }));
    })) : null,
    zoom[0] ? mxh("div", { className: "mx-zoom", onClick: function () { zoom[1](null); }, role: "dialog", "aria-modal": "true" },
      mxh("button", { className: "icon-btn mx-zoom-close", "aria-label": r("Cerrar"), onClick: function () { zoom[1](null); } }, mxh(I, { name: "close" })),
      mxh(na, { src: zoom[0], alt: props.title, loading: "eager" })) : null);
}

function MxJoinSheet(props) {
  var a = props.a, g = G(), api = g.api, toast = Se(), account = g.account;
  var hold = a.viewer.hold, next = a.next_bid_cents;
  var suggested = hold ? Math.max(hold.limit_cents / 100, next / 100) : Math.max(next / 100 + 10, Math.ceil(next * 1.5 / 100));
  var val = MXR.useState(String(suggested)), pending = MXR.useState(false), err = MXR.useState(null);
  var dollars = parseInt(val[0], 10), cents = Number.isFinite(dollars) ? dollars * 100 : null;
  var addr = account && account.addresses ? (account.addresses.find(function (x) { return x.is_default; }) || account.addresses[0]) : null;
  var submit = function (e) {
    e.preventDefault();
    if (!cents || cents < next) { err[1](r("Tu límite debe ser de al menos {0}.", [mxDollars(next)])); return; }
    pending[1](true); err[1](null);
    api.call("join_auction", { p_auction_id: a.id, p_limit_cents: cents, p_address_id: null }).then(function (d) {
      props.onDone(d);
      toast(hold ? r("Límite actualizado") : r("Listo: ya puedes pujar"), "ok");
    }).catch(function (x) { err[1](x.message); }).finally(function () { pending[1](false); });
  };
  if (!addr) return mxh(Ia, { open: true, onClose: props.onClose, title: r("¿A dónde lo enviamos si ganas?") },
    mxh("div", { className: "stack" },
      mxh("span", { className: "small muted" }, r("Antes de entrar con tu dinero, agrega tu dirección de envío. Si ganas, el vendedor la recibe con el pedido.")),
      mxh(Zl, { initial: null, onSaved: function () { if (g.reloadAccount) g.reloadAccount(); }, onCancel: props.onClose })));
  return mxh(Ia, { open: true, onClose: props.onClose, title: hold ? r("Cambiar mi límite") : r("Entrar a la subasta") },
    mxh("form", { className: "stack", onSubmit: submit },
      mxh("span", { className: "small muted" }, r("Para pujar retenemos tu límite más el envío. Solo se cobra si ganas, y solo el precio final + envío. Lo demás se libera al terminar.")),
      mxh(j, { label: r("Tu límite máximo de puja"), hint: r("En dólares enteros. Mínimo {0}.", [mxDollars(next)]) },
        mxh("div", { className: "input-group" }, mxh("span", { className: "addon" }, "$"),
          mxh("input", { className: "input num", inputMode: "numeric", pattern: "[0-9]*", value: val[0], autoFocus: true,
            onChange: function (e) { val[1](e.target.value.replace(/[^0-9]/g, "").slice(0, 6)); }, "aria-label": r("Tu límite máximo de puja") }))),
      mxh("div", { className: "row", style: { gap: 6 } }, [10, 25, 50, 100].map(function (plus) {
        var v = Math.ceil(next / 100) + plus;
        return mxh("button", { key: plus, type: "button", className: "chip", onClick: function () { val[1](String(v)); } }, "$" + v);
      })),
      mxh("div", { className: "panel kv mx-sum" },
        mxh("span", null, r("Límite")), mxh("b", null, cents ? mxDollars(cents) : "—"),
        mxh("span", null, r("Envío")), mxh("b", null, mxDollars(a.shipping_cents)),
        mxh("span", null, r("Retención total")), mxh("b", null, cents ? mxDollars(cents + a.shipping_cents) : "—")),
      addr ? mxh("span", { className: "small dim" }, mxh(I, { name: "truck", size: 14 }), " ", r("Si ganas, se envía a {0}, {1}.", [addr.line1, addr.city])) : null,
      a.test_mode ? mxh(ce, { kind: "info" }, r("Modo de prueba: no se retiene ni se cobra dinero real.")) : null,
      err[0] ? mxh("span", { className: "error-text", role: "alert" }, err[0]) : null,
      mxh(U, { variant: "primary", type: "submit", block: true, loading: pending[0], disabled: !addr },
        hold ? r("Guardar límite") : r("Retener {0} y entrar", [cents ? mxDollars(cents + a.shipping_cents) : ""]))));
}

function MxRelistSheet(props) {
  var a = props.a, api = G().api, toast = Se();
  var price = MXR.useState(String(a.start_price_cents / 100)), dur = MXR.useState(a.duration_minutes), when = MXR.useState(0);
  var pending = MXR.useState(false), err = MXR.useState(null);
  var submit = function (e) {
    e.preventDefault();
    var c = parseInt(price[0], 10) * 100;
    pending[1](true); err[1](null);
    api.call("auction_decide", { p_auction_id: a.id, p_action: "relist", p_start_price_cents: c, p_duration_minutes: dur[0], p_starts_in_minutes: when[0] })
      .then(function (d) { toast(r("Reenlistada"), "ok"); props.onClose(); Ce("/subasta/" + d.id); })
      .catch(function (x) { err[1](x.message); }).finally(function () { pending[1](false); });
  };
  var left = a.relists_left - 1;
  return mxh(Ia, { open: true, onClose: props.onClose, title: r("Reenlistar subasta") },
    mxh("form", { className: "stack", onSubmit: submit },
      a.status === "awaiting_seller" ? mxh(ce, { kind: "warn" }, r("No aceptas el precio final de {0}: se libera el dinero del ganador y el artículo vuelve a subasta.", [mxDollars(a.final_price_cents)])) : null,
      left === 0 ? mxh(ce, { kind: "bad" }, r("Esta será la última ronda: cuando termine, la venta es obligatoria al precio que salga.")) :
        mxh("span", { className: "small muted" }, r("Después de esta te quedarán {0} reenlistados.", [left])),
      mxh(j, { label: r("Precio inicial"), hint: r("Máximo {0}: al reenlistar no se puede subir el precio inicial original.", [mxDollars(a.root_start_price_cents || a.start_price_cents)]) }, mxh("div", { className: "input-group" }, mxh("span", { className: "addon" }, "$"),
        mxh("input", { className: "input num", inputMode: "numeric", value: price[0], onChange: function (e) { price[1](e.target.value.replace(/[^0-9]/g, "").slice(0, 6)); } }))),
      mxh(j, { label: r("Duración") }, mxh(MxSegment, { value: dur[0], onChange: dur[1], items: MX_DURATIONS.map(function (m) { return { id: m, label: r("{0} min", [m]) }; }) })),
      mxh(j, { label: r("Empieza") }, mxh(MxSegment, { value: when[0], onChange: when[1], items: [{ id: 0, label: r("Ahora") }, { id: 15, label: r("En 15 min") }, { id: 60, label: r("En 1 h") }, { id: 1440, label: r("Mañana") }] })),
      err[0] ? mxh("span", { className: "error-text", role: "alert" }, err[0]) : null,
      mxh(U, { variant: "primary", type: "submit", block: true, loading: pending[0] }, r("Reenlistar"))));
}

function MxSegment(props) {
  return mxh("div", { className: "mx-seg", role: "radiogroup" }, props.items.map(function (it) {
    var on = it.id === props.value;
    return mxh("button", { key: String(it.id), type: "button", role: "radio", "aria-checked": on, className: on ? "on" : "", onClick: function () { props.onChange(it.id); } }, it.label);
  }));
}

function MxBidPanel(props) {
  var a = props.a, q = props.q, now = props.now, t = now + q.offset, g = G(), api = g.api, toast = Se();
  var pending = MXR.useState(null), sheet = MXR.useState(null), confirmAccept = MXR.useState(false), busy = MXR.useState(false);
  var v = a.viewer, hold = v.hold, live = a.phase === "live", ends = Date.parse(a.ends_at) - t, starts = Date.parse(a.starts_at) - t;
  var prevPrice = MXR.useRef(a.current_price_cents), flash = MXR.useState(false);
  var panelRef = MXR.useRef(null), dock = MXR.useState(false);
  MXR.useEffect(function () {
    if (!panelRef.current || typeof IntersectionObserver === "undefined") return;
    var io = new IntersectionObserver(function (es) { dock[1](!es[0].isIntersecting); }, { threshold: 0.15 });
    io.observe(panelRef.current);
    return function () { io.disconnect(); };
  }, []);
  MXR.useEffect(function () {
    if (a.current_price_cents !== prevPrice.current) {
      prevPrice.current = a.current_price_cents; flash[1](true);
      var tm = setTimeout(function () { flash[1](false); }, 700);
      return function () { clearTimeout(tm); };
    }
  }, [a.current_price_cents]);
  MXR.useEffect(function () {
    if ((a.phase === "live" && ends <= 0) || (a.phase === "upcoming" && starts <= 0)) q.reload();
  }, [a.phase, ends <= 0, starts <= 0]);
  var bid = function (amount) {
    pending[1](amount);
    api.call("place_bid", { p_auction_id: a.id, p_amount_cents: amount }).then(function (d) {
      q.set(d); toast(r("Pujaste {0}", [mxDollars(amount)]), "ok");
      try { navigator.vibrate && navigator.vibrate(15); } catch (e) {}
    }).catch(function (e) { toast(e.message, "bad"); q.reload(); }).finally(function () { pending[1](null); });
  };
  var decide = function (action) {
    busy[1](true);
    api.call("auction_decide", { p_auction_id: a.id, p_action: action }).then(function (d) {
      q.set(d); st("orders", "dashboard"); toast(r("Venta confirmada. Prepara el envío."), "ok");
    }).catch(function (e) { toast(e.message, "bad"); }).finally(function () { busy[1](false); confirmAccept[1](false); });
  };
  var cancel = function () {
    busy[1](true);
    api.call("cancel_auction", { p_id: a.id }).then(function (d) { q.set(d); toast(r("Subasta cancelada"), "ok"); })
      .catch(function (e) { toast(e.message, "bad"); }).finally(function () { busy[1](false); });
  };
  var next = a.next_bid_cents, base = a.current_price_cents != null ? a.current_price_cents : a.start_price_cents - 100;
  var amounts = [next, base + 500, base + 1000].filter(function (x, i, arr) { return x >= next && arr.indexOf(x) === i; });
  var limit = hold && hold.status === "held" ? hold.limit_cents : 0;

  var status = null;
  if (a.status !== "open") status = null;
  else if (v.is_seller) status = mxh("span", { className: "mx-me" }, mxh(I, { name: "store", size: 16 }), r("Es tu subasta"));
  else if (live && v.is_high_bidder) status = mxh("span", { className: "mx-me ok" }, mxh(I, { name: "check", size: 16 }), r("Vas ganando"));
  else if (live && v.has_bid) status = mxh("span", { className: "mx-me bad" }, mxh(I, { name: "alert", size: 16 }), r("Te superaron"));
  else if (hold && hold.status === "held") status = mxh("span", { className: "mx-me" }, mxh(I, { name: "shield", size: 16 }), r("Dentro con {0} retenidos", [mxDollars(hold.held_cents)]));

  var actions;
  if (a.status === "open") {
    if (!v.signed_in) actions = mxh(O, { to: "/entrar?next=" + encodeURIComponent("/subasta/" + a.id), className: "btn btn-primary btn-lg btn-block" }, r("Entra para pujar"));
    else if (v.is_seller) actions = a.bid_count === 0 ? mxh(pa, { confirmLabel: r("Cancelar subasta"), onConfirm: cancel, loading: busy[0] }, r("Cancelar subasta")) :
      mxh("span", { className: "small dim" }, r("Ya hay pujas: no se puede cancelar. Al terminar decides si aceptas o reenlistas."));
    else if (!hold || hold.status !== "held") actions = mxh(U, { variant: "primary", size: "lg", block: true, icon: "shield", onClick: function () { sheet[1]("join"); } }, r("Entrar con mi dinero para pujar"));
    else if (!live) actions = mxh("div", { className: "stack", style: { gap: 8 } },
      mxh(ce, { kind: "ok" }, r("Ya estás dentro. Podrás pujar cuando empiece.")),
      mxh(U, { variant: "ghost", size: "sm", onClick: function () { sheet[1]("join"); } }, r("Cambiar mi límite ({0})", [mxDollars(limit)])));
    else actions = mxh("div", { className: "stack", style: { gap: 8 } },
      mxh("div", { className: "mx-bids" }, amounts.map(function (amt, i) {
        var over = amt > limit, mine = v.is_high_bidder;
        return mxh("button", { key: amt, type: "button", className: "btn " + (i === 0 ? "btn-primary mx-bid-main" : "btn-dark") + (over ? " mx-over" : ""),
          disabled: !!pending[0] || mine || over, onClick: function () { bid(amt); } },
          pending[0] === amt ? mxh("span", { className: "spin", "aria-hidden": true }) : null,
          i === 0 ? r("Pujar {0}", [mxDollars(amt)]) : mxDollars(amt));
      })),
      mxh("div", { className: "row between small" },
        mxh("span", { className: "dim" }, r("Tu límite: {0}", [mxDollars(limit)])),
        mxh("button", { type: "button", className: "link-btn link", onClick: function () { sheet[1]("join"); } }, next > limit ? r("Sube tu límite para seguir") : r("Cambiar límite"))));
  } else if (a.status === "awaiting_seller") {
    var due = Date.parse(a.decision_due_at) - t;
    if (v.is_seller) actions = mxh("div", { className: "stack", style: { gap: 8 } },
      mxh(ce, { kind: "warn" }, r("Terminó en {0}. Acepta la venta o reenlístala. Si no respondes en {1}, la venta se confirma sola.", [mxDollars(a.final_price_cents), mxClock(due)])),
      confirmAccept[0] ? mxh("div", { className: "row" },
        mxh(U, { variant: "primary", loading: busy[0], onClick: function () { decide("accept"); } }, r("Sí, vender en {0}", [mxDollars(a.final_price_cents)])),
        mxh(U, { variant: "ghost", onClick: function () { confirmAccept[1](false); } }, r("No"))) :
      mxh("div", { className: "row" },
        mxh(U, { variant: "primary", icon: "check", onClick: function () { confirmAccept[1](true); } }, r("Aceptar venta")),
        a.relists_left > 0 ? mxh(U, { variant: "outline", icon: "refresh", onClick: function () { sheet[1]("relist"); } }, r("Reenlistar (quedan {0})", [a.relists_left])) : null));
    else if (v.won) actions = mxh(ce, { kind: "ok" }, r("¡Ganaste con {0}! El vendedor tiene {1} para confirmar; si no responde, se confirma sola. Tu dinero sigue retenido.", [mxDollars(a.final_price_cents), mxClock(due)]));
    else actions = mxh("span", { className: "small dim" }, r("Terminó en {0}. Esperando la confirmación del vendedor.", [mxDollars(a.final_price_cents)]));
  } else if (a.status === "sold") {
    if (v.won) actions = mxh("div", { className: "stack", style: { gap: 8 } },
      mxh(ce, { kind: "ok" }, r("Compra confirmada: se cobró {0} + envío de tu dinero retenido. El vendedor tiene {1} días para enviarlo.", [mxDollars(a.final_price_cents), a.ship_days])),
      a.order_id ? mxh(O, { to: "/pedido/" + a.order_id, className: "btn btn-primary btn-block" }, r("Ver mi pedido")) : null);
    else if (v.is_seller) actions = mxh("div", { className: "stack", style: { gap: 8 } },
      mxh(ce, { kind: "ok" }, a.ship_by ? r("Vendida en {0}. Envíala con número de guía antes del {1}; si no, se reembolsa al comprador.", [mxDollars(a.final_price_cents), ja(a.ship_by)]) : r("Vendida en {0}.", [mxDollars(a.final_price_cents)])),
      mxh(O, { to: "/panel/pedidos", className: "btn btn-primary btn-block" }, r("Ir a mis pedidos para enviar")));
    else actions = mxh("span", { className: "small dim" }, r("Vendida en {0}.", [mxDollars(a.final_price_cents)]));
  } else if (a.status === "unsold") {
    actions = v.is_seller ? mxh("div", { className: "stack", style: { gap: 8 } },
      mxh("span", { className: "small muted" }, a.relists_left > 0 ? r("Terminó sin pujas. Puedes reenlistarla (quedan {0}).", [a.relists_left]) : r("Terminó sin pujas y ya no quedan reenlistados.")),
      mxh("div", { className: "row" },
        a.relists_left > 0 ? mxh(U, { variant: "primary", icon: "refresh", onClick: function () { sheet[1]("relist"); } }, r("Reenlistar")) : null,
        mxh(pa, { confirmLabel: r("Quitar"), onConfirm: cancel }, r("Quitar de la lista")))) :
      mxh("span", { className: "small dim" }, r("Terminó sin pujas."));
  } else if (a.status === "relisted") {
    actions = mxh("div", { className: "stack", style: { gap: 8 } },
      mxh("span", { className: "small muted" }, r("El vendedor volvió a subastar este artículo.")),
      a.next_id ? mxh(O, { to: "/subasta/" + a.next_id, className: "btn btn-primary btn-block" }, r("Ir a la nueva subasta")) : null);
  } else actions = mxh("span", { className: "small dim" }, r("Esta subasta fue cancelada."));

  var clock = null;
  if (a.phase === "live") clock = mxh("div", { className: "mx-clock" + (ends < 30000 ? " hot" : "") }, mxh("span", { className: "tiny dim" }, r("Termina en")), mxh("b", { className: "mx-num" }, mxClock(ends)));
  else if (a.phase === "upcoming") clock = mxh("div", { className: "mx-clock" }, mxh("span", { className: "tiny dim" }, r("Empieza en")), mxh("b", { className: "mx-num" }, mxClock(starts)));
  else if (a.phase === "closing") clock = mxh("div", { className: "mx-clock" }, mxh("span", { className: "tiny dim" }, r("Cerrando")), mxh("span", { className: "spin" }));

  var canBid = live && v.signed_in && !v.is_seller && hold && hold.status === "held";
  var dockBar = live && dock[0] ? mxh("div", { className: "mx-dock" },
    mxh("div", { className: "stack", style: { gap: 0, minWidth: 0 } },
      mxh("b", { className: "mx-num", style: { fontSize: 20 } }, mxDollars(a.current_price_cents != null ? a.current_price_cents : a.start_price_cents)),
      mxh("span", { className: "tiny mx-num" + (ends < 30000 ? " mx-hot" : " dim") }, r("Termina en") + " " + mxClock(ends))),
    v.is_high_bidder ? mxh("span", { className: "mx-me ok" }, mxh(I, { name: "check", size: 16 }), r("Vas ganando")) :
    canBid ? mxh(U, { variant: "primary", disabled: !!pending[0] || next > limit, loading: pending[0] === next, onClick: function () { bid(next); } },
      next > limit ? r("Límite alcanzado") : r("Pujar {0}", [mxDollars(next)])) :
    mxh(U, { variant: "primary", onClick: function () { if (panelRef.current) panelRef.current.scrollIntoView({ behavior: "smooth", block: "center" }); } }, r("Pujar"))) : null;
  return mxh(MXR.Fragment, null, mxh("div", { ref: panelRef, className: "mx-panel" + (live ? " is-live" : "") },
    mxh("div", { className: "row between", style: { alignItems: "flex-end" } },
      mxh("div", { className: "stack", style: { gap: 0 } },
        mxh("span", { className: "tiny dim" }, a.current_price_cents != null || a.final_price_cents != null ? (a.status === "open" ? r("Puja actual") : r("Precio final")) : r("Precio inicial")),
        mxh("span", { className: "mx-big mx-num" + (flash[0] ? " mx-flash" : "") }, mxDollars(a.final_price_cents != null ? a.final_price_cents : a.current_price_cents != null ? a.current_price_cents : a.start_price_cents)),
        mxh("span", { className: "tiny dim" }, (a.bid_count === 1 ? r("1 puja") : r("{0} pujas", [a.bid_count])) + " · " + (a.bidders === 1 ? r("1 persona con dinero retenido") : r("{0} personas con dinero retenido", [a.bidders])))),
      clock),
    status,
    actions),
    dockBar,
    sheet[0] === "join" ? mxh(MxJoinSheet, { a: a, onClose: function () { sheet[1](null); }, onDone: function (d) { q.set(d); sheet[1](null); } }) : null,
    sheet[0] === "relist" ? mxh(MxRelistSheet, { a: a, onClose: function () { sheet[1](null); } }) : null);
}

function MxAuctionRoom(props) {
  var q = mxUseAuction(props.id), now = mxUseNow(250), a = q.data, toast = Se();
  if (!a && q.error) return mxh(ne, null, mxh($e, { icon: "alert", title: r("No encontramos esta subasta"), action: mxh(O, { to: "/subastas", className: "btn btn-primary" }, r("Ver subastas")) }, q.error.message));
  if (!a) return mxh(ne, null, mxh(Ee, null));
  var cond = wt[a.condition];
  return mxh(ne, null, mxh("div", { className: "stack-lg" },
    mxh("div", { className: "row between" },
      mxh(O, { to: "/subastas", className: "link small row-nw", style: { gap: 4 } }, mxh(I, { name: "back", size: 16 }), r("Subastas")),
      mxh(U, { variant: "ghost", size: "sm", icon: "share", type: "button", onClick: function () { mxShare({ title: a.title, text: r("Subasta en vivo: {0}", [a.title]), path: "/subasta/" + a.id, toast: toast }); } }, r("Compartir"))),
    mxh("div", { className: "split" },
      mxh("div", { className: "stack" }, mxh(MxGallery, { images: a.images, title: a.title })),
      mxh("div", { className: "split-side stack-lg" },
        mxh("div", { className: "stack", style: { gap: 8 } },
          mxh("div", { className: "row", style: { gap: 6 } },
            mxh(MxPhaseBadge, { a: a, now: now, offset: q.offset }),
            a.round > 1 ? mxh(J, { kind: "outline" }, r("Ronda {0} de {1}", [a.round, a.max_rounds])) : null,
            a.is_demo ? mxh(J, { kind: "demo" }, r("Subasta de ejemplo")) : null),
          a.brand ? mxh("span", { className: "eyebrow" }, a.brand) : null,
          mxh("h1", { className: "h1", style: { fontSize: "clamp(22px, 4vw, 30px)" } }, a.title),
          mxh("div", { className: "row small", style: { gap: 8 } },
            cond ? mxh(J, { kind: a.condition === "used_flawed" ? "warn" : "outline" }, cond.label) : null,
            a.size ? mxh("span", { className: "dim" }, r("Talla {0}", [a.size])) : null,
            a.color ? mxh("span", { className: "dim" }, a.color) : null)),
        a.is_final_round && a.status === "open" ? mxh(ce, { kind: "warn" }, r("Última ronda: si hay pujas, la venta es obligatoria.")) : null,
        mxh(MxBidPanel, { a: a, q: q, now: now }),
        a.flaws ? mxh(ce, { kind: "warn" }, mxh("b", null, r("Detalles y defectos: ")), a.flaws) : null,
        mxh("section", { className: "stack", style: { gap: 8 } },
          mxh("span", { className: "eyebrow" }, r("Medidas")),
          mxh("div", { className: "mx-meas" }, (a.measurements || []).map(function (m, i) {
            return mxh("div", { key: i }, mxh("span", null, m.label), mxh("b", { className: "mx-num" }, m.value + " " + m.unit));
          }))),
        mxh("section", { className: "stack", style: { gap: 8 } },
          mxh("span", { className: "eyebrow" }, r("Descripción")),
          mxh("p", { className: "prose", style: { margin: 0, whiteSpace: "pre-wrap" } }, a.description),
          cond ? mxh("span", { className: "small dim" }, cond.label + ": " + cond.hint) : null),
        mxh("section", { className: "row-nw panel", style: { gap: 12 } },
          mxh(qt, { name: a.seller ? a.seller.display_name : "?" }),
          mxh("div", { className: "stack grow", style: { gap: 0 } },
            mxh("b", null, a.store ? a.store.name : a.seller ? a.seller.display_name : ""),
            mxh("span", { className: "small dim" }, a.seller ? "@" + a.seller.username : "")),
          a.store ? mxh(O, { to: "/tienda/" + a.store.slug, className: "btn btn-ghost btn-sm" }, r("Ver tienda")) : null),
        mxh("section", { className: "stack", style: { gap: 8 } },
          mxh("span", { className: "eyebrow" }, r("Pujas")),
          a.bids.length ? mxh("div", { className: "mx-feed" }, a.bids.map(function (b, i) {
            return mxh("div", { key: b.id, className: "mx-feed-row" + (i === 0 ? " top" : "") + (b.mine ? " mine" : "") },
              mxh("span", null, b.mine ? r("Tú") : b.bidder),
              mxh("b", { className: "mx-num" }, mxDollars(b.amount_cents)),
              mxh("span", { className: "tiny dim" }, mxAgo(b.created_at, now + q.offset)));
          })) : mxh("span", { className: "small dim" }, a.status === "open" ? r("Todavía no hay pujas. ¡Sé la primera persona!") : r("No hubo pujas."))),
        mxh(MxRules, { s: a })))));
}

/* ---------------- Panel de IA ---------------- */
function MxAiPanel(props) {
  var av = props.avail, ai = props.ai, pr = ai.proposal;
  if (av && !av.available) return null;
  if (!props.ready && ai.status === "idle") {
    return mxh("span", { className: "small muted row-nw", style: { gap: 6 } }, mxh(I, { name: "sparkle", size: 16 }), r("Sube una foto y la IA llena todo por ti."));
  }
  if (ai.status === "running" || (props.ready && ai.status === "idle")) {
    return mxh("div", { className: "mx-ai running", "aria-live": "polite" },
      mxh("div", { className: "mx-ai-h" }, mxh("span", { className: "mx-ai-orb" }), mxh("b", null, r("Analizando tus fotos…"))),
      mxh("span", { className: "small muted" }, props.uploading ? r("Terminando de subir las fotos…") : r("Revisando etiquetas, color, material y defectos. Puede tardar hasta un minuto.")),
      mxh("div", { className: "mx-ai-bars" }, mxh("i", null), mxh("i", null), mxh("i", null)));
  }
  if (ai.status === "error") {
    return mxh("div", { className: "mx-ai bad" }, mxh("div", { className: "mx-ai-h" }, mxh(I, { name: "sparkle", size: 18 }), mxh("b", null, r("La IA no pudo terminar"))),
      mxh("span", { className: "small muted" }, ai.error),
      mxh(U, { variant: "ghost", size: "sm", icon: "sparkle", type: "button", onClick: props.onRun }, r("Intentar de nuevo")));
  }
  if (ai.status !== "done" || !pr) return null;
  var more = props.ready > ai.count;
  var condLabel = pr.condition ? wt[pr.condition].label : null;
  return mxh("div", { className: "mx-ai done", "aria-live": "polite" },
    mxh("div", { className: "mx-ai-h row between" },
      mxh("span", { className: "row-nw", style: { gap: 8 } }, mxh(I, { name: "sparkle", size: 18 }), mxh("b", null, r("La IA llenó tu subasta"))),
      mxh(U, { variant: "ghost", size: "sm", type: "button", onClick: props.onRun }, more ? r("Analizar con las fotos nuevas") : r("Analizar de nuevo"))),
    mxh("div", { className: "mx-ai-chips" },
      pr.brand.value ? mxh("span", { className: "mx-chip" + (pr.brand.certainty === "visible" ? "" : " warn") }, r("Marca: {0}", [pr.brand.value]) + (pr.brand.certainty === "visible" ? "" : " · " + r("confírmala"))) : null,
      pr.size.value ? mxh("span", { className: "mx-chip" }, r("Talla en etiqueta: {0}", [pr.size.value])) : null,
      pr.color ? mxh("span", { className: "mx-chip" }, pr.color) : null,
      pr.material.value ? mxh("span", { className: "mx-chip" + (pr.material.certainty === "visible" ? "" : " warn") }, pr.material.value) : null,
      condLabel ? mxh("span", { className: "mx-chip" }, condLabel) : null,
      pr.flaws.length ? mxh("span", { className: "mx-chip warn" }, r("{0} detalle(s) encontrados", [pr.flaws.length])) : null),
    pr.price.min_cents && pr.price.max_cents ? mxh("span", { className: "small" }, mxh("b", null, r("Valor estimado por la IA: ")), Y(pr.price.min_cents) + " – " + Y(pr.price.max_cents),
      pr.start_price_cents ? " · " + r("precio inicial sugerido {0}", [Y(pr.start_price_cents)]) : "") : null,
    pr.missing_info.length ? mxh("div", { className: "small muted" }, mxh("b", null, r("Confirma tú: ")), pr.missing_info.join(" · ")) : null,
    mxh("span", { className: "tiny dim" }, r("Revisa cada dato. La IA no verifica autenticidad.")));
}

/* ---------------- Crear subasta ---------------- */

function MxCreateAuction() {
  var g = G(), api = g.api, backend = g.backend, session = g.session, toast = Se(), cats = g.categories || [];
  var photos = MXR.useState([]), f = MXR.useState({ title: "", brand: "", category_id: "", size: "", color: "", condition: "", flaws: "", description: "", start: "10", duration: 10, delay: 0, confirmed: false });
  var meas = MXR.useState([{ label: "Largo", value: "", unit: "in" }, { label: "Ancho (axila a axila)", value: "", unit: "in" }]);
  var err = MXR.useState(null), pending = MXR.useState(false);
  var aiAvail = MXR.useState(null), ai = MXR.useState({ status: "idle", proposal: null, error: null, count: 0 });
  var aiFilled = MXR.useRef({}), touched = MXR.useRef({});
  MXR.useEffect(function () { var live = true; vp(backend).then(function (x) { if (live) aiAvail[1](x); }).catch(function () { if (live) aiAvail[1]({ available: false, reason: "" }); }); return function () { live = false; }; }, [backend]);
  var readyUrls = photos[0].filter(function (p) { return p.url; }).map(function (p) { return p.url; });
  var anyUploading = photos[0].some(function (p) { return p.uploading; });
  var runAi = function () {
    var urls = readyUrls;
    if (!urls.length || ai[0].status === "running") return;
    ai[1](function (x) { return Object.assign({}, x, { status: "running", error: null }); });
    var cur = f[0];
    mxAnalyzeAuction(backend, urls, {
      category_hint: touched.current.category_id ? cur.category_id : null,
      known: { brand: touched.current.brand ? cur.brand : "", size: touched.current.size ? cur.size : "", condition: touched.current.condition && cur.condition ? wt[cur.condition].label : "", notes: "" },
      categories: cats.map(function (c) { return { id: c.id, name: c.name, parent_id: c.parent_id }; })
    }).then(function (pr) {
      applyAi(pr);
      ai[1]({ status: "done", proposal: pr, error: null, count: urls.length });
    }).catch(function (x) {
      ai[1]({ status: "error", proposal: null, error: x && x.message ? x.message : r("La IA no respondió. Puedes continuar manualmente."), count: urls.length });
    });
  };
  var applyAi = function (pr) {
    var filled = {};
    f[1](function (s0) {
      var n = Object.assign({}, s0);
      var put = function (k, v) { if (v === null || v === undefined || v === "") return; if (touched.current[k] && String(s0[k] || "").trim()) return; n[k] = v; filled[k] = true; };
      put("title", pr.title);
      if (pr.brand.value && pr.brand.certainty === "visible") put("brand", pr.brand.value);
      if (pr.category_id && pr.category_confidence !== "baja") put("category_id", pr.category_id);
      if (pr.size.value) put("size", pr.size.value);
      put("color", pr.color);
      if (pr.condition) put("condition", pr.condition);
      if (pr.flaws.length) put("flaws", pr.flaws.join("\n").slice(0, 1000));
      put("description", pr.description);
      if (pr.start_price_cents) put("start", String(Math.round(pr.start_price_cents / 100)));
      return n;
    });
    if (pr.measurements.length >= 2) meas[1](function (arr) {
      if (arr.some(function (m) { return String(m.value).trim(); })) return arr;
      return pr.measurements.map(function (l) { return { label: l, value: "", unit: arr[0] ? arr[0].unit : "in" }; });
    });
    aiFilled.current = filled;
  };
  MXR.useEffect(function () {
    if (!aiAvail[0] || !aiAvail[0].available || anyUploading || !readyUrls.length) return;
    if (ai[0].status === "idle") runAi();
  }, [aiAvail[0], anyUploading, readyUrls.length]);
  if (!session) return mxh(ga, { next: "/subastas/nueva" });
  var form = f[0], set = function (k, v) {
    f[1](function (s) { var n = Object.assign({}, s); n[k] = v; return n; });
    touched.current[k] = true;
    var map = { start: "start_price_cents", confirmed: "photos_confirmed", duration: "duration_minutes", delay: "starts_in_minutes" };
    if (err[0] && err[0].field === (map[k] || k)) err[1](null);
  };
  var fieldErr = function (k) { return err[0] && err[0].field === k ? err[0].message : null; };
  var uploading = photos[0].some(function (p) { return p.uploading; });
  var uploadOne = async function (file) {
    var preview = URL.createObjectURL(file);
    photos[1](function (p) { return p.concat([{ url: "", preview: preview, uploading: true }]); });
    try {
      var small = await Gt(file, 1600, 0.85);
      var up = await backend.uploadImage(small, { bucket: "product-images", ext: "jpg" });
      photos[1](function (p) { return p.map(function (x) { return x.preview === preview ? { url: up.url, storage_path: up.path, preview: preview } : x; }); });
    } catch (e) {
      photos[1](function (p) { return p.filter(function (x) { return x.preview !== preview; }); });
      toast(e.message || r("No se pudo subir la foto. Revisa tu conexión e inténtalo de nuevo."), "bad");
    }
  };
  var addFiles = async function (files) {
    if (!files || !files.length) return;
    var list = Array.prototype.slice.call(files, 0, 12 - photos[0].length);
    for (var i = 0; i < list.length; i++) await uploadOne(list[i]);
    if (err[0] && err[0].field === "images") err[1](null);
  };
  var submit = function (e) {
    e.preventDefault();
    err[1](null); pending[1](true);
    var payload = {
      title: form.title, brand: form.brand, category_id: form.category_id, size: form.size, color: form.color,
      condition: form.condition, flaws: form.condition === "used_flawed" ? form.flaws : "", description: form.description,
      images: photos[0].filter(function (p) { return p.url; }).map(function (p) { return { url: p.url, storage_path: p.storage_path || null }; }),
      measurements: meas[0].filter(function (m) { return m.label.trim() || m.value.trim(); }),
      photos_confirmed: form.confirmed, start_price_cents: (parseInt(form.start, 10) || 0) * 100,
      duration_minutes: form.duration, starts_in_minutes: form.delay
    };
    api.call("create_auction", { p: payload }).then(function (d) {
      st("auctions:"); toast(d.phase === "live" ? r("¡Tu subasta ya está en vivo!") : r("Subasta programada"), "ok"); Ce("/subasta/" + d.id);
    }).catch(function (x) {
      var field = x.detail && x.detail.field ? x.detail.field : null;
      err[1]({ message: x.message, field: field });
      toast(x.message, "bad");
    }).finally(function () { pending[1](false); });
  };
  var parents = cats.filter(function (c) { return !c.parent_id; });
  var catOptions = [];
  parents.forEach(function (p) {
    catOptions.push(mxh("option", { key: p.id, value: p.id }, p.name));
    cats.filter(function (c) { return c.parent_id === p.id; }).forEach(function (c) { catOptions.push(mxh("option", { key: c.id, value: c.id }, "— " + c.name)); });
  });
  var ready = photos[0].filter(function (p) { return p.url; }).length;
  return mxh(ne, { narrow: true }, mxh("form", { className: "stack-xl", onSubmit: submit },
    mxh("div", { className: "stack", style: { gap: 6 } },
      mxh(O, { to: "/subastas", className: "link small row-nw", style: { gap: 4 } }, mxh(I, { name: "back", size: 16 }), r("Subastas")),
      mxh("h1", { className: "h1" }, r("Subastar un artículo"))),

    mxh("section", { className: "stack" },
      mxh("div", { className: "row between" }, mxh("span", { className: "h3" }, r("Fotos")), mxh("span", { className: "small dim" }, r("{0}/12", [photos[0].length]))),
      mxh("div", { className: "photo-grid" },
        photos[0].map(function (ph, i) {
          return mxh("div", { key: ph.preview || ph.url, className: "photo" },
            mxh(na, { src: ph.preview || ph.url, alt: r("Foto {0}", [i + 1]) }),
            i === 0 ? mxh("span", { className: "cover-tag" }, mxh(J, { kind: "accent" }, r("Portada"))) : null,
            ph.uploading ? mxh("div", { style: { position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(11,11,13,.55)" } }, mxh("span", { className: "spin" })) :
              mxh("div", { className: "ph-actions" },
                i > 0 ? mxh("button", { type: "button", "aria-label": r("Usar como portada"), onClick: function () { photos[1](function (p) { return [p[i]].concat(p.filter(function (x, k) { return k !== i; })); }); } }, mxh(I, { name: "star", size: 15 })) : mxh("span", null),
                mxh("button", { type: "button", "aria-label": r("Eliminar foto"), onClick: function () { photos[1](function (p) { return p.filter(function (x, k) { return k !== i; }); }); } }, mxh(I, { name: "trash", size: 15 }))));
        }),
        photos[0].length < 12 ? mxh("label", { className: "photo-add" }, mxh(I, { name: "camera", size: 24 }), mxh("span", null, r("Añadir fotos")), mxh("span", { className: "tiny dim" }, r("Cámara o galería")),
          mxh("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onChange: function (e) { addFiles(e.target.files); e.currentTarget.value = ""; } })) : null),
      fieldErr("images") ? mxh("span", { className: "error-text" }, fieldErr("images")) : null,
      mxh(MxAiPanel, { avail: aiAvail[0], ai: ai[0], ready: readyUrls.length, uploading: anyUploading, onRun: runAi })),

    mxh("section", { className: "stack" },
      mxh("span", { className: "h3" }, r("Artículo")),
      mxh(j, { label: r("Título"), required: true, error: fieldErr("title") }, mxh(ae, { value: form.title, maxLength: 120, onChange: function (e) { set("title", e.target.value); }, placeholder: r("Ej. Hoodie negra heavyweight talla M") })),
      mxh("div", { className: "grid-2" },
        mxh(j, { label: r("Marca") }, mxh(ae, { value: form.brand, maxLength: 60, onChange: function (e) { set("brand", e.target.value); } })),
        mxh(j, { label: r("Categoría"), required: true, error: fieldErr("category_id") }, mxh(Te, { value: form.category_id, onChange: function (e) { set("category_id", e.target.value); } }, mxh("option", { value: "" }, r("Elige…")), catOptions)),
        mxh(j, { label: r("Talla") }, mxh(ae, { value: form.size, maxLength: 20, onChange: function (e) { set("size", e.target.value); }, placeholder: r("Ej. M, 9 US, 32x30") })),
        mxh(j, { label: r("Color") }, mxh(ae, { value: form.color, maxLength: 40, onChange: function (e) { set("color", e.target.value); } }))),
      mxh(j, { label: r("Estado"), required: true, error: fieldErr("condition") },
        mxh(Te, { value: form.condition, onChange: function (e) { set("condition", e.target.value); } }, mxh("option", { value: "" }, r("Elige…")),
          MX_CONDITIONS.map(function (c) { return mxh("option", { key: c, value: c }, wt[c].label + " — " + wt[c].hint); }))),
      form.condition === "used_flawed" ? mxh(j, { label: r("Describe cada detalle o defecto"), required: true, error: fieldErr("flaws"), hint: r("Y muéstralos de cerca en las fotos.") },
        mxh(Ta, { value: form.flaws, rows: 3, maxLength: 1000, onChange: function (e) { set("flaws", e.target.value); }, placeholder: r("Ej. Pequeña mancha en el puño izquierdo (foto 4).") })) : null),

    mxh("section", { className: "stack" },
      mxh("div", { className: "row between" }, mxh("span", { className: "h3" }, r("Medidas")), mxh("span", { className: "small dim" }, r("Mínimo 2"))),
      mxh("datalist", { id: "mx-meas-hints" }, MX_MEASURE_HINTS.map(function (x) { return mxh("option", { key: x, value: r(x) }); })),
      meas[0].map(function (m, i) {
        var upd = function (k, v) { meas[1](function (arr) { return arr.map(function (x, n) { if (n !== i) return x; var y = Object.assign({}, x); y[k] = v; return y; }); }); };
        return mxh("div", { key: i, className: "mx-meas-row" },
          mxh("input", { className: "input", list: "mx-meas-hints", value: m.label, maxLength: 30, placeholder: r("Medida"), "aria-label": r("Medida"), onChange: function (e) { upd("label", e.target.value); } }),
          mxh("input", { className: "input num", inputMode: "decimal", value: m.value, placeholder: "0", "aria-label": r("Valor"), onChange: function (e) { upd("value", e.target.value.replace(/[^0-9.,]/g, "").slice(0, 7)); } }),
          mxh("select", { className: "select", value: m.unit, "aria-label": r("Unidad"), onChange: function (e) { upd("unit", e.target.value); } }, mxh("option", { value: "in" }, "in"), mxh("option", { value: "cm" }, "cm")),
          mxh("button", { type: "button", className: "icon-btn", "aria-label": r("Quitar medida"), onClick: function () { meas[1](function (arr) { return arr.filter(function (x, n) { return n !== i; }); }); } }, mxh(I, { name: "trash", size: 16 })));
      }),
      fieldErr("measurements") ? mxh("span", { className: "error-text" }, fieldErr("measurements")) : null,
      meas[0].length < 12 ? mxh(U, { variant: "ghost", size: "sm", icon: "plus", type: "button", onClick: function () { meas[1](function (arr) { return arr.concat([{ label: "", value: "", unit: arr.length ? arr[arr.length - 1].unit : "in" }]); }); } }, r("Agregar medida")) : null),

    mxh("section", { className: "stack" },
      mxh("span", { className: "h3" }, r("Descripción (opcional)")),
      mxh(j, { label: r("Describe el artículo"), error: fieldErr("description") },
        mxh(Ta, { value: form.description, rows: 5, maxLength: 3000, onChange: function (e) { set("description", e.target.value); } }))),

    mxh("section", { className: "stack" },
      mxh("span", { className: "h3" }, r("Subasta")),
      mxh(j, { label: r("Precio inicial"), required: true, error: fieldErr("start_price_cents"), hint: r("En dólares enteros. Cada puja sube $1.") },
        mxh("div", { className: "input-group" }, mxh("span", { className: "addon" }, "$"),
          mxh("input", { className: "input num", inputMode: "numeric", value: form.start, onChange: function (e) { set("start", e.target.value.replace(/[^0-9]/g, "").slice(0, 6)); } }))),
      mxh(j, { label: r("Duración") }, mxh(MxSegment, { value: form.duration, onChange: function (v) { set("duration", v); }, items: MX_DURATIONS.map(function (m) { return { id: m, label: r("{0} min", [m]) }; }) })),
      mxh(j, { label: r("Empieza") }, mxh(MxSegment, { value: form.delay, onChange: function (v) { set("delay", v); }, items: [{ id: 0, label: r("Ahora") }, { id: 15, label: r("En 15 min") }, { id: 60, label: r("En 1 h") }, { id: 1440, label: r("Mañana") }] })),
      null),

    mxh("section", { className: "panel stack", style: { gap: 10 } },
      mxh("span", { className: "small muted" }, r("Comisión {0} · Envías en 3 días · Puedes reenlistar hasta 3 veces; la cuarta ronda se vende.", [lt(g.settings ? g.settings.commission_bps : 700)])),
      mxh("label", { className: "row-nw", style: { gap: 10, alignItems: "flex-start" } },
        mxh("input", { type: "checkbox", checked: form.confirmed, onChange: function (e) { set("confirmed", e.target.checked); }, style: { marginTop: 3, width: 20, height: 20 } }),
        mxh("span", null, r("Las fotos son reales y muestran el estado del artículo."))),
      fieldErr("photos_confirmed") ? mxh("span", { className: "error-text" }, fieldErr("photos_confirmed")) : null),

    err[0] && !err[0].field ? mxh(ce, { kind: "bad" }, err[0].message) : null,
    mxh(U, { variant: "primary", size: "lg", block: true, type: "submit", loading: pending[0], disabled: uploading },
      uploading ? r("Subiendo fotos…") : form.delay ? r("Programar subasta") : r("Empezar subasta ahora")),
    ready < 1 ? mxh("span", { className: "small dim", style: { textAlign: "center" } }, r("Sube al menos 1 foto.")) : null));
}

/* ---------------- Mis subastas ---------------- */
function MxMyAuctions() {
  var g = G(), api = g.api, route = _a();
  var role = MXR.useState(route.query.get("rol") || "buyer");
  if (!g.session) return mxh(ga, { next: "/mis-subastas" });
  return mxh(ne, { narrow: true }, mxh("div", { className: "stack-lg" },
    mxh("div", { className: "row between" }, mxh("h1", { className: "h1" }, r("Mis subastas")),
      mxh(O, { to: "/subastas/nueva", className: "btn btn-primary btn-sm" }, mxh(I, { name: "plus", size: 16 }), r("Subastar"))),
    mxh(ko, { value: role[0], onChange: role[1], items: [{ id: "buyer", label: r("Pujando y ganadas") }, { id: "seller", label: r("Vendiendo") }] }),
    mxh(MxMyList, { role: role[0], key: role[0] })));
}

function MxMyList(props) {
  var api = G().api, now = mxUseNow(1000);
  var q = ge("auctions:mine:" + props.role, function () { return api.call("my_auctions", { p_role: props.role }); }, { staleMs: 3000 });
  MXR.useEffect(function () { var t = setInterval(q.reload, 6000); return function () { clearInterval(t); }; }, [q.reload]);
  if (q.loading) return mxh(Ee, null);
  if (q.error) return mxh(oe, { error: q.error, onRetry: q.reload });
  if (!q.data || !q.data.length) return mxh($e, { icon: "clock", title: props.role === "buyer" ? r("Todavía no entras a ninguna subasta") : r("Todavía no subastas nada"),
    action: mxh(O, { to: props.role === "buyer" ? "/subastas" : "/subastas/nueva", className: "btn btn-primary" }, props.role === "buyer" ? r("Ver subastas en vivo") : r("Subastar un artículo")) });
  return mxh("div", { className: "stack" }, q.data.map(function (a) {
    var v = a.viewer, note = null, kind = null;
    if (a.status === "awaiting_seller" && v.is_seller) { note = r("Decide antes de {0}", [mxClock(Date.parse(a.decision_due_at) - now)]); kind = "warn"; }
    else if (a.status === "awaiting_seller" && v.won) { note = r("Ganaste · esperando al vendedor"); kind = "ok"; }
    else if (a.status === "sold" && v.won) { note = r("Ganaste · pagado"); kind = "ok"; }
    else if (a.status === "sold" && v.is_seller) { note = r("Vendida · por enviar"); kind = "ok"; }
    else if (a.phase === "live" && v.is_high_bidder) { note = r("Vas ganando"); kind = "ok"; }
    else if (a.phase === "live" && v.has_bid) { note = r("Te superaron"); kind = "bad"; }
    return mxh(O, { key: a.id, to: "/subasta/" + a.id, className: "offer-card" },
      mxh("div", { className: "thumb" }, mxh(na, { src: a.image_url, alt: a.title })),
      mxh("div", { className: "stack", style: { gap: 6, minWidth: 0 } },
        mxh("div", { className: "row between", style: { alignItems: "flex-start" } },
          mxh("span", { className: "clamp-2", style: { fontWeight: 600 } }, a.title),
          mxh(MxPhaseBadge, { a: a, now: now })),
        mxh("div", { className: "row between" }, mxh(MxPrice, { a: a, size: 17 }),
          a.phase === "live" ? mxh("span", { className: "small mx-num" }, mxClock(Date.parse(a.ends_at) - now)) : a.round > 1 ? mxh("span", { className: "tiny dim" }, r("Ronda {0} de {1}", [a.round, a.max_rounds])) : null),
        note ? mxh(J, { kind: kind }, note) : null));
  }));
}


/* ---------------- Inicio (limpio) ---------------- */
function MxHome() {
  var g = G(), api = g.api, cats = (g.categories || []).filter(function (c) { return !c.parent_id; });
  var q = ge("home", function () { return api.home(); });
  var o = q.data;
  return mxh("main", { className: "page", style: { paddingTop: 0 } }, mxh("div", { className: "wrap stack-xl" },
    mxh("section", { className: "mx-home-hero" },
      mxh("h1", { className: "mx-home-title" }, r("Compra, vende y subasta moda.")),
      mxh("p", { className: "muted" }, r("Ropa, sneakers y streetwear. Haz ofertas o puja en vivo.")),
      mxh("div", { className: "row", style: { gap: 10 } },
        mxh(O, { to: "/publicar", className: "btn btn-primary btn-lg" }, mxh(I, { name: "plus", size: 18 }), r("Vender")),
        mxh(O, { to: "/subastas/nueva", className: "btn btn-outline btn-lg" }, mxh(I, { name: "gavel", size: 18 }), r("Subastar")))),
    mxh(MxHomeAuctions, null),
    cats.length ? mxh("section", null,
      mxh(Ka, { title: r("Categorías"), action: mxh(O, { to: "/categorias", className: "link small" }, r("Ver todas")) }),
      mxh("div", { className: "cat-tiles" }, cats.map(function (c) {
        return mxh(O, { key: c.id, to: St("/explorar", { cat: c.id }), className: "cat-tile" },
          mxh("span", { className: "cat-tile-art" }, mxh("img", { src: Us(c.id), alt: "", loading: "lazy" })),
          mxh("span", { className: "cat-tile-name" }, c.name));
      }))) : null,
    q.error ? mxh(oe, { error: q.error, onRetry: q.reload }) : null,
    q.loading ? mxh(Hl, null) : null,
    o && o.promoted.length ? mxh("section", null, mxh(Ka, { title: r("Patrocinado") }), mxh(Vl, { items: o.promoted })) : null,
    o && o.recent.length ? mxh("section", null,
      mxh(Ka, { title: r("Recién publicado"), action: mxh(O, { to: "/explorar", className: "link small" }, r("Ver todo")) }),
      mxh(kt, { items: o.recent.slice(0, 12), wide: true })) : null,
    o && o.promos && o.promos.length ? mxh("section", { className: "grid-2" }, o.promos.slice(0, 2).map(function (l) {
      return mxh(O, { key: l.campaign_id, to: l.business ? "/negocio/" + l.business.slug : l.store ? "/tienda/" + l.store.slug : "/negocios", className: "promo-card" },
        mxh(J, { kind: "accent" }, r("Publicidad")),
        mxh("span", { className: "h3" }, l.headline),
        l.body ? mxh("span", { className: "small muted" }, l.body) : null);
    })) : null,
    o && !o.recent.length ? mxh($e, { icon: "tag", title: r("Todavía no hay artículos"), action: mxh(O, { to: "/publicar", className: "btn btn-primary" }, r("Publicar el primero")) }, r("Sube el tuyo y será lo primero que vean.")) : null));
}

/* ---------------- Inicio: franja de subastas ---------------- */
function MxHomeAuctions() {
  var api = G().api, now = mxUseNow(1000);
  var q = ge("auctions:live", function () { return api.call("list_auctions", { p: { tab: "live" } }); }, { staleMs: 3000 });
  MXR.useEffect(function () { var t = setInterval(function () { if (document.visibilityState !== "hidden") q.reload(); }, 8000); return function () { clearInterval(t); }; }, [q.reload]);
  var items = (q.data || []).slice(0, 8);
  return mxh("section", { className: "stack" },
    mxh("div", { className: "section-h row between" },
      mxh("div", { className: "row", style: { gap: 10 } }, mxh("h2", { className: "h2", style: { margin: 0 } }, r("Subastas en vivo")), mxh(MxLiveDot, { small: true })),
      mxh(O, { to: "/subastas", className: "link small" }, r("Ver todas"))),
    items.length ? mxh("div", { className: "mx-rail" }, items.map(function (a) { return mxh(MxCard, { key: a.id, a: a, now: now }); })) :
      mxh(O, { to: "/subastas", className: "panel row-nw mx-promo" }, mxh(I, { name: "clock", size: 22 }),
        mxh("span", { className: "stack grow", style: { gap: 2 } }, mxh("b", null, r("Subasta lo que ya no usas")), mxh("span", { className: "small dim" }, r("Pujas de $1 en $1 con dinero retenido: si ganan, ya está pagado."))),
        mxh(I, { name: "chevron", size: 18 })));
}

function __mxRoutes() {
  return [
    ["/", function () { return mxh(MxHome, null); }],
    ["/subastas", function () { return mxh(MxAuctionsPage, null); }],
    ["/subastas/nueva", function () { return mxh(MxCreateAuction, null); }],
    ["/subasta/:id", function (e) { return mxh(MxAuctionRoom, { id: e.id, key: e.id }); }],
    ["/mis-subastas", function () { return mxh(MxMyAuctions, null); }],
    ["/ayuda", function () { return mxh(MxSupportPage, null); }],
    ["/admin/soporte", function () { return mxh(MxAdminSupport, null); }]
  ];
}

export { __mxRoutes, MxHome, mxAgo, mxUseNow };
