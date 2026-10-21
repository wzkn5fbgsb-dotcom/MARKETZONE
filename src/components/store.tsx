// Tarjetas de tiendas y negocios.
import type { BusinessCard as B, StoreCard as S } from "../api/types";
import { BUSINESS_CATEGORIES } from "../app/format";
import { Link } from "../app/router";
import { useApp } from "../app/state";
import { Badge, Img, Stars } from "../ui/kit";
import { Icon } from "../ui/icons";

export function StoreCard({ s }: { s: S }) {
  const imgs = [...s.preview_images, null, null, null].slice(0, 3);
  return (
    <Link to={`/tienda/${s.slug}`} className={`scard accent-${s.accent}`}>
      <div className="scard-cover">{imgs.map((u, i) => <div key={i}>{u ? <Img src={u} alt="" /> : null}</div>)}</div>
      <div className="scard-body">
        <div className="row-nw between">
          <span className="h3 ellipsis">{s.name}</span>
          {s.sponsored ? <Badge kind="accent">Patrocinado</Badge> : s.is_demo ? <Badge kind="demo">Demo</Badge> : null}
        </div>
        <span className="small dim">@{s.owner?.username} · {s.stats.active_listings} publicaciones</span>
        <span className="small muted row-nw" style={{ gap: 6 }}>
          {s.stats.rating_count > 0 ? <><Stars value={s.stats.rating_avg ?? 0} size={12} /> {s.stats.rating_avg?.toFixed(1)} ({s.stats.rating_count})</> : "Sin reseñas todavía"}
          <span className="dim">· {s.stats.followers} seguidores</span>
        </span>
      </div>
    </Link>
  );
}

export function BusinessCard({ b }: { b: B }) {
  const { api, sessionId } = useApp();
  return (
    <Link to={`/negocio/${b.slug}`} className="bcard" onClick={() => {
      if (b.sponsored && b.campaign_id) void api.track({ kind: "click", campaign_id: b.campaign_id, business_id: b.id, session_id: sessionId }).catch(() => null);
    }}>
      <div className="logo">{b.logo_url ? <Img src={b.logo_url} alt="" /> : b.name.slice(0, 1)}</div>
      <div className="stack grow" style={{ gap: 5 }}>
        <div className="row-nw between" style={{ gap: 8 }}>
          <span className="h3 ellipsis">{b.name}</span>
          {b.sponsored ? <Badge kind="accent">Patrocinado</Badge> : b.is_demo ? <Badge kind="demo">Demo</Badge> : null}
        </div>
        <span className="eyebrow">{BUSINESS_CATEGORIES[b.category] ?? b.category}{b.location ? ` · ${b.location}` : ""}</span>
        <span className="small muted clamp-2">{b.description}</span>
      </div>
      <Icon name="chevron" size={18} style={{ color: "var(--dim)", alignSelf: "center" }} />
    </Link>
  );
}
