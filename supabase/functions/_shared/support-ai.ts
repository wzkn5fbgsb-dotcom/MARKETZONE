// Servicio al cliente de MARKETXONE: reglas, prompt y normalización compartidos por la web y la
// Edge Function "ai-support". El asistente no puede aprobar reembolsos ni prometer nada fuera de las políticas.

export interface SupportAiResult {
  reply: string;
  actions: { label: string; path: string }[];
  escalate: boolean;
  escalate_reason: string;
  confidence: string;
  topic: string;
  kb_ids: string[];
}

export function supportPolicies(s: any): string {
  s = s || {};
  var pct = String(((s.commission_bps != null ? s.commission_bps : 700) / 100)) + " %";
  return [
    "MARKETXONE es un marketplace entre personas de moda, sneakers, streetwear, accesorios, bolsos y belleza. Solo para mayores de 18 años.",
    "PAGOS: hoy la app funciona en MODO DE PRUEBA: no se cobra dinero real ni se aceptan tarjetas reales. Los pagos de prueba se confirman al instante.",
    "COMISIÓN: el vendedor paga " + pct + " del precio de venta. Comprar no tiene comisión. Las promociones se pagan aparte.",
    "COMPRAR: se agrega al carrito y se paga; el pedido queda pagado y el vendedor lo prepara y envía con número de guía. El comprador confirma la entrega en Mis pedidos.",
    "OFERTAS: la oferta se paga al enviarla y el dinero queda retenido. Si el vendedor acepta, el trato está hecho. Si rechaza, vence o se cancela, se libera el dinero completo.",
    "SUBASTAS EN VIVO: para pujar se retiene un límite elegido más el envío; las pujas suben de $1 en $1 y nunca pasan el límite. Si alguien puja en los últimos segundos el reloj se extiende. Al cerrar, al ganador se le cobra de lo retenido y a los demás se les libera. El vendedor acepta o reenlista en " + (s.auction_decision_minutes || 60) + " min (si no responde se confirma sola); máximo " + (s.auction_max_relists || 3) + " reenlistados y la última ronda es venta obligatoria. El vendedor tiene " + (s.auction_ship_days || 3) + " días para enviar o se reembolsa al comprador.",
    "PROBLEMAS CON UN PEDIDO: desde el pedido (Mis pedidos → el pedido → Reportar un problema) se abre una disputa: artículo no llegó, no coincide con la descripción o llegó dañado. El equipo revisa y decide reembolsos. El asistente NO puede aprobar reembolsos ni prometerlos.",
    "ENVÍO: lo prepara el vendedor; el seguimiento aparece en el pedido cuando agrega la guía.",
    "VENDER: botón Vender (hasta 12 fotos, la IA propone título y descripción) o Subastar desde la pestaña Subastas (desde 1 foto, la IA llena la subasta).",
    "CUENTA: Ajustes permite cambiar perfil, direcciones, apariencia, sonidos, bloquear usuarios y eliminar la cuenta. Las publicaciones y tiendas se pueden reportar.",
    "PRIVACIDAD Y SEGURIDAD: nunca pidas contraseñas, códigos ni números completos de tarjeta. Si el usuario los comparte, dile que no lo haga."
  ].join("\n");
}

export const SUPPORT_PATHS = /^\/(pedidos|pedido\/[\w-]+|ofertas|mis-subastas|subastas|subasta\/[\w-]+|publicar|subastas\/nueva|ajustes|panel\/pedidos|panel|carrito|terminos|privacidad|notificaciones|p\/[\w-]+|favoritos|perfil)$/;

