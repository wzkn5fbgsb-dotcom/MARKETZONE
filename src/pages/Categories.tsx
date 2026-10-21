// Todas las categorías y sus subcategorías, con el número real de artículos publicados.
import { useApp } from "../app/state";
import { Link, withQuery } from "../app/router";
import { categoryArt, categoryBackdrop, countLabel } from "../app/categories";
import { Page } from "../components/layout";
import { Icon } from "../ui/icons";

export default function Categories() {
  const { categories } = useApp();
  const top = categories.filter((c) => !c.parent_id);
  const total = top.reduce((n, c) => n + c.active_count, 0);

  return (
    <Page>
      <div className="stack-xl">
        <header className="row between" style={{ alignItems: "flex-end", gap: 16 }}>
          <div className="stack" style={{ gap: 6 }}>
            <h1 className="h1">Categorías</h1>
            <span className="muted">{total > 0 ? `${countLabel(total)} en ${top.length} categorías.` : "Elige una categoría para ver lo que hay o para vender lo tuyo."}</span>
          </div>
          <Link to="/explorar" className="btn btn-outline btn-sm"><Icon name="grid" size={16} />Ver todo</Link>
        </header>

        <div className="catblocks">
          {top.map((c) => {
            const subs = categories.filter((s) => s.parent_id === c.id);
            const href = withQuery("/explorar", { cat: c.id });
            return (
              <article key={c.id} className="catblock">
                <Link to={href} className="catblock-media" aria-hidden="true" tabIndex={-1} style={{ background: categoryBackdrop(c.id) }}>
                  <img src={categoryArt(c.id)} alt="" loading="lazy" />
                </Link>
                <div className="catblock-body">
                  <Link to={href} className="catblock-head">
                    <h2 className="catblock-name">{c.name}</h2>
                    <span className="small muted">{countLabel(c.active_count)}</span>
                  </Link>
                  {subs.length > 0 && (
                    <ul className="subcats" aria-label={`Subcategorías de ${c.name}`}>
                      {subs.map((s) => (
                        <li key={s.id}>
                          <Link to={withQuery("/explorar", { cat: s.id })} className="subcat">
                            <img src={categoryArt(s.id, c.id)} alt="" loading="lazy" />
                            <span>{s.name}</span>
                            {s.active_count > 0 && <span className="subcat-n num">{s.active_count}</span>}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {c.active_count === 0 && (
                    <Link to={withQuery("/publicar", { cat: c.id })} className="link small">Vende el primero en {c.name}</Link>
                  )}
                </div>
              </article>
            );
          })}
          {!top.length && Array.from({ length: 6 }, (_, i) => <div key={i} className="skel" style={{ height: 320, borderRadius: 18 }} />)}
        </div>
      </div>
    </Page>
  );
}
