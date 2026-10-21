// Cliente ligero para Supabase (Auth + PostgREST + Storage + Edge Functions) sin dependencias.
// Solo usa la clave pública "anon": todas las reglas se aplican en el servidor (RLS + funciones).
import { ApiError, FALLBACK_MESSAGES, type AuthApi, type Backend, type Session, type SignUpInput, type UploadResult } from "./backend";

export interface KeyValueStore { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void }

export const browserStore: KeyValueStore = {
  get: (k) => { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } },
  set: (k, v) => { try { globalThis.localStorage?.setItem(k, v); } catch { /* almacenamiento no disponible */ } },
  remove: (k) => { try { globalThis.localStorage?.removeItem(k); } catch { /* almacenamiento no disponible */ } },
};

export function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
}

interface TokenResponse {
  access_token: string; refresh_token: string; expires_in: number; expires_at?: number;
  user: { id: string; email: string };
}

const SESSION_KEY = "mz.session";

function mapAuthError(status: number, body: any): ApiError {
  const code = String(body?.error_code ?? body?.code ?? body?.error ?? "unknown");
  const raw = String(body?.msg ?? body?.error_description ?? body?.message ?? "");
  if (code === "invalid_credentials" || /invalid login/i.test(raw)) return new ApiError("invalid_credentials", FALLBACK_MESSAGES.invalid_credentials, null, status);
  if (code === "user_already_exists" || /already registered/i.test(raw)) return new ApiError("user_already_exists", FALLBACK_MESSAGES.user_already_exists, null, status);
  if (code === "weak_password" || /password/i.test(raw) && /(characters|weak|short)/i.test(raw)) return new ApiError("weak_password", FALLBACK_MESSAGES.weak_password, null, status);
  if (code === "email_not_confirmed") return new ApiError(code, "Confirma tu correo antes de iniciar sesión.", null, status);
  if (status === 429 || code === "over_email_send_rate_limit" || code === "over_request_rate_limit")
    return new ApiError("rate_limited", "Demasiados intentos. Espera unos minutos.", null, status);
  if (code === "validation_failed" || /email/i.test(raw) && /invalid/i.test(raw)) return new ApiError("validation", "Revisa el correo electrónico.", null, status);
  return new ApiError(code, raw || FALLBACK_MESSAGES.unknown, body, status);
}

export class SupabaseBackend implements Backend {
  readonly mode = "supabase" as const;
  readonly auth: AuthApi;
  private session: Session | null = null;
  private listeners = new Set<(s: Session | null) => void>();
  private refreshing: Promise<void> | null = null;

  constructor(private url: string, private anonKey: string, private store: KeyValueStore = browserStore) {
    this.url = url.replace(/\/+$/, "");
    const saved = store.get(SESSION_KEY);
    if (saved) { try { this.session = JSON.parse(saved); } catch { this.session = null; } }
    this.auth = {
      getSession: () => this.session,
      onChange: (cb) => { this.listeners.add(cb); return () => this.listeners.delete(cb); },
      signUp: (i) => this.signUp(i),
      signIn: (e, p) => this.signIn(e, p),
      signOut: () => this.signOut(),
      requestPasswordReset: (e, r) => this.requestPasswordReset(e, r),
      updatePassword: (p) => this.updatePassword(p),
      consumeRedirect: (h) => this.consumeRedirect(h),
    };
  }

  // ------------------------------------------------------------------ auth
  private setSession(s: Session | null) {
    this.session = s;
    if (s) this.store.set(SESSION_KEY, JSON.stringify(s)); else this.store.remove(SESSION_KEY);
    for (const l of this.listeners) l(s);
  }

  private fromToken(t: TokenResponse): Session {
    return {
      user: { id: t.user.id, email: t.user.email },
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: t.expires_at ?? Math.floor(Date.now() / 1000) + t.expires_in,
    };
  }

