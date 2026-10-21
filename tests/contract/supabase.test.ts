// Ejecuta el contrato contra el stack local tipo Supabase (Postgres + Auth + PostgREST + pasarela).
// Arrancar antes: scripts/localstack/start.sh && scripts/localstack/reset-db.sh
import { SQL } from "bun";
import { SupabaseBackend, memoryStore } from "../../src/api/supabase";
import { MarketApi } from "../../src/api/endpoints";
import { defineContract } from "./scenarios";
import type { Harness } from "./harness";

const URL = process.env.MZ_SUPABASE_URL ?? "http://127.0.0.1:54321";
const PG = process.env.MZ_PG_URL ?? "postgres://postgres@127.0.0.1:54322/postgres";
const keysFile = process.env.MZ_KEYS_FILE ?? "/home/claude/localstack/keys.json";
const { anon } = JSON.parse(await Bun.file(keysFile).text());

defineContract(async (): Promise<Harness> => {
  const sql = new SQL(PG);
  const run = Date.now().toString(36);
  return {
    name: "supabase",
    realStorage: true,
    async newUser(label) {
      const backend = new SupabaseBackend(URL, anon, memoryStore());
      const email = `${label}.${run}@test.dev`;
      await backend.auth.signUp({ email, password: "Password123!", username: `${label}_${run}`.slice(0, 30) });
      const s = backend.auth.getSession();
      if (!s) throw new Error("El registro no devolvió sesión (¿confirmación de correo activada?)");
      return { api: new MarketApi(backend), userId: s.user.id, email };
    },
    async makeAdmin(id) { await sql`update public.profiles set role = 'admin' where id = ${id}`; },
    async backdateOrder(id) {
      await sql`update public.orders set payment_due_at = now() - interval '1 second' where id = ${id}`;
      await sql`update public.reservations set expires_at = now() - interval '1 second' where order_id = ${id}`;
      await sql`update public.offers set expires_at = now() - interval '1 second' where order_id = ${id}`;
    },
    async backdateOffer(id) { await sql`update public.offers set expires_at = now() - interval '1 second' where id = ${id}`; },
    async runExpiry() { await sql`select public.mz_expire_due()`; },
    async rawTableWrite(u, table, id, patch) {
      const token = (u.api.backend as SupabaseBackend).auth.getSession()!.access_token;
      const res = await fetch(`${URL}/rest/v1/${table}?id=eq.${id}`, {
        method: "PATCH",
        headers: { apikey: anon, authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    async close() { await sql.close(); },
  };
});
