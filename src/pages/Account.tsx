import { useState, type FormEvent } from "react";
import { useApp } from "../app/state";
import { invalidate, useAction, useQuery } from "../app/query";
import { Link, navigate } from "../app/router";
import { ago, slugify } from "../app/format";
import type { Address } from "../api/types";
import { ProductGrid } from "../components/product";
import { Page, ThemePicker } from "../components/layout";
import { Avatar, Badge, Button, Callout, ConfirmButton, Empty, ErrorBox, Field, Img, Input, Select, Spinner, TextArea, useToast } from "../ui/kit";
import { Icon, type IconName } from "../ui/icons";
import { compressImage } from "../app/images";
import { DemoBackend } from "../api/demo/backend";
import { DEMO_ACCOUNTS } from "../api/demo/seed";

export function NeedLogin({ next }: { next: string }) {
  return (
    <Page narrow>
      <Empty icon="user" title="Inicia sesión para continuar" action={<Link to={`/entrar?next=${encodeURIComponent(next)}`} className="btn btn-primary">Entrar</Link>}>
        Necesitas una cuenta para acceder a esta sección.
      </Empty>
    </Page>
  );
}

export function Profile() {
  const { session, account, backend, config, demo } = useApp();
  const toast = useToast();
  if (!session) return <NeedLogin next="/perfil" />;
  if (!account) return <Page><Spinner /></Page>;
  const p = account.profile;
  const store = account.stores[0];
  const links: [string, IconName, string, string?][] = [
    ["/pedidos", "box", "Mis pedidos"],
    ["/ofertas", "offer", "Mis ofertas", "Enviadas y recibidas"],
    ["/favoritos", "heart", "Favoritos"],
    ["/notificaciones", "bell", "Notificaciones", account.unread_notifications ? `${account.unread_notifications} sin leer` : undefined],
    ["/panel", "chart", "Panel de vendedor", "Catálogo, inventario, pedidos y estadísticas"],
    ["/publicar", "plus", "Publicar un producto"],
    ["/promociona", "megaphone", "Promociona tu negocio"],
    ["/ajustes", "settings", "Ajustes", "Perfil, direcciones, tienda y contraseña"],
  ];
  if (account.is_admin) links.push(["/admin", "shield", "Administración"]);
  links.push(["/estado", "info", "Estado del proyecto"]);
  const switchTo = (email: string) => {
    if (!(backend instanceof DemoBackend)) return;
    const c = backend.engine.db.credentials.find((x) => x.email === email);
    if (c) { backend.signInAs(c.user_id); toast("Cambiaste de cuenta de demostración", "ok"); }
  };
  return (
    <Page narrow>
      <div className="stack-lg">
        <div className="row-nw" style={{ gap: 14 }}>
          <Avatar name={p.display_name} src={p.avatar_url} size="lg" />
          <div className="stack grow" style={{ gap: 3 }}>
            <h1 className="h2">{p.display_name}</h1>
            <span className="small dim">@{p.username} · {account.email}</span>
            <div className="row" style={{ gap: 6 }}>{account.is_admin && <Badge kind="accent">Admin</Badge>}{store && <Link to={`/tienda/${store.slug}`} className="link small">Ver mi tienda</Link>}</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {links.map(([to, icon, label, sub]) => (
            <Link key={to} to={to} className="list-link"><Icon name={icon} size={20} /><span className="grow stack" style={{ gap: 0 }}><span>{label}</span>{sub && <span className="small dim">{sub}</span>}</span><Icon name="chevron" size={18} /></Link>
          ))}
        </nav>
        {config.mode === "demo" && (
          <div className="panel stack">
            <span className="eyebrow">Demo: probar como otro usuario</span>
            <span className="small muted">Para probar ofertas entre comprador y vendedor, cambia de cuenta aquí.</span>
            <div className="row">
              <Button size="sm" variant="dark" onClick={() => switchTo(DEMO_ACCOUNTS.buyer.email)}>Comprador</Button>
              <Button size="sm" variant="dark" onClick={() => switchTo(DEMO_ACCOUNTS.seller.email)}>Vendedor</Button>
              <Button size="sm" variant="dark" onClick={() => switchTo(DEMO_ACCOUNTS.admin.email)}>Admin</Button>
            </div>
            {demo && <ConfirmButton confirmLabel="Sí, restablecer" onConfirm={async () => { await demo.reset(); location.reload(); }}>Restablecer datos de la demo</ConfirmButton>}
          </div>
        )}
        <Button variant="outline" icon="logout" onClick={async () => { await backend.auth.signOut(); navigate("/"); }}>Cerrar sesión</Button>
      </div>
    </Page>
  );
}

