// Compilación de MARKETXONE con esbuild (sin Vite ni dependencias adicionales).
//   node scripts/build.mjs web        -> dist/ (index.html + assets) para cualquier hosting estático
//   node scripts/build.mjs artifact   -> dist-artifact/index.html (un solo archivo, modo demo)
//   node scripts/build.mjs web --serve   servidor local con recarga en http://localhost:5173
// Variables: MZ_SUPABASE_URL, MZ_SUPABASE_ANON_KEY (públicas), MZ_MODE (auto|demo|supabase), MZ_ROUTER (hash|history)
import * as esbuild from "esbuild";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] ?? "web";
const serve = process.argv.includes("--serve");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const build = {
  mode: process.env.MZ_MODE ?? (target === "artifact" ? "demo" : "auto"),
  router: process.env.MZ_ROUTER ?? "hash",
  supabaseUrl: target === "artifact" ? "" : process.env.MZ_SUPABASE_URL ?? "",
  supabaseAnonKey: target === "artifact" ? "" : process.env.MZ_SUPABASE_ANON_KEY ?? "",
  target,
  version: pkg.version,
};
if (/service_role/.test(Buffer.from((build.supabaseAnonKey.split(".")[1] ?? ""), "base64").toString())) {
  console.error("ERROR: MZ_SUPABASE_ANON_KEY parece una clave service_role. Nunca la incluyas en la web.");
  process.exit(1);
}

// Fuentes propias (OFL) alojadas con la web: no dependen de Google y funcionarán igual en la app nativa.
function fontFaces(inline) {
  const src = (f) => inline ? `data:font/woff;base64,${readFileSync(join(root, "public/fonts", f)).toString("base64")}` : `fonts/${f}`;
  return `<style>@font-face{font-family:"Archivo";src:url("${src("archivo.woff")}") format("woff");font-weight:100 900;font-stretch:62% 125%;font-display:swap}` +
    `@font-face{font-family:"Instrument Sans";src:url("${src("instrument-sans.woff")}") format("woff");font-weight:400 700;font-stretch:75% 100%;font-display:swap}</style>`;
}
// Aplica el tema guardado antes del primer pintado (mismo algoritmo que src/app/theme.ts).
const THEME_BOOT = `<script>(function(){try{var p=localStorage.getItem("mz.theme")||"dark";var t=p==="auto"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p;document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="dark";}})();</script>`;
const DESCRIPTION = "MARKETXONE: marketplace de moda, sneakers y streetwear con inventario por talla, ofertas y herramientas para negocios.";

const options = {
  entryPoints: [join(root, "src/main.tsx")],
  bundle: true,
  minify: !serve,
  sourcemap: serve ? "inline" : false,
  format: "iife",
  target: ["es2020", "safari15"],
  jsx: "automatic",
  loader: { ".css": "css" },
  define: { __MZ_BUILD__: JSON.stringify(build), "process.env.NODE_ENV": JSON.stringify(serve ? "development" : "production") },
  legalComments: "none",
  charset: "ascii", // escapa caracteres no ASCII: el bundle funciona aunque falte <meta charset>
  logLevel: "warning",
};

function htmlShell({ head, body }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>MARKETXONE</title>
<meta name="description" content="${DESCRIPTION}">
<meta name="theme-color" content="#0B0B0D">
${THEME_BOOT}
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="MARKETXONE">
<link rel="icon" type="image/svg+xml" href="icon.svg">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="manifest" href="manifest.webmanifest">
${fontFaces(false)}
${head}
</head>
<body>
<div id="root"></div>
${body}
</body>
</html>
`;
}

async function buildWeb(outdir) {
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(join(outdir, "assets"), { recursive: true });
  await esbuild.build({ ...options, outfile: join(outdir, "assets/app.js") });
  writeFileSync(join(outdir, "index.html"), htmlShell({ head: '<link rel="stylesheet" href="assets/app.css">', body: '<script src="assets/app.js"></script>' }));
  copyDir(join(root, "public"), outdir);
  // GitHub Pages / hosting con rutas: copia 404 -> index para navegación directa
  copyFileSync(join(outdir, "index.html"), join(outdir, "404.html"));
}

function copyDir(from, to) {
  if (!existsSync(from)) return;
  for (const f of readdirSync(from, { withFileTypes: true })) {
    const s = join(from, f.name), d = join(to, f.name);
    if (f.isDirectory()) { mkdirSync(d, { recursive: true }); copyDir(s, d); } else copyFileSync(s, d);
  }
}

async function buildArtifact(outdir) {
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  const res = await esbuild.build({ ...options, write: false, outdir: join(outdir, "tmp") });
  const js = res.outputFiles.find((f) => f.path.endsWith(".js")).text.replace(/<\/script/gi, "<\\/script");
  const css = res.outputFiles.find((f) => f.path.endsWith(".css")).text.replace(/<\/style/gi, "<\\/style");
  // Formato de página de Artifact: sin <html>/<head>/<body> (el visor añade el esqueleto).
  const page = `<title>MARKETXONE</title>
${THEME_BOOT}
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="${DESCRIPTION}">
${fontFaces(true)}
<style>${css}</style>
<div id="root"></div>
<script>${js}</script>
`;
  writeFileSync(join(outdir, "index.html"), page);
  // Versión independiente (abrir el archivo directamente en un navegador)
  writeFileSync(join(outdir, "standalone.html"), htmlShell({ head: `${fontFaces(true)}<style>${css}</style>`, body: `<script>${js}</script>` }).replace('<link rel="manifest" href="manifest.webmanifest">', "").replace('<link rel="icon" type="image/svg+xml" href="icon.svg">', "").replace('<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">', ""));
  console.log(`artifact: ${(page.length / 1024).toFixed(0)} KB`);
}

if (serve) {
  const outdir = join(root, "dist");
  await buildWeb(outdir);
  const ctx = await esbuild.context({ ...options, outfile: join(outdir, "assets/app.js") });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: outdir, port: 5173, fallback: join(outdir, "index.html") });
  console.log(`MARKETXONE dev en http://localhost:${port}`);
} else if (target === "artifact") {
  await buildArtifact(join(root, "dist-artifact"));
} else {
  await buildWeb(join(root, "dist"));
  console.log("web: dist/ listo");
}
