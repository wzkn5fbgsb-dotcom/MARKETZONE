import { t } from "../i18n";
// Contrato común de backend. Hay dos implementaciones:
//  - SupabaseBackend: producción (Auth + PostgREST + Storage + Edge Functions de Supabase)
//  - DemoBackend: motor local en el navegador con las mismas reglas, para la versión de demostración.

export interface SessionUser { id: string; email: string }
export interface Session { user: SessionUser; access_token: string; refresh_token: string; expires_at: number }

export interface SignUpInput { email: string; password: string; username?: string; display_name?: string }

export interface AuthApi {
  getSession(): Session | null;
  onChange(cb: (s: Session | null) => void): () => void;
  signUp(input: SignUpInput): Promise<{ needsConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string, redirectTo: string): Promise<void>;
  updatePassword(newPassword: string): Promise<void>;
  /** Procesa enlaces de correo (#access_token=...&type=recovery). Devuelve el tipo detectado. */
  consumeRedirect(hash: string): Promise<"recovery" | "signup" | null>;
}

export interface UploadResult { url: string; path: string }

export interface Backend {
  readonly mode: "supabase" | "demo";
  readonly auth: AuthApi;
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>;
  uploadImage(file: Blob, opts: { bucket: "product-images" | "media"; ext: string }): Promise<UploadResult>;
  invokeFunction<T = unknown>(name: string, body: unknown): Promise<T>;
}

export class ApiError extends Error {
  code: string;
  detail: unknown;
  status: number;
  constructor(code: string, message: string, detail?: unknown, status = 400) {
    super(t(message)); // los mensajes del servidor vienen en español; se muestran en el idioma elegido
    this.name = "ApiError";
    this.code = code;
    this.detail = detail ?? null;
    this.status = status;
  }
}

/** Mensajes en español para errores comunes sin mensaje propio. */
export const FALLBACK_MESSAGES: Record<string, string> = {
  auth_required: t("Inicia sesión para continuar."),
  network: t("No hay conexión con el servidor. Revisa tu conexión e inténtalo de nuevo."),
  invalid_credentials: t("Correo o contraseña incorrectos."),
  user_already_exists: t("Ya existe una cuenta con ese correo."),
  weak_password: t("La contraseña debe tener al menos 8 caracteres."),
  permission_denied: t("No tienes permiso para realizar esta acción."),
  not_configured: t("Esta función no está configurada todavía."),
  unknown: t("Algo salió mal. Inténtalo de nuevo."),
};