export function Favorites() {
  const { api, session } = useApp();
  const res = useQuery(session ? "favorites" : null, () => api.favorites());
  if (!session) return <NeedLogin next="/favoritos" />;
  return (
    <Page>
      <div className="stack-lg">
        <h1 className="h1">Favoritos</h1>
        <ErrorBox error={res.error} onRetry={res.reload} />
        {res.loading ? <Spinner /> : res.data?.length ? <ProductGrid items={res.data} /> :
          <Empty icon="heart" title="Aún no guardaste nada" action={<Link to="/categorias" className="btn btn-outline">Ver categorías</Link>}>Toca el corazón en cualquier producto para guardarlo aquí.</Empty>}
      </div>
    </Page>
  );
}

export function Notifications() {
  const { api, session, reloadAccount } = useApp();
  const res = useQuery(session ? "notifications" : null, () => api.notifications());
  const markAll = useAction(() => api.markNotificationsRead(null), { invalidates: ["notifications"], onSuccess: () => reloadAccount() });
  if (!session) return <NeedLogin next="/notificaciones" />;
  return (
    <Page narrow>
      <div className="stack-lg">
        <div className="row between"><h1 className="h1">Notificaciones</h1>
          {!!res.data?.some((n) => !n.read_at) && <Button size="sm" variant="outline" loading={markAll.pending} onClick={() => void markAll.run()}>Marcar todo como leído</Button>}</div>
        {res.loading ? <Spinner /> : res.data?.length ? (
          <div className="stack" style={{ gap: 8 }}>{res.data.map((n) => (
            <Link key={n.id} to={n.link ?? "/"} className="panel row-nw" style={{ gap: 12, padding: 14, borderColor: n.read_at ? undefined : "rgba(220,20,60,.4)" }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, flex: "none", background: n.read_at ? "transparent" : "var(--crimson)" }} />
              <span className="stack grow" style={{ gap: 2 }}><b style={{ fontWeight: 600 }}>{n.title}</b>{n.body && <span className="small muted">{n.body}</span>}</span>
              <span className="tiny dim" style={{ whiteSpace: "nowrap" }}>{ago(n.created_at)}</span>
            </Link>
          ))}</div>
        ) : <Empty icon="bell" title="Sin notificaciones">Aquí verás ofertas, ventas, pedidos y avisos de moderación.</Empty>}
      </div>
    </Page>
  );
}

export function AddressForm({ initial, onSaved, onCancel }: { initial?: Partial<Address>; onSaved: (a: Address) => void; onCancel?: () => void }) {
  const { api, reloadAccount } = useApp();
  const [f, setF] = useState<Partial<Address>>({ country: "US", ...initial });
  const save = useAction(() => api.saveAddress(f), { onSuccess: (a) => { reloadAccount(); onSaved(a); } });
  const set = (k: keyof Address) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Nombre completo" required><Input required value={f.full_name ?? ""} onChange={set("full_name")} autoComplete="name" /></Field>
      <Field label="Dirección" required><Input required value={f.line1 ?? ""} onChange={set("line1")} autoComplete="address-line1" /></Field>
      <Field label="Apartamento, suite (opcional)"><Input value={f.line2 ?? ""} onChange={set("line2")} autoComplete="address-line2" /></Field>
      <div className="grid-2">
        <Field label="Ciudad" required><Input required value={f.city ?? ""} onChange={set("city")} autoComplete="address-level2" /></Field>
        <Field label="Estado / región" required><Input required value={f.region ?? ""} onChange={set("region")} autoComplete="address-level1" /></Field>
        <Field label="Código postal" required><Input required value={f.postal_code ?? ""} onChange={set("postal_code")} autoComplete="postal-code" inputMode="numeric" /></Field>
        <Field label="País (código)"><Input value={f.country ?? "US"} maxLength={2} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} autoComplete="country" /></Field>
      </div>
      <Field label="Teléfono (opcional, para la etiqueta de envío)"><Input value={f.phone ?? ""} onChange={set("phone")} type="tel" autoComplete="tel" /></Field>
      <ErrorBox error={save.error} />
      <div className="row"><Button variant="primary" type="submit" loading={save.pending}>Guardar dirección</Button>{onCancel && <Button variant="ghost" type="button" onClick={onCancel}>Cancelar</Button>}</div>
    </form>
  );
}

