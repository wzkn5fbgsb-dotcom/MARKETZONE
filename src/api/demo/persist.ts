// Persistencia de la demo en IndexedDB (con respaldo en memoria si el navegador no lo permite).
import { DemoEngine } from "./engine";
import { buildSeedDB } from "./seed";
import { memoryImageStore, type ImageStore } from "./backend";
import type { DemoDB } from "./db";

const DB_NAME = "marketxone-demo";
const SEED_VERSION = 4;

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("state")) d.createObjectStore("state");
        if (!d.objectStoreNames.contains("images")) d.createObjectStore("images");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

function get<T>(d: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const r = d.transaction(store, "readonly").objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result as T);
      r.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

function put(d: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = d.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}

function clear(d: IDBDatabase, store: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = d.transaction(store, "readwrite");
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}

export interface DemoRuntime { engine: DemoEngine; images: ImageStore; persistent: boolean; reset(): Promise<void> }

export async function openDemo(): Promise<DemoRuntime> {
  const d = await idb();
  let saved: { version: number; db: DemoDB } | undefined = d ? await get(d, "state", "db") : undefined;
  if (!saved || saved.version !== SEED_VERSION) {
    saved = { version: SEED_VERSION, db: await buildSeedDB() };
    if (d) { await clear(d, "images"); await put(d, "state", "db", saved); }
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = (db: DemoDB) => {
    if (!d) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void put(d, "state", "db", { version: SEED_VERSION, db }); }, 250);
  };
  const engine = new DemoEngine(saved.db, save);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && timer && d) { clearTimeout(timer); timer = null; void put(d, "state", "db", { version: SEED_VERSION, db: engine.db }); }
    });
  }
  const images: ImageStore = d
    ? { put: (id, blob) => put(d, "images", id, blob), get: async (id) => (await get<Blob>(d, "images", id)) ?? null }
    : memoryImageStore();
  return {
    engine, images, persistent: !!d,
    async reset() {
      engine.db = await buildSeedDB();
      if (d) { await clear(d, "images"); await put(d, "state", "db", { version: SEED_VERSION, db: engine.db }); }
    },
  };
}
