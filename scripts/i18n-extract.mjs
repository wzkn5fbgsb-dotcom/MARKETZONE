// Lista todas las claves t("…") del código y muestra cuáles faltan en cada diccionario.
//   node scripts/i18n-extract.mjs            -> resumen
//   node scripts/i18n-extract.mjs --missing en -> claves sin traducir (JSON)
import ts from "typescript";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const files = [];
const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.tsx?$/.test(f.name) && !p.startsWith("src/i18n")) files.push(p); } };
walk("src");
const keys = new Set();
for (const f of files) {
  const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (n) => {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === "t" && n.arguments[0] && (ts.isStringLiteral(n.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(n.arguments[0]))) keys.add(n.arguments[0].text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
const list = [...keys].sort();
const dictKeys = (l) => {
  const src = readFileSync(`src/i18n/${l}.ts`, "utf8");
  const sf = ts.createSourceFile("d.ts", src, ts.ScriptTarget.Latest, true);
  const out = new Set();
  const visit = (n) => { if (ts.isPropertyAssignment(n) && ts.isStringLiteral(n.name)) out.add(n.name.text); ts.forEachChild(n, visit); };
  visit(sf); return out;
};
const mi = process.argv.indexOf("--missing");
if (mi > 0) { const have = dictKeys(process.argv[mi + 1]); console.log(JSON.stringify(list.filter((k) => !have.has(k)), null, 0)); }
else {
  writeFileSync(".tmp/i18n-keys.json", JSON.stringify(list, null, 1));
  for (const l of ["en", "fr", "zh"]) { const have = dictKeys(l); console.log(l, "traducidas", list.filter((k) => have.has(k)).length, "de", list.length, "| sobrantes", [...have].filter((k) => !keys.has(k)).length); }
}
