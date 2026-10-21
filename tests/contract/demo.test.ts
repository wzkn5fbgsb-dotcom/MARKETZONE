// Ejecuta el MISMO contrato contra el motor de demostración del navegador.
import { DemoEngine } from "../../src/api/demo/engine";
import { DemoBackend, memoryImageStore } from "../../src/api/demo/backend";
import { emptyDB } from "../../src/api/demo/db";
import { memoryStore } from "../../src/api/supabase";
import { MarketApi } from "../../src/api/endpoints";
import { defineContract } from "./scenarios";
import type { Harness } from "./harness";

defineContract(async (): Promise<Harness> => {
  const engine = new DemoEngine(emptyDB(new Date().toISOString()));
  const images = memoryImageStore();
  const past = () => new Date(engine.now().getTime() - 1000).toISOString();
  return {
    name: "demo",
    realStorage: false,
    async newUser(label) {
      const backend = new DemoBackend(engine, memoryStore(), images);
      const email = `${label}@demo.test`;
      await backend.auth.signUp({ email, password: "Password123!", username: label });
      return { api: new MarketApi(backend), userId: backend.auth.getSession()!.user.id, email };
    },
    async makeAdmin(id) { engine.db.profiles.find((p) => p.id === id)!.role = "admin"; },
    async backdateOrder(id) {
      const o = engine.db.orders.find((x) => x.id === id)!;
      o.payment_due_at = past();
      engine.db.reservations.filter((r) => r.order_id === id).forEach((r) => (r.expires_at = past()));
      engine.db.offers.filter((x) => x.order_id === id).forEach((x) => (x.expires_at = past()));
    },
    async backdateOffer(id) { engine.db.offers.find((x) => x.id === id)!.expires_at = past(); },
    async runExpiry() { engine.expireDue(); },
  };
});
