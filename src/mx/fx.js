// Compartir enlaces, sonido de monedas sintetizado y celebración al comprar o vender.
import { MXR, mxh, G, r, U } from "./compat.js";
import { apiHooks } from "../api/endpoints";


/* ---------- Enlaces para compartir ---------- */
var MX_PUBLIC_URL = "https://wzkn5fbgsb-dotcom.github.io/MARKETZONE/";
function mxPublicBase() {
  var c = globalThis.__MZ_CONFIG__ || {};
  if (c.publicUrl) return String(c.publicUrl);
  var h = location.hostname || "";
  if (location.protocol !== "https:" && location.protocol !== "http:") return MX_PUBLIC_URL;
  if (!h || /claudeusercontent|claude\.ai|anthropic|^localhost$|^127\./.test(h)) return MX_PUBLIC_URL;
  return location.origin + location.pathname;
}
function mxShareUrl(path) {
  var base = mxPublicBase().replace(/#.*$/, "");
  return base + "#" + (path.charAt(0) === "/" ? path : "/" + path);
}
function mxCurrentPath() { return location.hash && location.hash.length > 1 ? location.hash.slice(1) : location.pathname + location.search; }
async function mxShare(o) {
  var url = mxShareUrl(o.path || mxCurrentPath());
  var data = { title: o.title ? o.title + " · MARKETXONE" : "MARKETXONE", text: o.text || o.title || "MARKETXONE", url: url };
  try {
    if (navigator.share && (!navigator.canShare || navigator.canShare(data))) { await navigator.share(data); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(url); o.toast(o.okMsg || r("Enlace copiado. Pégalo donde quieras y abrirá el artículo."), "ok"); }
  catch (e) { o.toast(url); }
}

/* ---------- Ajuste de sonido ---------- */
function mxSoundOn() { try { return localStorage.getItem("mx.sound") !== "off"; } catch (e) { return true; } }
function mxSetSound(on) { try { localStorage.setItem("mx.sound", on ? "on" : "off"); } catch (e) {} }

/* ---------- Motor de sonido: monedas sintetizadas (sin archivos) ---------- */
var mxAudio = null;
function mxCtx() {
  if (mxAudio) return mxAudio;
  var AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  try {
    var ctx = new AC(), comp = ctx.createDynamicsCompressor(), out = ctx.createGain();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.2;
    out.gain.value = 0.75; comp.connect(out); out.connect(ctx.destination);
    var len = Math.floor(ctx.sampleRate * 0.25), nb = ctx.createBuffer(1, len, ctx.sampleRate), d = nb.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    mxAudio = { ctx: ctx, bus: comp, noise: nb };
  } catch (e) { mxAudio = null; }
  return mxAudio;
}
function mxUnlockAudio() {
  var a = mxCtx(); if (!a) return;
  if (a.ctx.state === "suspended") a.ctx.resume().catch(function () {});
  try { var s = a.ctx.createBufferSource(); s.buffer = a.ctx.createBuffer(1, 1, 22050); s.connect(a.ctx.destination); s.start(0); } catch (e) {}
}
if (typeof window !== "undefined") {
  ["pointerdown", "touchend", "keydown"].forEach(function (ev) { window.addEventListener(ev, function once() { mxUnlockAudio(); window.removeEventListener(ev, once, true); }, true); });
}
function mxPan(a, x) {
  if (a.ctx.createStereoPanner) { var p = a.ctx.createStereoPanner(); p.pan.value = x; p.connect(a.bus); return p; }
  return a.bus;
}
function mxClink(a, t, f, vol, pan) {
  var ctx = a.ctx, dest = mxPan(a, pan || 0);
  var parts = [[1, 1, 0.42], [2.76, 0.55, 0.26], [5.4, 0.35, 0.14], [8.93, 0.2, 0.08], [13.3, 0.1, 0.05]];
  parts.forEach(function (p) {
    var hz = f * p[0] / 2.2;
    if (hz > ctx.sampleRate * 0.45) return;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(hz, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * p[1], t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + p[2]);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + p[2] + 0.02);
  });
  var n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
  n.buffer = a.noise; bp.type = "bandpass"; bp.frequency.value = f * 1.6; bp.Q.value = 3;
  ng.gain.setValueAtTime(vol * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
  n.connect(bp); bp.connect(ng); ng.connect(dest); n.start(t, Math.random() * 0.2, 0.03);
}
function mxBell(a, t, f, vol, dur) {
  var ctx = a.ctx;
  [[1, 1], [2.0, 0.4], [3.01, 0.22], [4.2, 0.1]].forEach(function (p) {
    if (f * p[0] > ctx.sampleRate * 0.45) return;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(f * p[0], t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * p[1], t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur / p[0]);
    o.connect(g); g.connect(a.bus); o.start(t); o.stop(t + dur + 0.05);
  });
}
function mxDrawer(a, t) { /* "cha": golpe mecánico de la caja registradora */
  var ctx = a.ctx, n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  n.buffer = a.noise; f.type = "bandpass"; f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(900, t + 0.08); f.Q.value = 1.4;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.55, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  n.connect(f); f.connect(g); g.connect(a.bus); n.start(t, 0, 0.13);
  var o = ctx.createOscillator(), og = ctx.createGain();
  o.type = "triangle"; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
  og.gain.setValueAtTime(0.35, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  o.connect(og); og.connect(a.bus); o.start(t); o.stop(t + 0.16);
}
function mxCascade(a, t, n, span) {
  for (var i = 0; i < n; i++) {
    var k = i / n, at = t + span * Math.pow(k, 1.35) + Math.random() * 0.03;
    mxClink(a, at, 2500 + Math.random() * 2300, 0.32 * (1 - k * 0.6), Math.random() * 1.4 - 0.7);
    if (Math.random() < 0.35) mxClink(a, at + 0.035 + Math.random() * 0.04, 3000 + Math.random() * 2000, 0.14 * (1 - k), Math.random() * 1.4 - 0.7);
  }
}
function mxPlayMoney(kind) {
  if (!mxSoundOn()) return;
  var a = mxCtx(); if (!a) return;
  if (a.ctx.state === "suspended") a.ctx.resume().catch(function () {});
  var t = a.ctx.currentTime + 0.03;
  if (kind === "win") {
    [1318.5, 1661.2, 1975.5, 2637].forEach(function (f, i) { mxBell(a, t + i * 0.09, f, 0.16, 0.9); });
    mxCascade(a, t + 0.3, 26, 1.5);
  } else {
    mxDrawer(a, t);
    mxBell(a, t + 0.09, 1568, 0.22, 1.4); mxBell(a, t + 0.09, 2093, 0.16, 1.2);
    mxCascade(a, t + 0.2, kind === "sell" ? 24 : 18, kind === "sell" ? 1.3 : 1.1);
  }
  try { if (navigator.vibrate) navigator.vibrate([18, 40, 18, 40, 30]); } catch (e) {}
}

/* ---------- Celebración: lluvia de monedas ---------- */
var mxLastFx = 0;
function mxCelebrate(kind, title, sub) {
  var now = Date.now();
  if (now - mxLastFx < 2500) return;
  mxLastFx = now;
  mxPlayMoney(kind);
  if (typeof document === "undefined") return;
  var reduce = false;
  try { reduce = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  var root = document.createElement("div");
  root.className = "mx-fx" + (reduce ? " reduce" : "");
  root.setAttribute("aria-hidden", "true");
  var n = reduce ? 0 : (innerWidth < 500 ? 26 : 40);
  for (var i = 0; i < n; i++) {
    var c = document.createElement("div"), s = 22 + Math.random() * 20;
    c.className = "mx-coin-fall";
    c.style.cssText = "--x:" + (Math.random() * 100).toFixed(1) + "vw;--dx:" + (Math.random() * 30 - 15).toFixed(1) + "vw;--s:" + s.toFixed(0) + "px;--d:" + (1.6 + Math.random() * 1.2).toFixed(2) + "s;--w:" + (Math.random() * 0.7).toFixed(2) + "s;--r:" + (Math.random() * 720 - 360).toFixed(0) + "deg;--f:" + (0.35 + Math.random() * 0.5).toFixed(2) + "s";
    c.innerHTML = '<i class="mx-coin"><b>X</b></i>';
    root.appendChild(c);
  }
  var card = document.createElement("div");
  card.className = "mx-fx-card";
  card.innerHTML = '<span class="mx-fx-ring"><i class="mx-coin big"><b>X</b></i></span><strong></strong><span class="mx-fx-sub"></span>';
  card.querySelector("strong").textContent = title || "";
  card.querySelector(".mx-fx-sub").textContent = sub || "";
  root.appendChild(card);
  document.body.appendChild(root);
  setTimeout(function () { root.classList.add("out"); }, 2300);
  setTimeout(function () { root.remove(); }, 3200);
}
var MX_FX = {
  buy: function (sub) { mxCelebrate("buy", r("¡Compra exitosa!"), sub || r("Tu pago quedó confirmado.")); },
  sell: function (sub) { mxCelebrate("sell", r("¡Vendido!"), sub || r("Tienes una venta nueva. Prepara el envío.")); },
  win: function (sub) { mxCelebrate("win", r("¡Ganaste la subasta!"), sub || r("Ya está pagado con tu dinero retenido.")); },
  deal: function (sub) { mxCelebrate("buy", r("¡Trato hecho!"), sub || r("La oferta quedó aceptada.")); }
};

/* Se llama después de cada llamada exitosa a la API. */
function __mxAfterCall(name, args, res) {
  try {
    if ((name === "pay_order_test" || name === "mark_order_paid") && (!res || !res.status || res.status === "paid")) MX_FX.buy();
    else if (name === "respond_offer" && args && args.p_action === "accept") MX_FX.deal();
    else if (name === "auction_decide" && args && args.p_action === "accept") MX_FX.sell(r("Aceptaste la venta de tu subasta."));
  } catch (e) {}
}

/* Vigila notificaciones nuevas: ventas que pasan mientras usas la app. */
function MxFxWatcher() {
  var g = G(), api = g.api, session = g.session;
  var seen = MXR.useRef(null);
  MXR.useEffect(function () {
    if (!session) { seen.current = null; return; }
    var live = true;
    var tick = function () {
      if (document.visibilityState === "hidden") return;
      api.call("my_notifications").then(function (list) {
        if (!live || !Array.isArray(list)) return;
        if (!seen.current) { seen.current = new Set(list.map(function (x) { return x.id; })); return; }
        var fresh = list.filter(function (x) { return !seen.current.has(x.id); });
        fresh.forEach(function (x) { seen.current.add(x.id); });
        var kinds = fresh.map(function (x) { return x.kind; });
        var pick = function (k) { return fresh.filter(function (x) { return x.kind === k; })[0]; };
        if (kinds.indexOf("auction_won") >= 0) MX_FX.win(pick("auction_won").title);
        else if (kinds.indexOf("new_sale") >= 0) MX_FX.sell(pick("new_sale").title);
        else if (kinds.indexOf("auction_sold") >= 0) { var as = pick("auction_sold"); if (/^Compra/.test(as.title || "")) MX_FX.buy(as.title); else MX_FX.sell(as.title); }
        else if (kinds.indexOf("offer_accepted") >= 0) MX_FX.deal(pick("offer_accepted").title);
      }).catch(function () {});
    };
    tick();
    var t = setInterval(tick, 6000);
    return function () { live = false; clearInterval(t); };
  }, [session && session.user && session.user.id]);
  return null;
}

function MxSoundSetting() {
  var on = MXR.useState(mxSoundOn());
  return mxh("section", { className: "stack" },
    mxh("h2", { className: "h3" }, r("Sonidos")),
    mxh("span", { className: "small muted" }, r("Sonido de monedas al comprar, vender o ganar una subasta.")),
    mxh("div", { className: "row", style: { gap: 8 } },
      mxh("div", { className: "segmented", role: "radiogroup", "aria-label": r("Sonidos") },
        [[true, r("Activados")], [false, r("Desactivados")]].map(function (o) {
          return mxh("button", { key: String(o[0]), type: "button", role: "radio", "aria-checked": on[0] === o[0], className: "seg " + (on[0] === o[0] ? "on" : ""), onClick: function () { mxSetSound(o[0]); on[1](o[0]); if (o[0]) { mxUnlockAudio(); mxPlayMoney("buy"); } } }, o[1]);
        })),
      mxh(U, { variant: "ghost", size: "sm", type: "button", onClick: function () { mxLastFx = 0; MX_FX.sell(r("Así se escucha una venta.")); } }, r("Probar"))));
}

apiHooks.after = __mxAfterCall;

export { mxShare, mxCurrentPath, MX_FX, __mxAfterCall, MxFxWatcher, MxSoundSetting };
