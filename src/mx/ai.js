// IA que analiza las fotos de una subasta y llena la publicación.
import { r, bp, Zb, Gt, ie } from "./compat.js";
import { toBase64 } from "../app/images";
import { MX_MEASURE_HINTS, auctionPrompt as mxAiPrompt, normalizeAuctionResult as mxAiNormalize } from "../../supabase/functions/_shared/auction-ai";

/* Con Supabase se usa la función del servidor "ai-listing" que ya existe y se adapta su respuesta. */
function mxFromListing(p, catIds) {
  var attr = function (re) { var a = (p.attributes || []).filter(function (x) { return re.test(x.name) && x.certainty === "visible"; })[0]; return a ? a.value : ""; };
  return mxAiNormalize({
    title: p.titles && (p.titles.search || p.titles.descriptive) || "",
    brand: p.detected_brand, category_id: p.category_id, category_confidence: p.category_confidence,
    size: { value: null, source: "no_visible" }, color: attr(/color/i), material: { value: attr(/material|tela|composici/i) || null, certainty: attr(/material|tela|composici/i) ? "visible" : "no_confirmado" },
    condition: null, flaws: [], description: p.description, measurements: [],
    price: p.price || {}, start_price_cents: null,
    missing_info: (p.missing_info || []).concat(p.uncertainties || []), photo_tips: p.photo_tips || []
  }, catIds);
}

async function mxAnalyzeAuction(backend, urls, ctx) {
  var ids = (ctx.categories || []).map(function (c) { return c.id; });
  var blobs = (await Promise.all(urls.slice(0, 6).map(function (u) { return Zb(u); }))).filter(Boolean);
  if (!blobs.length) throw new ie("validation", r("Añade al menos una fotografía para analizar."));
  if (backend.mode !== "demo") {
    var images = await Promise.all(blobs.map(async function (b) { return { media_type: "image/jpeg", data: await toBase64(await Gt(b, 1024, 0.8)) }; }));
    try {
      return (await backend.invokeFunction("ai-auction", Object.assign({ images: images }, ctx))).proposal;
    } catch (e) {
      /* Si la función de subastas aún no está desplegada, se usa la de publicaciones. */
      if (e && (e.status === 404 || e.code === "not_configured")) return mxFromListing(await bp(backend, urls, ctx), ids);
      throw e;
    }
  }
  var small = await Promise.all(blobs.map(function (b) { return Gt(b, 1280, 0.82).catch(function () { return b; }); }));
  return (await backend.invokeFunction("ai-auction", { blobs: small, input: ctx })).proposal;
}

export { MX_MEASURE_HINTS, mxAiPrompt, mxAiNormalize, mxAnalyzeAuction };
