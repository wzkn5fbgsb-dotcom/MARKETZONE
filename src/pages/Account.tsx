import { useState, type FormEvent } from "react";
import { useApp } from "../app/state";
import { invalidate, useAction, useQuery } from "../app/query";
import { Link, navigate } from "../app/router";
import { ago, slugify } from "../app/format";
import type { Address } from "../api/types";
import { ProductGrid } from "../components/product";
import { LangPicker, Page, ThemePicker } from "../components/layout";
import { Avatar, Badge, Button, Callout, ConfirmButton, Empty, ErrorBox, Field, Img, Input, Select, Spinner, TextArea, useToast } from "../ui/kit";
import { Icon, type IconName } from "../ui/icons";
import { compressImage } from "../app/images";
import { DemoBackend } from "../api/demo/backend";
import { DEMO_ACCOUNTS } from "../api/demo/seed";
import { t } from "../i18n";
import { MxSoundSetting } from "../mx/fx.js";

export function NeedLogin({ next }: { next: string }) {
  return (
    <Page narrow>
      <Empty icon="user" title={t("Inicia sesión para continuar")} action={<Link to={`/entrar?next=${encodeURIComponent(next)}`} className="btn btn-primary">{t("Entrar")}</Link>}>
        {t("Necesitas una cuenta para acceder a esta sección.")}</Empty>
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
    ["/pedidos", "box", t("Mis pedidos")],
    ["/ofertas", "offer", t("Mis ofertas")],
    ["/mis-subastas", "gavel", t("Mis subastas")],
    ["/favoritos", "heart", t("Favoritos")],
    ["/notificaciones", "bell", t("Notificaciones"), account.unread_notifications ? t("{0} sin leer", [account.unread_notifications]) : undefined],
    ["/panel", "chart", t("Panel de vendedor")],
    ["/promociona", "megaphone", t("Promociona tu negocio")],
    ["/ayuda", "chat", t("Ayuda y soporte")],
    ["/ajustes", "settings", t("Ajustes")],
  ];
  if (account.is_admin) links.push(["/admin", "shield", t("Administración")], ["/admin/soporte", "chat", t("Soporte al cliente")]);
  links.push(["/terminos", "doc", t("Términos")], ["/privacidad", "shield", t("Privacidad")]);
  const switchTo = (email: string) => {
    if (!(backend instanceof DemoBackend)) return;
    const c = backend.engine.db.credentials.find((x) => x.email === email);
    if (c) { backend.signInAs(c.user_id); toast(t("Cambiaste de cuenta de demostración"), "ok"); }
  };
  return (
    <Page narrow>
      <div className="stack-lg">
        <div className="row-nw" style={{ gap: 14 }}>
          <Avatar name={p.display_name} src={p.avatar_url} size="lg" />
          <div className="stack grow" style={{ gap: 3 }}>
            <h1 className="h2">{p.display_name}</h1>
            <span className="small dim">@{p.username} · {account.email}</span>
            <div className="row" style={{ gap: 6 }}>{account.is_admin && <Badge kind="accent">{t("Admin")}</Badge>}{store && <Link to={`/tienda/${store.slug}`} className="link small">{t("Ver mi tienda")}</Link>}</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {links.map(([to, icon, label, sub]) => (
            <Link key={to} to={to} className="list-link"><Icon name={icon} size={20} /><span className="grow stack" style={{ gap: 0 }}><span>{label}</span>{sub && <span className="small dim">{sub}</span>}</span><Icon name="chevron" size={18} /></Link>
          ))}
        </nav>
        {config.mode === "demo" && (
          <div className="panel stack">
            <span className="eyebrow">{t("Demo: probar como otro usuario")}</span>
            <span className="small muted">{t("Para probar ofertas entre comprador y vendedor, cambia de cuenta aquí.")}</span>
            <div className="row">
              <Button size="sm" variant="dark" onClick={() => switchTo(DEMO_ACCOUNTS.buyer.email)}>{t("Comprador")}</Button>
              <Button size="sm" variant="dark" onClick={() => switchTo(DEMO_ACCOUNTS.seller.email)}>{t("Vendedor")}</Button>
              <Button size="sm" variant="dark" onClick={() => switchTo(DEMO_ACCOUNTS.admin.email)}>{t("Admin")}</Button>
            </div>
            {demo && <ConfirmButton confirmLabel={t("Sí, restablecer")} onConfirm={async () => { await demo.reset(); location.reload(); }}>{t("Restablecer datos de la demo")}</ConfirmButton>}
          </div>
        )}
        <Button variant="outline" icon="logout" onClick={async () => { await backend.auth.signOut(); navigate("/"); }}>{t("Cerrar sesión")}</Button>
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
        <h1 className="h1">{t("Favoritos")}</h1>
        <ErrorBox error={res.error} onRetry={res.reload} />
        {res.loading ? <Spinner /> : res.data?.length ? <ProductGrid items={res.data} /> :
          <Empty icon="heart" title={t("Aún no guardaste nada")} action={<Link to="/categorias" className="btn btn-outline">{t("Ver categorías")}</Link>}>{t("Toca el corazón en cualquier producto para guardarlo aquí.")}</Empty>}
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
        <div className="row between"><h1 className="h1">{t("Notificaciones")}</h1>
          {!!res.data?.some((n) => !n.read_at) && <Button size="sm" variant="outline" loading={markAll.pending} onClick={() => void markAll.run()}>{t("Marcar todo como leído")}</Button>}</div>
        {res.loading ? <Spinner /> : res.data?.length ? (
          <div className="stack" style={{ gap: 8 }}>{res.data.map((n) => (
            <Link key={n.id} to={n.link ?? "/"} className="panel row-nw" style={{ gap: 12, padding: 14, borderColor: n.read_at ? undefined : "rgba(220,20,60,.4)" }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, flex: "none", background: n.read_at ? "transparent" : "var(--crimson)" }} />
              <span className="stack grow" style={{ gap: 2 }}><b style={{ fontWeight: 600 }}>{n.title}</b>{n.body && <span className="small muted">{n.body}</span>}</span>
              <span className="tiny dim" style={{ whiteSpace: "nowrap" }}>{ago(n.created_at)}</span>
            </Link>
          ))}</div>
        ) : <Empty icon="bell" title={t("Sin notificaciones")}>{t("Aquí verás ofertas, ventas, pedidos y avisos de moderación.")}</Empty>}
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
      <Field label={t("Nombre completo")} required><Input required value={f.full_name ?? ""} onChange={set("full_name")} autoComplete="name" /></Field>
      <Field label={t("Dirección")} required><Input required value={f.line1 ?? ""} onChange={set("line1")} autoComplete="address-line1" /></Field>
      <Field label={t("Apartamento, suite (opcional)")}><Input value={f.line2 ?? ""} onChange={set("line2")} autoComplete="address-line2" /></Field>
      <div className="grid-2">
        <Field label={t("Ciudad")} required><Input required value={f.city ?? ""} onChange={set("city")} autoComplete="address-level2" /></Field>
        <Field label={t("Estado / región")} required><Input required value={f.region ?? ""} onChange={set("region")} autoComplete="address-level1" /></Field>
        <Field label={t("Código postal")} required><Input required value={f.postal_code ?? ""} onChange={set("postal_code")} autoComplete="postal-code" inputMode="numeric" /></Field>
        <Field label={t("País (código)")}><Input value={f.country ?? "US"} maxLength={2} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} autoComplete="country" /></Field>
      </div>
      <Field label={t("Teléfono (opcional, para la etiqueta de envío)")}><Input value={f.phone ?? ""} onChange={set("phone")} type="tel" autoComplete="tel" /></Field>
      <ErrorBox error={save.error} />
      <div className="row"><Button variant="primary" type="submit" loading={save.pending}>{t("Guardar dirección")}</Button>{onCancel && <Button variant="ghost" type="button" onClick={onCancel}>{t("Cancelar")}</Button>}</div>
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
        <h1 className="h1">{t("Ajustes")}</h1>
        <section className="stack">
          <h2 className="h3">{t("Apariencia")}</h2>
          <span className="small muted">{t("Automático usa el mismo modo que tu teléfono o computadora.")}</span>
          <ThemePicker />
        </section>
        <section className="stack">
          <h2 className="h3"><label htmlFor="lang-settings">{t("Idioma")}</label></h2>
          <LangPicker id="lang-settings" />
        </section>
        <MxSoundSetting />
        <ProfileForm />
        <Addresses />
        <StoreSettings />
        <PasswordForm />
        <BlockedUsers />
        <DeleteAccount />
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
  const save = useAction(() => api.updateProfile(f), { onSuccess: () => { toast(t("Perfil actualizado"), "ok"); reloadAccount(); } });
  const onAvatar = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try { const up = await backend.uploadImage(await compressImage(file, 600, 0.85), { bucket: "media", ext: "jpg" }); setF((x) => ({ ...x, avatar_url: up.url })); }
    catch (e: any) { toast(e.message, "bad"); } finally { setUploading(false); }
  };
  return (
    <section className="stack">
      <span className="eyebrow">{t("Perfil")}</span>
      <form className="panel stack" onSubmit={(e: FormEvent) => { e.preventDefault(); void save.run(); }}>
        <div className="row-nw" style={{ gap: 14 }}>
          <Avatar name={f.display_name} src={f.avatar_url || null} size="lg" />
          <label className="btn btn-outline btn-sm">{uploading ? <span className="spin" /> : <Icon name="camera" size={16} />}{t("Cambiar foto")}<input type="file" accept="image/*" hidden onChange={(e) => void onAvatar(e.target.files?.[0])} /></label>
        </div>
        <Field label={t("Nombre visible")}><Input value={f.display_name} maxLength={60} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
        <Field label={t("Nombre de usuario")}><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} /></Field>
        <Field label={t("Biografía")}><TextArea value={f.bio} maxLength={500} onChange={(e) => setF({ ...f, bio: e.target.value })} /></Field>
        <ErrorBox error={save.error} />
        <div><Button variant="primary" type="submit" loading={save.pending}>{t("Guardar perfil")}</Button></div>
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
      <div className="row between"><span className="eyebrow">{t("Direcciones de envío")}</span>{!editing && <Button size="sm" variant="outline" icon="plus" onClick={() => setEditing({})}>{t("Añadir")}</Button>}</div>
      {editing && <div className="panel"><AddressForm initial={editing} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} /></div>}
      {account!.addresses.map((a) => (
        <div key={a.id} className="panel row between" style={{ alignItems: "flex-start" }}>
          <div className="stack small" style={{ gap: 2 }}>
            <b>{a.full_name} {a.is_default && <Badge kind="ok">{t("Predeterminada")}</Badge>}</b>
            <span className="muted">{a.line1}{a.line2 ? `, ${a.line2}` : ""}</span>
            <span className="muted">{a.city}, {a.region} {a.postal_code} · {a.country}</span>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>{t("Editar")}</Button>
            <ConfirmButton confirmLabel={t("Eliminar")} onConfirm={() => void del.run(a.id)} icon="trash">{t("Eliminar")}</ConfirmButton>
          </div>
        </div>
      ))}
      {!account!.addresses.length && !editing && <span className="small dim">{t("No tienes direcciones guardadas.")}</span>}
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
  const save = useAction(() => api.saveStore(f), { onSuccess: (r) => { toast(t("Tienda guardada"), "ok"); setF((x) => ({ ...x, id: r.id })); reloadAccount(); invalidate("store:", "dashboard"); } });
  const upload = async (kind: "logo_url" | "cover_url", file?: File) => {
    if (!file) return;
    setBusy(kind);
    try { const up = await backend.uploadImage(await compressImage(file, kind === "logo_url" ? 500 : 1600, 0.85), { bucket: "media", ext: "jpg" }); setF((x) => ({ ...x, [kind]: up.url })); }
    catch (e: any) { toast(e.message, "bad"); } finally { setBusy(null); }
  };
  return (
    <section className="stack">
      <span className="eyebrow">{t("Tienda")}</span>
      {!s && <Callout>{t("Aún no tienes tienda. Se crea automáticamente con tu primera publicación, o puedes configurarla ahora.")}</Callout>}
      <form className="panel stack" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
        <div className={`cover accent-${f.accent}`} style={{ height: 120 }}>{f.cover_url ? <Img src={f.cover_url} alt="" /> : <div className="cover-grid" />}</div>
        <div className="row">
          <label className="btn btn-outline btn-sm">{busy === "logo_url" ? <span className="spin" /> : <Icon name="camera" size={16} />}{t("Logotipo")}<input type="file" accept="image/*" hidden onChange={(e) => void upload("logo_url", e.target.files?.[0])} /></label>
          <label className="btn btn-outline btn-sm">{busy === "cover_url" ? <span className="spin" /> : <Icon name="camera" size={16} />}{t("Portada")}<input type="file" accept="image/*" hidden onChange={(e) => void upload("cover_url", e.target.files?.[0])} /></label>
        </div>
        <Field label={t("Nombre comercial")} required><Input value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t("Dirección de la tienda")} hint={t("Tu tienda estará en …/tienda/{0}", [f.slug || "tu-tienda"])}><Input value={f.slug} onChange={(e) => setF({ ...f, slug: slugify(e.target.value) })} /></Field>
        <Field label={t("Biografía")}><TextArea value={f.bio} maxLength={1000} onChange={(e) => setF({ ...f, bio: e.target.value })} /></Field>
        <Field label={t("Color de acento")} hint={t("Personaliza tu portada dentro de la identidad MARKETXONE.")}>
          <div className="segmented">{(["crimson", "ember", "steel", "ivory"] as const).map((a) => (
            <button type="button" key={a} className={`seg ${f.accent === a ? "on" : ""} accent-${a}`} onClick={() => setF({ ...f, accent: a })}>
              <span style={{ width: 14, height: 14, borderRadius: 7, background: "var(--acc)" }} />{{ crimson: t("Carmesí"), ember: t("Brasa"), steel: t("Acero"), ivory: t("Marfil") }[a]}</button>))}</div>
        </Field>
        <div className="grid-2">
          {(["instagram", "tiktok", "website"] as const).map((k) => (
            <Field key={k} label={k === "website" ? t("Sitio web") : k[0].toUpperCase() + k.slice(1)} hint={t("Enlace completo (https://…)")}>
              <Input type="url" value={f.social_links[k] ?? ""} onChange={(e) => setF({ ...f, social_links: { ...f.social_links, [k]: e.target.value } })} />
            </Field>
          ))}
        </div>
        <ErrorBox error={save.error} />
        <div className="row"><Button variant="primary" type="submit" loading={save.pending}>{t("Guardar tienda")}</Button>{s && <Link to={`/tienda/${s.slug}`} className="btn btn-ghost">{t("Ver tienda")}</Link>}</div>
      </form>
    </section>
  );
}