export function supportPrompt(c: any): string {
  var kb = (c.kb || []).slice(0, 40).map(function (k: any) { return "[" + k.id + "] P: " + k.question + "\n    R: " + k.answer; }).join("\n");
  var hist = (c.history || []).slice(-12).map(function (m: any) { return (m.role === "user" ? "CLIENTE: " : m.role === "agent" ? "EQUIPO: " : "ASISTENTE: ") + m.body; }).join("\n");
  return [
    "Eres el asistente de servicio al cliente de MARKETXONE. Hablas en " + (c.lang_name || "español") + ", con calidez, claro y breve (2 a 6 frases). Eres una IA y lo dices si te preguntan.",
    "Tu objetivo: resolver el caso en este mensaje con información exacta y el siguiente paso concreto. No inventes nada: usa solo las POLÍTICAS, las RESPUESTAS APROBADAS y los DATOS DEL CLIENTE.",
    "",
    "REGLAS:",
    "- Si una RESPUESTA APROBADA resuelve la pregunta, úsala y pon su id en kb_ids.",
    "- Si la pregunta es sobre un pedido, oferta o subasta del cliente, usa sus DATOS (número de pedido, estado, fechas) y da el enlace correspondiente.",
    "- Nunca apruebes ni prometas reembolsos, compensaciones, cambios de reglas ni plazos que no estén en las políticas. Explica el proceso y, si hace falta, escala.",
    "- No des asesoría legal, fiscal ni financiera. No hables mal de otros usuarios ni compartas datos de otras personas.",
    "- Escala (escalate=true) si: piden una persona, hay un posible fraude, una disputa de dinero que requiere decisión, un error técnico que no puedes resolver, amenazas o temas legales, o no tienes la información. Al escalar, dile que el equipo responderá en esta misma conversación.",
    "- Nunca pidas contraseñas, códigos ni números completos de tarjeta.",
    "- actions: hasta 3 botones útiles con label corto y path, solo de esta lista: /pedidos, /pedido/<id>, /ofertas, /mis-subastas, /subastas, /subasta/<id>, /publicar, /subastas/nueva, /ajustes, /panel/pedidos, /carrito, /terminos, /privacidad, /notificaciones, /p/<id>.",
    "",
    "POLÍTICAS:", supportPolicies(c.settings),
    "",
    "RESPUESTAS APROBADAS POR EL EQUIPO (aprendidas):", kb || "(ninguna todavía)",
    "",
    "DATOS DEL CLIENTE (solo de esta persona):", JSON.stringify(c.user || {}).slice(0, 6000),
    "",
    "CONVERSACIÓN:", hist,
    "",
    'Responde SOLO con JSON: {"reply":"","actions":[{"label":"","path":""}],"escalate":false,"escalate_reason":"","confidence":"alta","topic":"pedido|pago|envio|reembolso|subasta|oferta|cuenta|vender|otro","kb_ids":[]}'
  ].join("\n");
}

export function normalizeSupportResult(e: any, kbIds: string[], tr: (s: string) => string = (s) => s): SupportAiResult {
  e = e || {};
  var reply = typeof e.reply === "string" ? e.reply.trim().slice(0, 2000) : "";
  /* Quita promesas que el asistente no puede hacer (reembolsos, garantías). */
  var BAD = /(100\s*%|garantiz|te (vamos a )?reembols|reembolsaremos|te devolveremos|te devolvemos|te compensamos|te compensaremos)/i;
  var parts = reply.split(/(?<=[.!?])\s+/), keep = parts.filter(function (x: string) { return !BAD.test(x); });
  var promised = keep.length < parts.length;
  reply = keep.join(" ").trim();
  var actions = (Array.isArray(e.actions) ? e.actions : []).map(function (a: any) { return { label: String(a && a.label || "").trim().slice(0, 40), path: String(a && a.path || "").trim() }; })
    .filter(function (a: any) { return a.label && SUPPORT_PATHS.test(a.path); }).slice(0, 3);
  var topics = ["pedido", "pago", "envio", "reembolso", "subasta", "oferta", "cuenta", "vender", "otro"];
  return {
    reply: reply || tr("No estoy seguro de cómo ayudarte con esto. Le paso tu caso al equipo para que te responda aquí mismo."),
    actions: actions,
    escalate: !!e.escalate || !reply || (promised && /reembols|devol|compens/i.test(parts.join(" "))),
    escalate_reason: typeof e.escalate_reason === "string" ? e.escalate_reason.slice(0, 300) : "",
    confidence: ["alta", "media", "baja"].indexOf(e.confidence) >= 0 ? e.confidence : "media",
    topic: topics.indexOf(e.topic) >= 0 ? e.topic : "otro",
    kb_ids: (Array.isArray(e.kb_ids) ? e.kb_ids : []).filter(function (x: any) { return kbIds.indexOf(x) >= 0; }).slice(0, 5)
  };
}

