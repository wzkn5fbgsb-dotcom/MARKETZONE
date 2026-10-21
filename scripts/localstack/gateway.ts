// Pasarela local que imita las rutas de un proyecto Supabase:
//   /auth/v1/*      -> Supabase Auth (GoTrue)
//   /rest/v1/*      -> PostgREST
//   /storage/v1/*   -> almacenamiento local que aplica las políticas RLS de storage.objects
//   /functions/v1/* -> Edge Functions (handlers importados directamente)
//   /*              -> web compilada (dist/) para pruebas de extremo a extremo
// SOLO para desarrollo y pruebas. No se despliega.
import { SQL } from "bun";
import { mkdirSync, existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { verifyJwt } from "./jwt.ts";

const ROOT = join(import.meta.dir, "../..");
const PORT = Number(process.env.MZ_GATEWAY_PORT ?? 54321);
const SECRET = process.env.MZ_JWT_SECRET ?? "local-dev-jwt-secret-with-at-least-32-characters";
const AUTH = process.env.MZ_AUTH_URL ?? "http://127.0.0.1:9999";
const REST = process.env.MZ_REST_URL ?? "http://127.0.0.1:3000";
const STORAGE_DIR = process.env.MZ_STORAGE_DIR ?? "/home/claude/localstack/storage";
const DIST = process.env.MZ_DIST_DIR ?? join(ROOT, "dist");
const sql = new SQL(process.env.MZ_PG_URL ?? "postgres://postgres@127.0.0.1:54322/postgres");
mkdirSync(STORAGE_DIR, { recursive: true });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, prefer, range, x-upsert, accept-profile, content-profile",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-expose-headers": "content-range",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });

async function proxy(req: Request, target: string, path: string) {
  const url = new URL(req.url);
  const headers = new Headers(req.headers);
  headers.delete("host");
  const res = await fetch(target + path + url.search, {
    method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer(),
    redirect: "manual",
  });
  const out = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) out.set(k, v);
  out.delete("content-encoding");
  out.delete("content-length");
  return new Response(await res.arrayBuffer(), { status: res.status, headers: out });
}

async function claimsFrom(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  return token ? await verifyJwt(token, SECRET) : null;
}

async function storage(req: Request, path: string) {
  // GET /object/public/<bucket>/<name>
  let m = path.match(/^\/object\/public\/([^/]+)\/(.+)$/);
  if (m && req.method === "GET") {
    const file = Bun.file(normalize(join(STORAGE_DIR, m[1], decodeURIComponent(m[2]))));
    if (!(await file.exists())) return json(404, { error: "not_found" });
    return new Response(file, { headers: { ...CORS, "cache-control": "public, max-age=3600" } });
  }
  m = path.match(/^\/object\/([^/]+)\/(.+)$/);
  if (m && (req.method === "POST" || req.method === "PUT")) {
    const claims = await claimsFrom(req);
    if (!claims) return json(401, { error: "unauthorized", message: "Token inválido" });
    const [bucketId, name] = [m[1], decodeURIComponent(m[2])];
    if (name.includes("..")) return json(400, { error: "invalid_path" });
    const [bucket] = await sql`select * from storage.buckets where id = ${bucketId}`;
    if (!bucket) return json(404, { error: "bucket_not_found" });
    const body = new Uint8Array(await req.arrayBuffer());
    const type = (req.headers.get("content-type") ?? "").split(";")[0];
    if (bucket.allowed_mime_types && !bucket.allowed_mime_types.includes(type)) return json(415, { error: "invalid_mime_type", message: `Tipo no permitido: ${type}` });
    if (bucket.file_size_limit && body.byteLength > Number(bucket.file_size_limit)) return json(413, { error: "payload_too_large" });
    try {
      await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
        await tx.unsafe(`set local role ${claims.role === "service_role" ? "service_role" : claims.role === "authenticated" ? "authenticated" : "anon"}`);
        await tx`insert into storage.objects (bucket_id, name, owner) values (${bucketId}, ${name}, ${claims.sub ?? null})`;
      });
    } catch (e: any) {
      return json(403, { error: "Unauthorized", message: "new row violates row-level security policy", detail: String(e?.message ?? e) });
    }
    const dest = normalize(join(STORAGE_DIR, bucketId, name));
    mkdirSync(dest.substring(0, dest.lastIndexOf("/")), { recursive: true });
    await Bun.write(dest, body);
    return json(200, { Key: `${bucketId}/${name}` });
  }
  return json(404, { error: "not_found" });
}

const functionCache = new Map<string, (req: Request) => Promise<Response>>();
async function edgeFunction(req: Request, name: string) {
  if (!/^[a-z0-9-]+$/.test(name)) return json(404, { error: "not_found" });
  let handler = functionCache.get(name);
  if (!handler) {
    const file = join(ROOT, "supabase/functions", name, "handler.ts");
    if (!existsSync(file)) return json(404, { error: "function_not_found" });
    handler = (await import(file)).handler as (req: Request) => Promise<Response>;
    functionCache.set(name, handler);
  }
  const res = await handler(req);
  const out = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) out.set(k, v);
  return new Response(res.body, { status: res.status, headers: out });
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const p = url.pathname;
    try {
      if (p.startsWith("/auth/v1")) return await proxy(req, AUTH, p.slice("/auth/v1".length) || "/");
      if (p.startsWith("/rest/v1")) return await proxy(req, REST, p.slice("/rest/v1".length) || "/");
      if (p.startsWith("/storage/v1")) return await storage(req, p.slice("/storage/v1".length));
      if (p.startsWith("/functions/v1/")) return await edgeFunction(req, p.split("/")[3] ?? "");
      // Web estática
      const rel = p === "/" ? "/index.html" : p;
      const file = Bun.file(normalize(join(DIST, rel)));
      if (await file.exists()) return new Response(file);
      const index = Bun.file(join(DIST, "index.html"));
      if (await index.exists()) return new Response(index, { headers: { "content-type": "text/html" } });
      return json(404, { error: "not_found" });
    } catch (e: any) {
      return json(502, { error: "gateway_error", message: String(e?.message ?? e) });
    }
  },
});
console.log(`MARKETZONE local gateway en http://127.0.0.1:${PORT}`);
