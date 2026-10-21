// Tarjetas y listas de productos.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ProductCard as Card } from "../api/types";
import { CONDITIONS, money } from "../app/format";
import { Link } from "../app/router";
import { useApp } from "../app/state";
import { invalidate } from "../app/query";
import { Badge, Img, useToast } from "../ui/kit";
import { Icon } from "../ui/icons";
import { t } from "../i18n";

export function ConditionTag({ condition, long = false }: { condition: Card["condition"]; long?: boolean }) {
  const c = CONDITIONS[condition];
  return <span className="tag-cond" title={c.label}><span className="code">{c.code}</span>{long ? c.label : null}</span>;
}

export function PriceLine({ price, compare, size = 17 }: { price: number; compare?: number | null; size?: number }) {
  return (
    <span className="pcard-price">
      <span className="price" style={{ fontSize: size }}>{money(price)}</span>
      {compare ? <span className="strike small num">{money(compare)}</span> : null}
    </span>
  );
}

function useImpression(campaignId: string | undefined, productId: string) {
  const { api, sessionId } = useApp();
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!campaignId || !ref.current || typeof IntersectionObserver === "undefined") return;
    let done = false;
    const io = new IntersectionObserver((entries) => {
      if (!done && entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)) {
        done = true;
        void api.track({ kind: "impression", campaign_id: campaignId, product_id: productId, session_id: sessionId }).catch(() => null);
        io.disconnect();
      }
    }, { threshold: [0.5] });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [campaignId, productId]); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

export function FavoriteButton({ productId, initial, className = "pcard-fav" }: { productId: string; initial: boolean; className?: string }) {
  const { api, requireAuth } = useApp();
  const toast = useToast();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(initial), [initial]);
  return (
    <button className={`${className} ${on ? "on" : ""}`} aria-pressed={on} aria-label={on ? t("Quitar de favoritos") : t("Añadir a favoritos")} disabled={busy}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!requireAuth()) return;
        setBusy(true);
        setOn(!on);
        try {
          const r = await api.toggleFavorite(productId);
          setOn(r.favorite);
          invalidate("favorites");
        } catch (err: any) {
          setOn(on);
          toast(err.message, "bad");
        } finally { setBusy(false); }
      }}>
      <Icon name="heart" size={19} fill={on ? "currentColor" : undefined} />
    </button>
  );
}

export function ProductCard({ p, eager }: { p: Card; eager?: boolean }) {
  const { api, sessionId } = useApp();
  const ref = useImpression(p.sponsored ? p.campaign_id : undefined, p.id);
  const sizes = p.sizes.filter((s) => s.available > 0).map((s) => s.size).filter(Boolean) as string[];
  const soldOut = p.available <= 0;
  const onClick = () => {
    if (p.sponsored && p.campaign_id) void api.track({ kind: "click", campaign_id: p.campaign_id, product_id: p.id, session_id: sessionId }).catch(() => null);
  };
  return (
    <div className="pcard" ref={ref}>
      <Link to={`/p/${p.id}${p.sponsored && p.campaign_id ? `?c=${p.campaign_id}` : ""}`} onClick={onClick} className={`pcard-media ${p.sponsored ? "zone" : ""}`} aria-label={p.title}>
        <Img src={p.image_url} alt={p.title} loading={eager ? "eager" : "lazy"} />
        <div className="pcard-top">
          {p.sponsored && <Badge kind="accent" title={t("Publicación patrocinada")}>{t("Patrocinado")}</Badge>}
          {p.compare_at_cents && !p.sponsored && <Badge kind="bad">{t("Bajó de precio")}</Badge>}
          {p.is_demo && <Badge kind="demo" title={t("Producto de ejemplo para la demostración")}>{t("Ejemplo")}</Badge>}
        </div>
        {soldOut && <div className="pcard-soldout">{t("Agotado")}</div>}
      </Link>
      <FavoriteButton productId={p.id} initial={p.is_favorite} />
      <div className="pcard-body">
        <PriceLine price={p.price_cents} compare={p.compare_at_cents} />
        <Link to={`/p/${p.id}`} className="pcard-title clamp-2" onClick={onClick}>{p.title}</Link>
        <div className="pcard-meta">
          <ConditionTag condition={p.condition} />
          {sizes.length > 0 && <span className="pcard-sizes ellipsis">{sizes.length > 4 ? `${sizes.slice(0, 4).join(" · ")} +${sizes.length - 4}` : sizes.join(" · ")}</span>}
        </div>
        <div className="pcard-meta"><span className="ellipsis">{p.brand ? `${p.brand} · ` : ""}{p.store?.name ?? p.seller?.username}</span></div>
      </div>
    </div>
  );
}

export function ProductGrid({ items, wide, eagerCount = 4 }: { items: Card[]; wide?: boolean; eagerCount?: number }) {
  return <div className={`pgrid ${wide ? "wide" : ""}`}>{items.map((p, i) => <ProductCard key={`${p.id}-${p.campaign_id ?? ""}`} p={p} eager={i < eagerCount} />)}</div>;
}

export function Rail({ items }: { items: Card[] }) {
  return <div className="rail">{items.map((p) => <ProductCard key={`${p.id}-${p.campaign_id ?? ""}`} p={p} />)}</div>;
}

export function SectionHeader({ title, eyebrow, action, note }: { title: string; eyebrow?: string; action?: ReactNode; note?: ReactNode }) {
  return (
    <div className="section-h">
      <div className="stack" style={{ gap: 4 }}>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2 className="h2">{title}</h2>
        {note && <span className="small dim">{note}</span>}
      </div>
      {action}
    </div>
  );
}

export function GridSkeleton({ n = 8 }: { n?: number }) {
  return (
    <div className="pgrid">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="stack" style={{ gap: 8 }}>
          <div className="skel" style={{ aspectRatio: "4 / 5", borderRadius: 12 }} />
          <div className="skel" style={{ height: 14, width: "40%" }} />
          <div className="skel" style={{ height: 12, width: "80%" }} />
        </div>
      ))}
    </div>
  );
}
