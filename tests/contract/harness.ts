// Arnés común para ejecutar los mismos escenarios contra Supabase (local) y contra el motor demo.
import { MarketApi } from "../../src/api/endpoints";

export interface TestUser { api: MarketApi; userId: string; email: string }

export interface Harness {
  name: string;
  /** Si el backend sube imágenes reales (Supabase Storage). */
  realStorage: boolean;
  newUser(label: string): Promise<TestUser>;
  makeAdmin(userId: string): Promise<void>;
  backdateOrder(orderId: string): Promise<void>;
  backdateOffer(offerId: string): Promise<void>;
  runExpiry(): Promise<void>;
  /** Acceso directo a tablas (solo Supabase) para comprobar que se rechaza. */
  rawTableWrite?(user: TestUser, table: string, id: string, patch: Record<string, unknown>): Promise<{ status: number; body: any }>;
  close?(): Promise<void>;
}

export const PNG_1PX = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

export async function uploadTestImage(u: TestUser) {
  return u.api.backend.uploadImage(new Blob([PNG_1PX], { type: "image/png" }), { bucket: "product-images", ext: "png" });
}

export async function addressFor(u: TestUser) {
  return u.api.saveAddress({ full_name: "Ana Pérez", line1: "123 Main St", city: "Los Angeles", region: "CA", postal_code: "90012", country: "US" });
}

export function hoodieListing(images: { url: string; storage_path?: string | null }[], stock: Record<string, number> = { S: 2, M: 3, L: 1 }) {
  return {
    category_id: "ropa-sudaderas",
    title: "Sudadera Adidas negra",
    description: "Sudadera con capucha, algodón. Prueba automatizada.",
    brand: "Adidas",
    condition: "new_with_tags" as const,
    color: "Negro",
    price_cents: 3500,
    tags: ["sudadera", "adidas", "negro"],
    offers_enabled: true,
    status: "active" as const,
    images,
    variants: Object.entries(stock).map(([size, qty]) => ({ size, color: "Negro", stock_on_hand: qty })),
  };
}

export async function expectApiError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e: any) {
    if (e?.code !== code) throw new Error(`Se esperaba el error "${code}" pero llegó "${e?.code}": ${e?.message}`);
    return e;
  }
  throw new Error(`Se esperaba el error "${code}" pero la operación se completó`);
}
