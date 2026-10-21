import { useMemo, useState } from "react";
import { useApp } from "../app/state";
import { useQuery } from "../app/query";
import { navigate, useLocation, withQuery } from "../app/router";
import { CONDITIONS, money } from "../app/format";
import type { Condition, ProductCard, SearchParams } from "../api/types";
import { GridSkeleton, ProductGrid } from "../components/product";
import { Page } from "../components/layout";
import { Button, Empty, ErrorBox, Field, MoneyInput, Select, Sheet, Toggle } from "../ui/kit";
import { Icon } from "../ui/icons";
import { t } from "../i18n";

const APPAREL = ["XS", "S", "M", "L", "XL", "XXL"];
const SHOES = ["US 6", "US 7", "US 8", "US 9", "US 10", "US 11", "US 12"];

export default function Explore() {
  const { api, categories } = useApp();
  const loc = useLocation();
  const q = loc.query;
  const params: SearchParams = {
    q: q.get("q") ?? undefined,
    category: q.get("cat") ?? undefined,
    sizes: q.get("sizes")?.split(",").filter(Boolean),
    conditions: q.get("cond")?.split(",").filter(Boolean) as Condition[] | undefined,
    min_price_cents: q.get("min") ? Number(q.get("min")) : undefined,
    max_price_cents: q.get("max") ? Number(q.get("max")) : undefined,
    only_available: q.get("avail") === "1",
    only_deals: q.get("deals") === "1",
    sort: (q.get("sort") as SearchParams["sort"]) ?? "recent",
  };
  const [extra, setExtra] = useState<ProductCard[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const key = `search:${loc.raw}`;
  const res = useQuery(key, () => { setExtra([]); return api.search({ ...params, limit: 24 }); });
  const [open, setOpen] = useState(false);
  const top = categories.filter((c) => !c.parent_id);
  const cat = categories.find((c) => c.id === params.category);
  const parent = cat?.parent_id ? categories.find((c) => c.id === cat.parent_id) : cat;
  const subs = parent ? categories.filter((c) => c.parent_id === parent.id) : [];
  const sizeSystem = cat?.size_system ?? parent?.size_system;

  const set = (patch: Record<string, string | number | boolean | null | undefined | string[]>) => {
    const cur: Record<string, string> = {};
    q.forEach((v, k) => (cur[k] = v));
    navigate(withQuery("/explorar", { ...cur, ...patch }), { keepScroll: true });
  };
  const items = useMemo(() => [...(res.data?.items ?? []), ...extra], [res.data, extra]);
  const activeFilters = [params.sizes?.length, params.conditions?.length, params.min_price_cents, params.max_price_cents, params.only_available, params.only_deals].filter(Boolean).length;

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const more = await api.search({ ...params, limit: 24, offset: items.length });
      setExtra((x) => [...x, ...more.items]);
    } finally { setLoadingMore(false); }
  };

  return (
    <Page>
      <div className="stack-lg">
        <div className="stack" style={{ gap: 6 }}>
          {parent && cat?.id !== parent.id && <span className="eyebrow">{parent.name}</span>}
          <h1 className="h1">{params.q ? `“${params.q}”` : cat?.name ?? t("Todo lo publicado")}</h1>
          <span className="small dim">{res.data ? t("{0} artículo{1}", [res.data.total, res.data.total === 1 ? "" : "s"]) : t("Cargando…")}</span>
        </div>

        <div className="cat-strip" style={{ paddingBottom: 0 }}>
          <button className={`chip ${!params.category ? "on" : ""}`} onClick={() => set({ cat: null, sizes: null })}>{t("Todo")}</button>
          {top.map((c) => <button key={c.id} className={`chip ${parent?.id === c.id ? "on" : ""}`} onClick={() => set({ cat: c.id, sizes: null })}>{c.name}</button>)}
        </div>
        {subs.length > 0 && (
          <div className="cat-strip" style={{ paddingBottom: 0 }}>
            {subs.map((c) => <button key={c.id} className={`chip ${cat?.id === c.id ? "on" : ""}`} onClick={() => set({ cat: cat?.id === c.id ? parent!.id : c.id })}>{c.name}</button>)}
          </div>
        )}

        <div className="row between">
          <Button variant="outline" size="sm" icon="filter" onClick={() => setOpen(true)}>{t("Filtros")}{activeFilters ? ` (${activeFilters})` : ""}</Button>
          <div className="row" style={{ gap: 8 }}>
            <label className="small dim" htmlFor="sort">{t("Ordenar")}</label>
            <div style={{ width: 190 }}>
              <Select id="sort" value={params.sort} onChange={(e) => set({ sort: e.target.value })}>
                <option value="recent">{t("Más recientes")}</option>
                <option value="price_asc">{t("Precio: menor a mayor")}</option>
                <option value="price_desc">{t("Precio: mayor a menor")}</option>
                <option value="popular">{t("Más guardados")}</option>
              </Select>
            </div>
          </div>
        </div>

        {res.data && res.data.spotlight.length > 0 && (
          <div className="stack">
            <span className="eyebrow">{t("Patrocinado en")}{" "}{cat?.name}</span>
            <ProductGrid items={res.data.spotlight} />
          </div>
        )}

        <ErrorBox error={res.error} onRetry={res.reload} />
        {res.loading ? <GridSkeleton /> : items.length ? (
          <>
            <ProductGrid items={items} wide />
            {res.data && items.length < res.data.total && (
              <div className="center"><Button variant="outline" loading={loadingMore} onClick={loadMore}>{t("Cargar más")}</Button></div>
            )}
          </>
        ) : res.data ? (
          <Empty icon="search" title={t("Sin resultados")} action={<Button variant="outline" onClick={() => navigate("/explorar")}>{t("Quitar filtros")}</Button>}>
            {t("Prueba con otra palabra, otra talla o una categoría más amplia.")}</Empty>
        ) : null}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title={t("Filtros")} footer={
        <>
          <Button variant="ghost" onClick={() => { set({ sizes: null, cond: null, min: null, max: null, avail: null, deals: null }); setOpen(false); }}>{t("Limpiar")}</Button>
          <Button variant="primary" onClick={() => setOpen(false)}>{t("Ver resultados")}</Button>
        </>
      }>
        <FilterBody params={params} set={set} sizeSystem={sizeSystem} />
      </Sheet>
    </Page>
  );
}