export function Settings() {
  const { session, account } = useApp();
  if (!session) return <NeedLogin next="/ajustes" />;
  if (!account) return <Page><Spinner /></Page>;
  return (
    <Page narrow>
      <div className="stack-xl">
        <h1 className="h1">Ajustes</h1>
        <section className="stack">
          <h2 className="h3">Apariencia</h2>
          <span className="small muted">Automático usa el mismo modo que tu teléfono o computadora.</span>
          <ThemePicker />
        </section>
        <ProfileForm />
        <Addresses />
        <StoreSettings />
        <PasswordForm />
      </div>
    </Page>
  );
}

function ProfileForm() {
  const { api, account, backend, reloadAccount } = useApp();
  const toast = useToast();
  const p = account!.profile;
  const [f, setF] = useState({ display_name: p.display_name, username: p.username, bio: p.bio ?? "", avatar_url: p.avatar_url ?? "" });
  const [uploading, setUploading] = useState(false);
  const save = useAction(() => api.updateProfile(f), { onSuccess: () => { toast("Perfil actualizado", "ok"); reloadAccount(); } });
  const onAvatar = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try { const up = await backend.uploadImage(await compressImage(file, 600, 0.85), { bucket: "media", ext: "jpg" }); setF((x) => ({ ...x, avatar_url: up.url })); }
    catch (e: any) { toast(e.message, "bad"); } finally { setUploading(false); }
  };
  return (
    <section className="stack">
      <span className="eyebrow">Perfil</span>
      <form className="panel stack" onSubmit={(e: FormEvent) => { e.preventDefault(); void save.run(); }}>
        <div className="row-nw" style={{ gap: 14 }}>
          <Avatar name={f.display_name} src={f.avatar_url || null} size="lg" />
          <label className="btn btn-outline btn-sm">{uploading ? <span className="spin" /> : <Icon name="camera" size={16} />}Cambiar foto
            <input type="file" accept="image/*" hidden onChange={(e) => void onAvatar(e.target.files?.[0])} /></label>
        </div>
        <Field label="Nombre visible"><Input value={f.display_name} maxLength={60} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
        <Field label="Nombre de usuario"><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} /></Field>
        <Field label="Biografía"><TextArea value={f.bio} maxLength={500} onChange={(e) => setF({ ...f, bio: e.target.value })} /></Field>
        <ErrorBox error={save.error} />
        <div><Button variant="primary" type="submit" loading={save.pending}>Guardar perfil</Button></div>
      </form>
    </section>
  );
}

function Addresses() {
  const { api, account, reloadAccount } = useApp();
  const [editing, setEditing] = useState<Partial<Address> | null>(null);
  const del = useAction((id: string) => api.deleteAddress(id), { onSuccess: () => reloadAccount() });
  return (
    <section className="stack">
      <div className="row between"><span className="eyebrow">Direcciones de envío</span>{!editing && <Button size="sm" variant="outline" icon="plus" onClick={() => setEditing({})}>Añadir</Button>}</div>
      {editing && <div className="panel"><AddressForm initial={editing} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} /></div>}
      {account!.addresses.map((a) => (
        <div key={a.id} className="panel row between" style={{ alignItems: "flex-start" }}>
          <div className="stack small" style={{ gap: 2 }}>
            <b>{a.full_name} {a.is_default && <Badge kind="ok">Predeterminada</Badge>}</b>
            <span className="muted">{a.line1}{a.line2 ? `, ${a.line2}` : ""}</span>
            <span className="muted">{a.city}, {a.region} {a.postal_code} · {a.country}</span>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>Editar</Button>
            <ConfirmButton confirmLabel="Eliminar" onConfirm={() => void del.run(a.id)} icon="trash">Eliminar</ConfirmButton>
          </div>
        </div>
      ))}
      {!account!.addresses.length && !editing && <span className="small dim">No tienes direcciones guardadas.</span>}
    </section>
  );
}