function PasswordForm() {
  const { backend } = useApp();
  const toast = useToast();
  const [pw, setPw] = useState("");
  const save = useAction(() => backend.auth.updatePassword(pw), { onSuccess: () => { setPw(""); toast(t("Contraseña actualizada"), "ok"); } });
  return (
    <section className="stack">
      <h2 className="h3">{t("Contraseña")}</h2>
      <form className="panel stack" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
        <Field label={t("Nueva contraseña")} hint={t("Mínimo 8 caracteres.")}><Input type="password" autoComplete="new-password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <ErrorBox error={save.error} />
        <div><Button variant="dark" type="submit" loading={save.pending} disabled={pw.length < 8}>{t("Cambiar contraseña")}</Button></div>
      </form>
    </section>
  );
}

function BlockedUsers() {
  const { api } = useApp();
  const toast = useToast();
  const res = useQuery("blocks", () => api.blocks());
  const unblock = useAction((id: string) => api.toggleBlock(id), { invalidates: ["blocks"], onSuccess: () => toast(t("Usuario desbloqueado"), "ok") });
  return (
    <section className="stack">
      <h2 className="h3">{t("Usuarios bloqueados")}</h2>
      {res.data && res.data.length === 0 && <span className="small muted">{t("No has bloqueado a nadie. Puedes bloquear a alguien desde su tienda o desde uno de sus productos.")}</span>}
      {res.data && res.data.length > 0 && (
        <div className="panel stack" style={{ gap: 0, padding: "4px 16px" }}>
          {res.data.map((u) => (
            <div key={u.id} className="row between" style={{ padding: "10px 0", borderBottom: "1px solid var(--line-soft)" }}>
              <span className="row-nw"><Avatar name={u.display_name} src={u.avatar_url} /><span className="stack" style={{ gap: 0 }}><b>{u.display_name}</b><span className="small dim">@{u.username}</span></span></span>
              <Button size="sm" variant="outline" loading={unblock.pending} onClick={() => void unblock.run(u.id)}>{t("Desbloquear")}</Button>
            </div>
          ))}
        </div>
      )}
      <ErrorBox error={res.error ?? unblock.error} />
    </section>
  );
}

