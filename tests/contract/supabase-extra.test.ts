// Pruebas específicas de la integración con Supabase: almacenamiento, correo de recuperación y concurrencia alta.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { SQL } from "bun";
import { readdirSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { SupabaseBackend, memoryStore } from "../../src/api/supabase";
import { MarketApi } from "../../src/api/endpoints";
import { PNG_1PX, addressFor, hoodieListing, type TestUser } from "./harness";

const URL = process.env.MZ_SUPABASE_URL ?? "http://127.0.0.1:54321";
const PG = process.env.MZ_PG_URL ?? "postgres://postgres@127.0.0.1:54322/postgres";
const MAIL_DIR = process.env.MZ_MAIL_DIR ?? "/home/claude/localstack/mail";
const { anon } = JSON.parse(await Bun.file(process.env.MZ_KEYS_FILE ?? "/home/claude/localstack/keys.json").text());
const run = Date.now().toString(36);
const sql = new SQL(PG);

async function user(label: string): Promise<TestUser & { backend: SupabaseBackend }> {
  const backend = new SupabaseBackend(URL, anon, memoryStore());
  const email = `${label}.${run}@test.dev`;
  await backend.auth.signUp({ email, password: "Password123!", username: `${label}_${run}`.slice(0, 30) });
  return { api: new MarketApi(backend), backend, userId: backend.auth.getSession()!.user.id, email };
}

afterAll(async () => { await sql.close(); });

describe("Almacenamiento", () => {
  test("cada usuario solo puede subir a su propia carpeta", async () => {
    const a = await user("stora");
    const b = await user("storb");
    const ok = await a.backend.uploadImage(new Blob([PNG_1PX], { type: "image/png" }), { bucket: "product-images", ext: "png" });
    expect(ok.path.startsWith(a.userId + "/")).toBe(true);
    const pub = await fetch(ok.url);
    expect(pub.status).toBe(200);
    const token = b.backend.auth.getSession()!.access_token;
    const res = await fetch(`${URL}/storage/v1/object/product-images/${a.userId}/intruso.png`, {
      method: "POST", headers: { apikey: anon, authorization: `Bearer ${token}`, "content-type": "image/png" }, body: PNG_1PX,
    });
    expect(res.status).toBe(403);
    const anonRes = await fetch(`${URL}/storage/v1/object/product-images/${a.userId}/anon.png`, {
      method: "POST", headers: { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "image/png" }, body: PNG_1PX,
    });
    expect(anonRes.status).toBe(403);
    await expect(a.backend.uploadImage(new Blob(["x"], { type: "application/pdf" }), { bucket: "product-images", ext: "pdf" })).rejects.toMatchObject({ code: "invalid_type" });
  });
});

describe("Cuentas", () => {
  test("recuperación de contraseña por correo y cambio de contraseña", async () => {
    rmSync(MAIL_DIR, { recursive: true, force: true });
    mkdirSync(MAIL_DIR, { recursive: true });
    const u = await user("recover");
    await u.backend.auth.signOut();
    const visitor = new SupabaseBackend(URL, anon, memoryStore());
    await visitor.auth.requestPasswordReset(u.email, "http://127.0.0.1:54321/#/restablecer");
    let mail = "";
    for (let i = 0; i < 40 && !mail; i++) {
      const files = readdirSync(MAIL_DIR);
      if (files.length) mail = readFileSync(`${MAIL_DIR}/${files[0]}`, "utf8");
      else await Bun.sleep(100);
    }
    expect(mail).toContain(u.email);
    const decoded = mail.replace(/=\r?\n/g, "").replace(/=3D/g, "=").replace(/&amp;/g, "&");
    const link = decoded.match(/https?:\/\/[^\s"<>]+verify\?[^\s"<>]+/)?.[0];
    expect(link).toBeTruthy();
    // Sigue el enlace de verificación: redirige con los tokens en el fragmento (#access_token=...&type=recovery)
    const res = await fetch(link!, { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("access_token=");
    const kind = await visitor.auth.consumeRedirect(location.slice(location.indexOf("#")));
    expect(kind).toBe("recovery");
    await visitor.auth.updatePassword("NuevaClave456!");
    const fresh = new SupabaseBackend(URL, anon, memoryStore());
    await expect(fresh.auth.signIn(u.email, "Password123!")).rejects.toMatchObject({ code: "invalid_credentials" });
    await fresh.auth.signIn(u.email, "NuevaClave456!");
    expect(fresh.auth.getSession()?.user.id).toBe(u.userId);
  });

  test("el rol de administrador no se puede obtener desde el navegador", async () => {
    const u = await user("escalate");
    await expect(u.api.updateProfile({ role: "admin" } as any)).resolves.toBeTruthy();
    const acc = await u.api.account();
    expect(acc.is_admin).toBe(false);
    await expect(u.api.adminOverview()).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("Concurrencia", () => {
  test("10 compradores simultáneos contra 3 unidades: exactamente 3 pedidos", async () => {
    const seller = await user("cseller");
    const up = await seller.backend.uploadImage(new Blob([PNG_1PX], { type: "image/png" }), { bucket: "product-images", ext: "png" });
    const id = (await seller.api.saveListing({ ...hoodieListing([{ url: up.url }], { M: 3 }), title: "Drop limitado" })).id;
    const buyers = await Promise.all(Array.from({ length: 10 }, (_, i) => user(`cb${i}`)));
    const variantId = (await buyers[0].api.product(id)).variants[0].id;
    const addresses = await Promise.all(buyers.map((b) => addressFor(b)));
    await Promise.all(buyers.map((b) => b.api.cartAdd(variantId, 1)));
    const results = await Promise.allSettled(buyers.map((b, i) => b.api.checkout(addresses[i].id)));
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok.length).toBe(3);
    const [row] = await sql`select stock_on_hand, stock_reserved from public.product_variants where id = ${variantId}`;
    expect(row.stock_reserved).toBe(3);
    expect(row.stock_on_hand).toBe(3);
    // Todos pagan a la vez: stock final 0, nunca negativo
    const winners = buyers.filter((_, i) => results[i].status === "fulfilled");
    await Promise.all(winners.map((b, i) => b.api.payTest((ok[i] as PromiseFulfilledResult<any>).value.order_id).catch(() => null)));
    const paidOrders = await Promise.all(winners.map((b) => b.api.orders()));
    expect(paidOrders.flat().filter((o) => o.status === "paid").length).toBe(3);
    const [after] = await sql`select stock_on_hand, stock_reserved from public.product_variants where id = ${variantId}`;
    expect(after.stock_on_hand).toBe(0);
    expect(after.stock_reserved).toBe(0);
  }, 30000);
});
