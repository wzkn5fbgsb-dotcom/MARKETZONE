// Envuelve los textos visibles en t("…") para traducirlos. Uso: node scripts/i18n-codemod.mjs [--dry]
// Clave = el texto en español. Las plantillas `Hola ${x}` pasan a t("Hola {0}", [x]).
import ts from "typescript";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DRY = process.argv.includes("--dry");
const SKIP = ["src/api/demo/", "src/app/art.ts", "src/i18n/", "src/pages/Admin.tsx", "src/pages/Status.tsx", "src/app/theme.ts", "src/app/config.ts", "src/main.tsx", "src/env.d.ts"];
const NON_TEXT_ATTRS = new Set(["className", "to", "href", "key", "src", "type", "name", "id", "role", "variant", "kind", "icon", "size", "autoComplete",
  "inputMode", "enterKeyHint", "pattern", "rel", "target", "accept", "capture", "htmlFor", "loading", "style", "value", "defaultValue", "method", "autoCapitalize", "dir", "lang"]);
const files = [];
const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.tsx?$/.test(f.name)) files.push(p); } };
walk("src");

const looksText = (s) => {
  const t = s.trim();
  if (!t || !/[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}/.test(t)) return false;
  if (/^(\/|#|https?:|var\(|rgba|data:|art:|mz\.|\.)/.test(t)) return false;
  if (/^[a-z0-9_.:-]+$/.test(t)) return false;              // códigos, claves, clases sueltas
  if (/^[a-z0-9_ -]+$/.test(t) && /(^| )(btn|row|stack|small|link|chip|muted|dim|tiny|h[1-3]|panel|card|grow|between|num|mono|price|zone|eyebrow|ellipsis|clamp-2|center|seg|on)( |$)/.test(t)) return false; // clases CSS
  if (/^[A-Z0-9 _]+$/.test(t) && t.length < 14) return false; // MARKETZONE, siglas
  if (/^(SELECT|INSERT|UPDATE|application\/|image\/|multipart|Bearer|ApiError|currentColor)/.test(t) || t.includes("<svg")) return false;
  return true;
};

function attrName(node) {
  let p = node.parent;
  while (p && !ts.isJsxAttribute(p) && !ts.isJsxElement(p) && !ts.isJsxSelfClosingElement(p) && !ts.isSourceFile(p) && !ts.isBlock(p)) p = p.parent;
  return p && ts.isJsxAttribute(p) ? p.name.getText() : null;
}
function inCodePosition(node) {
  const p = node.parent;
  if (!p) return true;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  if (ts.isElementAccessExpression(p)) return true;
  if (ts.isBinaryExpression(p) && ["===", "!==", "==", "!=", "in"].includes(p.operatorToken.getText())) return true;
  if (ts.isCaseClause(p)) return true;
  if (ts.isCallExpression(p)) {
    const callee = p.expression.getText();
    if (/^(t|useQuery|invalidate|navigate|withQuery|setTimeout|matchMedia|getItem|setItem|removeItem|addEventListener|fetch|structuredClone|JSON\.\w+|console\.\w+|Number|String|Boolean|parseInt|encodeURIComponent)$/.test(callee) || /^(Intl\.|new )/.test(callee)) return true;
    if (/\.(get|set|has|includes|startsWith|endsWith|replace|split|join|indexOf|localeCompare|test|match|call|rpc|invokeFunction|querySelector|setAttribute|getAttribute)$/.test(callee)) return true;
    if (/^api\./.test(callee) || /^this\.call$/.test(callee)) return true;
  }
  const an = attrName(node);
  if (an && NON_TEXT_ATTRS.has(an)) return true;
  return false;
}

const keys = new Set();
let changedFiles = 0, wrapped = 0;
for (const f of files) {
  if (SKIP.some((s) => f.startsWith(s))) continue;
  const src = readFileSync(f, "utf8");
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = [];
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const raw = node.getFullText(sf);
      const text = node.text;
      if (looksText(text)) {
        const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0];
        const core = text.trim().replace(/\s+/g, " ");
        const keepLead = /\n/.test(lead) ? "" : lead ? " " : "", keepTrail = /\n/.test(trail) ? "" : trail ? " " : "";
        keys.add(core);
        edits.push([node.getStart(sf) - (raw.length - raw.trimStart().length) + (raw.length - raw.trimStart().length), node.end,
          `${keepLead ? "{\" \"}" : ""}{t(${JSON.stringify(core)})}${keepTrail ? "{\" \"}" : ""}`]);
      }
      return;
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && looksText(node.text) && !inCodePosition(node)) {
      keys.add(node.text);
      const inAttr = ts.isJsxAttribute(node.parent);
      edits.push([node.getStart(sf), node.end, inAttr ? `{t(${JSON.stringify(node.text)})}` : `t(${JSON.stringify(node.text)})`]);
      return;
    }
    if (ts.isTemplateExpression(node) && !inCodePosition(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
      const statics = parts.join(" ");
      if (looksText(statics) && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,} /.test(statics + " ") && !/^\//.test(node.head.text)) {
        let key = node.head.text;
        const args = [];
        node.templateSpans.forEach((s, i) => { key += `{${i}}` + s.literal.text; args.push(s.expression.getText(sf)); });
        keys.add(key);
        edits.push([node.getStart(sf), node.end, `t(${JSON.stringify(key)}, [${args.join(", ")}])`]);
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!edits.length) continue;
  edits.sort((a, b) => b[0] - a[0]);
  let out = src;
  for (const [s, e, r] of edits) out = out.slice(0, s) + r + out.slice(e);
  if (!/from "(\.\.\/|\.\/)+i18n"/.test(out)) {
    const rel = f.split("/").length - 2; // src/x.tsx -> 0 ; src/pages/x.tsx -> 1
    const path = rel === 0 ? "./i18n" : "../".repeat(rel) + "i18n";
    const lastImport = [...out.matchAll(/^import .*;$/gm)].pop();
    const line = `import { t } from "${path}";\n`;
    out = lastImport ? out.slice(0, lastImport.index + lastImport[0].length + 1) + line + out.slice(lastImport.index + lastImport[0].length + 1) : line + out;
  }
  changedFiles++; wrapped += edits.length;
  if (!DRY) writeFileSync(f, out);
}
writeFileSync(".tmp/i18n-keys.json", JSON.stringify([...keys].sort(), null, 1));
console.log(`archivos: ${changedFiles}, textos envueltos: ${wrapped}, claves únicas: ${keys.size}${DRY ? " (simulación)" : ""}`);
