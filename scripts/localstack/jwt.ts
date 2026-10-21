// Utilidades JWT HS256 (solo para el entorno local de pruebas).
const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof buf === "string" ? enc.encode(buf) : new Uint8Array(buf as ArrayBuffer);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string) => {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
};
async function key(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signJwt(payload: Record<string, unknown>, secret: string) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
export async function verifyJwt(token: string, secret: string): Promise<Record<string, any> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const sigBytes = Uint8Array.from(fromB64url(parts[2]), (c) => c.charCodeAt(0));
  const ok = await crypto.subtle.verify("HMAC", await key(secret), sigBytes, enc.encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  const payload = JSON.parse(fromB64url(parts[1]));
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return payload;
}