  private async authFetch(path: string, init: RequestInit & { token?: string } = {}) {
    let res: Response;
    try {
      res = await fetch(`${this.url}/auth/v1${path}`, {
        ...init,
        headers: {
          apikey: this.anonKey,
          "content-type": "application/json",
          authorization: `Bearer ${init.token ?? this.anonKey}`,
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new ApiError("network", FALLBACK_MESSAGES.network, null, 0);
    }
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) throw mapAuthError(res.status, body);
    return body;
  }

  private async signUp(i: SignUpInput) {
    if (i.password.length < 8) throw new ApiError("weak_password", FALLBACK_MESSAGES.weak_password);
    const body = await this.authFetch("/signup", {
      method: "POST",
      body: JSON.stringify({ email: i.email, password: i.password, data: { username: i.username, display_name: i.display_name } }),
    });
    if (body?.access_token) { this.setSession(this.fromToken(body)); return { needsConfirmation: false }; }
    return { needsConfirmation: true };
  }

  private async signIn(email: string, password: string) {
    const body = await this.authFetch("/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
    this.setSession(this.fromToken(body));
  }

  private async signOut() {
    const token = this.session?.access_token;
    this.setSession(null);
    if (token) { try { await this.authFetch("/logout", { method: "POST", token }); } catch { /* la sesión local ya se cerró */ } }
  }

  private async requestPasswordReset(email: string, redirectTo: string) {
    await this.authFetch(`/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { method: "POST", body: JSON.stringify({ email }) });
  }

  private async updatePassword(newPassword: string) {
    if (newPassword.length < 8) throw new ApiError("weak_password", FALLBACK_MESSAGES.weak_password);
    const token = await this.validToken();
    if (!token) throw new ApiError("auth_required", FALLBACK_MESSAGES.auth_required, null, 401);
    await this.authFetch("/user", { method: "PUT", token, body: JSON.stringify({ password: newPassword }) });
  }

  private async consumeRedirect(hash: string): Promise<"recovery" | "signup" | null> {
    // El enlace puede llegar como "#access_token=..." o, con rutas por hash, "#/restablecer#access_token=...".
    const idx = Math.max(hash.lastIndexOf("#"), hash.lastIndexOf("?"));
    const params = new URLSearchParams(hash.slice(idx + 1));
    if (params.get("error")) {
      throw new ApiError("link_expired", "El enlace ha caducado o ya se usó. Solicita uno nuevo.", params.get("error_description"), 400);
    }
    const access = params.get("access_token");
    const refresh = params.get("refresh_token");
    if (!access || !refresh) return null;
    const user = await this.authFetch("/user", { method: "GET", token: access });
    this.setSession({
      user: { id: user.id, email: user.email },
      access_token: access,
      refresh_token: refresh,
      expires_at: Number(params.get("expires_at")) || Math.floor(Date.now() / 1000) + Number(params.get("expires_in") ?? 3600),
    });
    const type = params.get("type");
    return type === "recovery" ? "recovery" : "signup";
  }

  private async validToken(): Promise<string | null> {
    const s = this.session;
    if (!s) return null;
    if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const body = await this.authFetch("/token?grant_type=refresh_token", {
            method: "POST", body: JSON.stringify({ refresh_token: s.refresh_token }),
          });
          this.setSession(this.fromToken(body));
        } catch {
          this.setSession(null);
        } finally {
          this.refreshing = null;
        }
      })();
    }
    await this.refreshing;
    return this.session?.access_token ?? null;
  }

  // ------------------------------------------------------------------ datos
  async rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const token = (await this.validToken()) ?? this.anonKey;
    let res: Response;
    try {
      res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { apikey: this.anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(args),
      });
    } catch {
      throw new ApiError("network", FALLBACK_MESSAGES.network, null, 0);
    }
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      // Errores de negocio: message = código estable, hint = mensaje legible, details = JSON.
      const code = body?.code === "P0001" ? String(body.message) : body?.code === "42501" ? "permission_denied" : String(body?.code ?? "unknown");
      const message = body?.code === "P0001" ? String(body.hint ?? FALLBACK_MESSAGES.unknown)
        : FALLBACK_MESSAGES[code] ?? (res.status === 401 ? FALLBACK_MESSAGES.auth_required : FALLBACK_MESSAGES.unknown);
      let detail: unknown = null;
      if (body?.details) { try { detail = JSON.parse(body.details); } catch { detail = body.details; } }
      if (res.status === 401 && code === "PGRST301") { this.setSession(null); }
      throw new ApiError(code, message, detail, res.status);
    }
    return body as T;
  }

  async uploadImage(file: Blob, opts: { bucket: "product-images" | "media"; ext: string }): Promise<UploadResult> {
    const token = await this.validToken();
    if (!token || !this.session) throw new ApiError("auth_required", FALLBACK_MESSAGES.auth_required, null, 401);
    const rand = Math.random().toString(36).slice(2, 10);
    const path = `${this.session.user.id}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${rand}.${opts.ext}`;
    let res: Response;
    try {
      res = await fetch(`${this.url}/storage/v1/object/${opts.bucket}/${path}`, {
        method: "POST",
        headers: { apikey: this.anonKey, authorization: `Bearer ${token}`, "content-type": file.type || "image/jpeg", "x-upsert": "false" },
        body: file,
      });
    } catch {
      throw new ApiError("network", FALLBACK_MESSAGES.network, null, 0);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (res.status === 413) throw new ApiError("too_large", "La imagen supera el tamaño máximo (8 MB).");
      if (res.status === 415) throw new ApiError("invalid_type", "Formato no admitido. Usa JPG, PNG o WebP.");
      throw new ApiError("upload_failed", "No se pudo subir la imagen.", body, res.status);
    }
    return { url: `${this.url}/storage/v1/object/public/${opts.bucket}/${path}`, path };
  }

  async invokeFunction<T = unknown>(name: string, body: unknown): Promise<T> {
    const token = (await this.validToken()) ?? this.anonKey;
    let res: Response;
    try {
      res = await fetch(`${this.url}/functions/v1/${name}`, {
        method: "POST",
        headers: { apikey: this.anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError("network", FALLBACK_MESSAGES.network, null, 0);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(String(data?.code ?? (res.status === 404 ? "not_configured" : "unknown")),
        String(data?.message ?? (res.status === 404 ? "Esta función todavía no está desplegada en el servidor." : FALLBACK_MESSAGES.unknown)),
        data, res.status);
    }
    return data as T;
  }
}
