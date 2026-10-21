import { useState, type FormEvent } from "react";
import { useApp } from "../app/state";
import { Link, navigate, useLocation } from "../app/router";
import { Page } from "../components/layout";
import { Logo } from "../components/brand";
import { Button, Callout, ErrorBox, Field, Input } from "../ui/kit";
import { ApiError } from "../api/backend";
import { DemoBackend } from "../api/demo/backend";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../api/demo/seed";

function useNext() {
  const loc = useLocation();
  const n = loc.query.get("next");
  return n && n.startsWith("/") && !n.startsWith("/entrar") ? n : "/";
}

function AuthShell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <Page narrow>
      <div className="stack-lg" style={{ maxWidth: 440, margin: "12px auto 0" }}>
        <Logo size={34} />
        <div className="stack" style={{ gap: 6 }}><h1 className="h1">{title}</h1>{sub && <span className="muted">{sub}</span>}</div>
        {children}
      </div>
    </Page>
  );
}

function DemoAccounts() {
  const { backend, config } = useApp();
  const next = useNext();
  if (config.mode !== "demo" || !(backend instanceof DemoBackend)) return null;
  const users = backend.engine.db.credentials;
  const go = (email: string) => {
    const c = users.find((u) => u.email === email);
    if (c) { backend.signInAs(c.user_id); navigate(next); }
  };
  return (
    <div className="panel stack">
      <span className="eyebrow">Cuentas de demostración</span>
      <span className="small muted">Prueba los distintos papeles sin crear cuenta. Contraseña de todas: <span className="mono">{DEMO_PASSWORD}</span></span>
      <div className="stack" style={{ gap: 8 }}>
        <Button variant="dark" block onClick={() => go(DEMO_ACCOUNTS.buyer.email)}>Entrar como comprador</Button>
        <Button variant="dark" block onClick={() => go(DEMO_ACCOUNTS.seller.email)}>Entrar como vendedor (con tienda e inventario)</Button>
        <Button variant="dark" block onClick={() => go(DEMO_ACCOUNTS.admin.email)}>Entrar como administrador</Button>
      </div>
      <Callout>Las cuentas de la demo se guardan solo en este dispositivo y no son autenticación real. La versión conectada a Supabase usa cuentas reales con contraseña cifrada y recuperación por correo.</Callout>
    </div>
  );
}

export function Login() {
  const { backend } = useApp();
  const next = useNext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await backend.auth.signIn(email.trim(), password); navigate(next, { replace: true }); }
    catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Entrar" sub="Compra, vende y gestiona tu tienda con la misma cuenta.">
      <form className="stack" onSubmit={submit}>
        <Field label="Correo electrónico"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Contraseña"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <ErrorBox error={error} />
        <Button variant="primary" size="lg" block loading={busy} type="submit">Entrar</Button>
        <div className="row between small"><Link to="/recuperar" className="link">¿Olvidaste tu contraseña?</Link><Link to={`/registro?next=${encodeURIComponent(next)}`} className="link">Crear cuenta</Link></div>
      </form>
      <DemoAccounts />
    </AuthShell>
  );
}

export function Register() {
  const { backend } = useApp();
  const next = useNext();
  const [f, setF] = useState({ email: "", password: "", display_name: "", username: "" });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await backend.auth.signUp({ email: f.email.trim(), password: f.password, display_name: f.display_name.trim(), username: f.username.trim().toLowerCase() || undefined });
      if (r.needsConfirmation) setSent(true); else navigate(next, { replace: true });
    } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  };
  if (sent) return <AuthShell title="Revisa tu correo" sub={`Te enviamos un enlace de confirmación a ${f.email}. Ábrelo para activar tu cuenta.`}><Link to="/entrar" className="btn btn-outline">Ya la confirmé: entrar</Link></AuthShell>;
  return (
    <AuthShell title="Crear cuenta" sub="Una sola cuenta para comprar y vender.">
      <form className="stack" onSubmit={submit}>
        <Field label="Nombre visible" required><Input required maxLength={60} value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
        <Field label="Nombre de usuario" hint="Minúsculas, números, punto o guion bajo. Se usa en tu tienda."><Input value={f.username} pattern="[a-z0-9_.]{3,30}" onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} /></Field>
        <Field label="Correo electrónico" required><Input type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Contraseña" required hint="Mínimo 8 caracteres."><Input type="password" autoComplete="new-password" minLength={8} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <ErrorBox error={error} />
        <Button variant="primary" size="lg" block loading={busy} type="submit">Crear cuenta</Button>
        <span className="small dim">Al crear la cuenta confirmas que tienes 18 años o más y aceptas los <Link to="/terminos" className="link">Términos de uso</Link> y el <Link to="/privacidad" className="link">Aviso de privacidad</Link>.</span>
        <Link to="/entrar" className="link small">Ya tengo cuenta</Link>
      </form>
    </AuthShell>
  );
}

export function Forgot() {
  const { backend, config } = useApp();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const base = location.href.split("#")[0];
      await backend.auth.requestPasswordReset(email.trim(), config.router === "hash" ? `${base}#/restablecer` : `${location.origin}/restablecer`);
      setDone(true);
    } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Recuperar contraseña" sub="Te enviaremos un enlace para crear una nueva contraseña.">
      {done ? <Callout kind="ok">Si existe una cuenta con <b>{email}</b>, recibirás un correo con el enlace en unos minutos.</Callout> : (
        <form className="stack" onSubmit={submit}>
          <Field label="Correo electrónico"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <ErrorBox error={error} />
          <Button variant="primary" size="lg" block loading={busy} type="submit">Enviar enlace</Button>
        </form>
      )}
      <Link to="/entrar" className="link small">Volver a entrar</Link>
    </AuthShell>
  );
}

export function ResetPassword() {
  const { backend, session } = useApp();
  const [pw, setPw] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await backend.auth.updatePassword(pw); setDone(true); } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  };
  if (!session) return <AuthShell title="Enlace no válido" sub="Abre el enlace del correo de recuperación en este navegador o solicita uno nuevo."><Link to="/recuperar" className="btn btn-outline">Solicitar enlace</Link></AuthShell>;
  return (
    <AuthShell title="Nueva contraseña">
      {done ? <><Callout kind="ok">Contraseña actualizada.</Callout><Link to="/" className="btn btn-primary">Ir al inicio</Link></> : (
        <form className="stack" onSubmit={submit}>
          <Field label="Nueva contraseña" hint="Mínimo 8 caracteres."><Input type="password" autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <ErrorBox error={error} />
          <Button variant="primary" size="lg" block loading={busy} type="submit">Guardar contraseña</Button>
        </form>
      )}
    </AuthShell>
  );
}
