// Backend de demostración: cuentas, datos e imágenes viven solo en este dispositivo.
// Las cuentas de demostración NO son autenticación real; la versión con Supabase sí lo es.
import { ApiError, type AuthApi, type Backend, type Session, type SignUpInput, type UploadResult } from "../backend";
import type { KeyValueStore } from "../supabase";
import { DemoEngine } from "./engine";
import { uuid } from "./db";

export interface ImageStore {
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | null>;
}

export function memoryImageStore(): ImageStore {
  const m = new Map<string, Blob>();
  return { put: async (id, b) => void m.set(id, b), get: async (id) => m.get(id) ?? null };
}

/** Proveedor de IA opcional (en la versión publicada en Claude, análisis real con el modelo). */
export interface AiProvider {
  available(): Promise<boolean>;
  invoke(name: string, body: unknown): Promise<unknown>;
}

const SESSION_KEY = "mz.demo.session";

export async function hashPassword(password: string, salt: string) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class DemoBackend implements Backend {
  readonly mode = "demo" as const;
  readonly auth: AuthApi;
  private session: Session | null = null;
  private listeners = new Set<(s: Session | null) => void>();

  constructor(readonly engine: DemoEngine, private store: KeyValueStore, private images: ImageStore, private ai: AiProvider | null = null) {
    const saved = store.get(SESSION_KEY);
    if (saved) {
      try {
        const s = JSON.parse(saved) as Session;
        if (engine.db.profiles.some((p) => p.id === s.user.id)) this.session = s;
      } catch { this.session = null; }
    }
    this.auth = {
      getSession: () => this.session,
      onChange: (cb) => { this.listeners.add(cb); return () => this.listeners.delete(cb); },
      signUp: (i) => this.signUp(i),
      signIn: (e, p) => this.signIn(e, p),
      signOut: async () => this.setSession(null),
      requestPasswordReset: async () => {
        throw new ApiError("demo_no_email", "En la versión de demostración no se envían correos. Entra con una cuenta de prueba o crea una nueva.");
      },
      updatePassword: (p) => this.updatePassword(p),
      consumeRedirect: async () => null,
    };
  }

  private setSession(s: Session | null) {
    this.session = s;
    if (s) this.store.set(SESSION_KEY, JSON.stringify(s)); else this.store.remove(SESSION_KEY);
    for (const l of this.listeners) l(s);
  }

  private sessionFor(userId: string, email: string): Session {
    return { user: { id: userId, email }, access_token: "demo", refresh_token: "demo", expires_at: Math.floor(Date.now() / 1000) + 365 * 86400 };
  }

  private async signUp(i: SignUpInput) {
    const email = i.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError("validation", "Revisa el correo electrónico.");
    if (i.password.length < 8) throw new ApiError("weak_password", "La contraseña debe tener al menos 8 caracteres.");
    const salt = uuid();
    const id = this.engine.registerUser({ email, salt, hash: await hashPassword(i.password, salt), username: i.username, display_name: i.display_name });
    this.setSession(this.sessionFor(id, email));
    return { needsConfirmation: false };
  }

  async signIn(email: string, password: string) {
    const e = email.trim().toLowerCase();
    const cred = this.engine.db.credentials.find((c) => c.email === e);
    if (!cred || (await hashPassword(password, cred.salt)) !== cred.hash) throw new ApiError("invalid_credentials", "Correo o contraseña incorrectos.");
    const prof = this.engine.db.profiles.find((p) => p.id === cred.user_id);
    if (prof?.status === "suspended") throw new ApiError("account_suspended", "Tu cuenta está suspendida.");
    this.setSession(this.sessionFor(cred.user_id, e));
  }

  /** Acceso directo a una cuenta de demostración (sin contraseña), solo para probar roles. */
  signInAs(userId: string) {
    const cred = this.engine.db.credentials.find((c) => c.user_id === userId);
    if (!cred) throw new ApiError("not_found", "Cuenta de demostración no encontrada.");
    this.setSession(this.sessionFor(userId, cred.email));
  }

  private async updatePassword(p: string) {
    if (!this.session) throw new ApiError("auth_required", "Inicia sesión para continuar.");
    if (p.length < 8) throw new ApiError("weak_password", "La contraseña debe tener al menos 8 caracteres.");
    const salt = uuid();
    this.engine.setPasswordHash(this.session.user.id, salt, await hashPassword(p, salt));
  }

  async rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    // Simula la naturaleza asíncrona de la red sin retrasos artificiales.
    await Promise.resolve();
    return this.engine.call<T>(fn, args, this.session?.user.id ?? null);
  }

  async uploadImage(file: Blob, _opts: { bucket: "product-images" | "media"; ext: string }): Promise<UploadResult> {
    if (!this.session) throw new ApiError("auth_required", "Inicia sesión para continuar.");
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new ApiError("invalid_type", "Formato no admitido. Usa JPG, PNG o WebP.");
    if (file.size > 8 * 1024 * 1024) throw new ApiError("too_large", "La imagen supera el tamaño máximo (8 MB).");
    const id = `${this.session.user.id}/${uuid()}`;
    await this.images.put(id, file);
    return { url: `mzimg:${id}`, path: id };
  }

  getImage(id: string) { return this.images.get(id); }

  async invokeFunction<T = unknown>(name: string, body: unknown): Promise<T> {
    if (!this.session) throw new ApiError("auth_required", "Inicia sesión para continuar.");
    if (!this.ai || !(await this.ai.available())) {
      throw new ApiError("ai_not_configured",
        "La IA no está disponible en esta versión. Completa la publicación manualmente; tus datos no se pierden.", null, 503);
    }
    return (await this.ai.invoke(name, body)) as T;
  }
}