function DeleteAccount() {
  const { api, backend } = useApp();
  const toast = useToast();
  const [confirm, setConfirm] = useState("");
  const del = useAction(() => api.deleteAccount(confirm), {
    onSuccess: async () => {
      try { await backend.auth.signOut(); } catch { /* la sesión ya no es válida */ }
      toast(t("Tu cuenta fue eliminada."), "ok");
      navigate("/", { replace: true });
    },
  });
  return (
    <section className="stack">
      <h2 className="h3">{t("Eliminar mi cuenta")}</h2>
      <div className="panel stack" style={{ borderColor: "rgba(220, 20, 60, 0.35)" }}>
        <span className="small muted">{t("Se borran tu perfil, tus direcciones, favoritos y notificaciones, y se retiran tus publicaciones y tu tienda. No se puede deshacer.")}</span>
        <span className="small muted">{t("Si compraste o vendiste algo, esos pedidos se conservan sin tu nombre ni tus datos, porque son el comprobante de la otra persona. Si tienes ventas o compras pagadas en camino, termínalas antes.")}</span>
        <Field label={t("Escribe ELIMINAR para confirmar")}><Input value={confirm} autoCapitalize="characters" autoComplete="off" onChange={(e) => setConfirm(e.target.value)} /></Field>
        <ErrorBox error={del.error} />
        <div><Button variant="danger" loading={del.pending} disabled={confirm.trim().toUpperCase() !== "ELIMINAR"} onClick={() => void del.run()}>{t("Eliminar mi cuenta para siempre")}</Button></div>
      </div>
    </section>
  );
}

export { Select };
