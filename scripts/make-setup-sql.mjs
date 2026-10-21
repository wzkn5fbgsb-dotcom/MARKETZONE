// Genera la página de instalación de la base de datos (para pegar en el SQL Editor de Supabase desde el móvil)
// y un archivo SQL único. Salida: dist-setup/index.html y dist-setup/marketzone-setup.sql
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const groups = [["0100", "0200"], ["0300"], ["0400"], ["0500", "0600", "0700", "0800", "0900"], ["1000"]];
const parts = groups.map((g, i) => {
  const fs = files.filter((f) => g.some((n) => f.includes(`_${n}`.replace("_", "00") ) || f.split("_")[0].endsWith(n)));
  return { n: i + 1, files: fs, sql: fs.map((f) => `-- ===== ${f}\n` + readFileSync(join(dir, f), "utf8")).join("\n\n") };
});
const used = parts.flatMap((p) => p.files);
if (used.length !== files.length) { console.error("Faltan migraciones:", files.filter((f) => !used.includes(f))); process.exit(1); }
const out = join(root, "dist-setup"); mkdirSync(out, { recursive: true });
writeFileSync(join(out, "marketzone-setup.sql"), parts.map((p) => p.sql).join("\n\n"));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const verify = `select count(*) as tablas from information_schema.tables where table_schema = 'public';`;
const html = `<title>MARKETZONE · Base de datos</title>
<style>
:root{--bg:#0B0B0D;--s:#1C1C22;--line:#303038;--t:#fff;--m:#B8B8C2;--c:#DC143C;--ok:#3DD68C;color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--t);font:16px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:640px;margin:0 auto;padding:20px 16px 60px}
h1{font-size:24px;margin:0 0 4px;letter-spacing:-.01em}h1 b{color:var(--c)}
p{color:var(--m);margin:6px 0 14px}
ol{padding-left:20px;color:var(--m)}li{margin:4px 0}
.card{background:var(--s);border:1px solid var(--line);border-radius:14px;padding:16px;margin:14px 0}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px}
h2{font-size:18px;margin:0}small{color:var(--m)}
button{font:600 16px system-ui;border:0;border-radius:999px;padding:12px 20px;background:var(--c);color:#fff;min-height:44px;cursor:pointer}
button.done{background:#24242B;color:var(--ok)}
textarea{width:100%;box-sizing:border-box;height:90px;margin-top:10px;background:#141418;color:var(--m);border:1px solid var(--line);border-radius:8px;font:12px ui-monospace,monospace}
.warn{border-color:#A30F2D}
code{background:#141418;padding:2px 6px;border-radius:6px}
</style>
<main>
<h1>MARKET<b>ZONE</b> · instalar base de datos</h1>
<p>Pega y ejecuta cada parte <b>en orden</b>, una sola vez. <b>Si ya instalaste las partes 1 a 4, ejecuta solo la parte 5</b> (eliminar cuenta y bloquear usuarios).</p>
<div class="card"><ol>
<li>En Supabase abre <b>SQL Editor</b> → <b>New query</b>.</li>
<li>Aquí toca <b>Copiar parte 1</b>.</li>
<li>En el SQL Editor mantén pulsado → <b>Pegar</b> → <b>Run</b>. Debe decir <i>Success</i>.</li>
<li>Abre otra pestaña con <b>+</b> y repite con las siguientes partes.</li>
</ol></div>
${parts.map((p) => `<div class="card"><div class="row"><div><h2>Parte ${p.n} de ${parts.length}</h2><small>${(p.sql.length / 1024).toFixed(0)} KB</small></div><button data-part="${p.n}">Copiar parte ${p.n}</button></div><textarea readonly id="t${p.n}" aria-label="SQL parte ${p.n}">${esc(p.sql)}</textarea></div>`).join("\n")}
<div class="card"><div class="row"><div><h2>Comprobar</h2><small>Opcional: debe mostrar un número mayor que 20.</small></div><button data-part="v">Copiar</button></div><textarea readonly id="tv">${esc(verify)}</textarea></div>
<div class="card warn"><p style="margin:0">Si una parte da error, no sigas: haz captura del mensaje y mándamela. Si una parte dice <code>already exists</code>, ya estaba ejecutada; pasa a la siguiente.</p></div>
</main>
<script>
document.querySelectorAll("button[data-part]").forEach(function (b) {
  b.addEventListener("click", async function () {
    var t = document.getElementById("t" + b.dataset.part), ok = false;
    try { await navigator.clipboard.writeText(t.value); ok = true; } catch (e) {}
    if (!ok) { try { t.focus(); t.setSelectionRange(0, t.value.length); ok = document.execCommand("copy"); } catch (e) {} }
    var label = b.textContent;
    b.textContent = ok ? "Copiado ✓" : "Selecciona el texto y copia";
    if (ok) b.classList.add("done");
    setTimeout(function () { if (!ok) b.textContent = label; }, 2500);
  });
});
</script>
`;
writeFileSync(join(out, "index.html"), html);
console.log(parts.map((p) => `parte ${p.n}: ${p.files.join(", ")} (${(p.sql.length / 1024).toFixed(0)} KB)`).join("\n"));