function FilterBody({ params, set, sizeSystem }: { params: SearchParams; set: (p: Record<string, any>) => void; sizeSystem?: string }) {
  const sizes = sizeSystem === "shoes" ? SHOES : sizeSystem === "apparel" ? APPAREL : [...APPAREL, ...SHOES];
  const toggle = (list: string[] | undefined, v: string) => { const s = new Set(list ?? []); s.has(v) ? s.delete(v) : s.add(v); return [...s]; };
  return (
    <>
      <Field label={t("Talla")}>
        <div className="segmented">
          {sizes.map((s) => <button key={s} className={`seg ${params.sizes?.includes(s) ? "on" : ""}`} onClick={() => set({ sizes: toggle(params.sizes, s) })}>{s}</button>)}
        </div>
      </Field>
      <Field label={t("Estado")}>
        <div className="segmented">
          {(Object.keys(CONDITIONS) as Condition[]).map((c) => (
            <button key={c} className={`seg ${params.conditions?.includes(c) ? "on" : ""}`} onClick={() => set({ cond: toggle(params.conditions, c) })}>
              {CONDITIONS[c].label}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid-2">
        <Field label={t("Precio mínimo")}><MoneyInput cents={params.min_price_cents ?? null} onChange={(c) => set({ min: c })} /></Field>
        <Field label={t("Precio máximo")}><MoneyInput cents={params.max_price_cents ?? null} onChange={(c) => set({ max: c })} /></Field>
      </div>
      {(params.min_price_cents || params.max_price_cents) ? <span className="small dim">{t("Entre")}{" "}{money(params.min_price_cents ?? 0)} {t("y")} {params.max_price_cents ? money(params.max_price_cents) : t("sin límite")}</span> : null}
      <Toggle checked={!!params.only_available} onChange={(v) => set({ avail: v ? 1 : null })} label={t("Solo con unidades disponibles")} />
      <Toggle checked={!!params.only_deals} onChange={(v) => set({ deals: v ? 1 : null })} label={t("Solo artículos que bajaron de precio")} />
      <span className="small dim"><Icon name="info" size={14} /> {" "}{t("Los filtros se aplican al instante.")}</span>
    </>
  );
}