export function StoreSettings() {
  const { api, account, backend, reloadAccount } = useApp();
  const toast = useToast();
  const s = account!.stores[0];
  const [f, setF] = useState({
    id: s?.id, name: s?.name ?? account!.profile.display_name, slug: s?.slug ?? slugify(account!.profile.username), bio: s?.bio ?? "",
    accent: s?.accent ?? "crimson", logo_url: s?.logo_url ?? "", cover_url: s?.cover_url ?? "",
    social_links: { instagram: "", tiktok: "", website: "", ...(s?.social_links ?? {}) } as Record<string, string>,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const save = useAction(() => api.saveStore(f), { onSuccess: (r) => { toast("Tienda guardada", "ok"); setF((x) => ({ ...x, id: r.id })); reloadAccount(); invalidate("store:", "dashboard"); } });
  const upload = async (kind: "logo_url" | "cover_url", file?: File) => {
    if (!file) return;
    setBusy(kind);
    try { const up = await backend.uploadImage(await compressImage(file, kind === "logo_url" ? 500 : 1600, 0.85), { bucket: "media", ext: "jpg" }); setF((x) => ({ ...x, [kind]: up.url })); }
    catch (e: any) { toast(e.message, "bad"); } finally { setBusy(null); }
  };
  return (
    <section className="stack">
      <span className="eyebrow">Tienda</span>
      {!s && <Callout>Aún no tienes tienda. Se crea automáticamente con tu primera publicación, o puedes configurarla ahora.</Callout>}
      <form className="panel stack" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
        <div className={`cover accent-${f.accent}`} style={{ height: 120 }}>{f.cover_url ? <Img src={f.cover_url} alt="" /> : <div className="cover-grid" />}</div>
        <div className="row">
          <label className="btn btn-outline btn-sm">{busy === "logo_url" ? <span className="spin" /> : <Icon name="camera" size={16} />}Logotipo<input type="file" accept="image/*" hidden onChange={(e) => void upload("logo_url", e.target.files?.[0])} /></label>
          <label className="btn btn-outline btn-sm">{busy === "cover_url" ? <span className="spin" /> : <Icon name="camera" size={16} />}Portada<input type="file" accept="image/*" hidden onChange={(e) => void upload("cover_url", e.target.files?.[0])} /></label>
        </div>
        <Field label="Nombre comercial" required><Input value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Dirección de la tienda" hint={`Tu tienda estará en …/tienda/${f.slug || "tu-tienda"}`}><Input value={f.slug} onChange={(e) => setF({ ...f, slug: slugify(e.target.value) })} /></Field>
        <Field label="Biografía"><TextArea value={f.bio} maxLength={1000} onChange={(e) => setF({ ...f, bio: e.target.value })} /></Field>
        <Field label="Color de acento" hint="Personaliza tu portada dentro de la identidad MARKETZONE.">
          <div className="segmented">{(["crimson", "ember", "steel", "ivory"] as const).map((a) => (
            <button type="button" key={a} className={`seg ${f.accent === a ? "on" : ""} accent-${a}`} onClick={() => setF({ ...f, accent: a })}>
              <span style={{ width: 14, height: 14, borderRadius: 7, background: "var(--acc)" }} />{{ crimson: "Carmesí", ember: "Brasa", steel: "Acero", ivory: "Marfil" }[a]}</button>))}</div>
        </Field>
        <div className="grid-2">
          {(["instagram", "tiktok", "website"] as const).map((k) => (
            <Field key={k} label={k === "website" ? "Sitio web" : k[0].toUpperCase() + k.slice(1)} hint="Enlace completo (https://…)">
              <Input type="url" value={f.social_links[k] ?? ""} onChange={(e) => setF({ ...f, social_links: { ...f.social_links, [k]: e.target.value } })} />
            </Field>
          ))}
        </div>
        <ErrorBox error={save.error} />
        <div className="row"><Button variant="primary" type="submit" loading={save.pending}>Guardar tienda</Button>{s && <Link to={`/tienda/${s.slug}`} className="btn btn-ghost">Ver tienda</Link>}</div>
      </form>
    </section>
  );
}

function PasswordForm() {
  const { backend } = useApp();
  const toast = useToast();
  const [pw, setPw] = useState("");
  const save = useAction(() => backend.auth.updatePassword(pw), { onSuccess: () => { setPw(""); toast("Contraseña actualizada", "ok"); } });
  return (
    <section className="stack">
      <span className="eyebrow">Seguridad</span>
      <form className="panel stack" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
        <Field label="Nueva contraseña" hint="Mínimo 8 caracteres."><Input type="password" autoComplete="new-password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <ErrorBox error={save.error} />
        <div><Button variant="dark" type="submit" loading={save.pending} disabled={pw.length < 8}>Cambiar contraseña</Button></div>
      </form>
    </section>
  );
}

export { Select };
