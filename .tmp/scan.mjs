import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const files = [];
const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.tsx?$/.test(f.name)) files.push(p); } };
walk("src");
const spanish = /[a-záéíóúñ¿¡]/i;
let total = 0; const per = {}; const uniq = new Set();
for (const f of files) {
  if (f.includes("/api/demo/") || f.endsWith("art.ts")) continue;
  const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let n = 0;
  const visit = (node) => {
    if (ts.isJsxText(node)) { const t = node.text.trim(); if (t && /[a-záéíóúñ]{2,}/i.test(t)) { n++; uniq.add(t); } }
    else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && /\s/.test(node.text) && /[a-záéíóúñ]{3,}/i.test(node.text) && !/^[\w.-]+$/.test(node.text) && !node.text.includes("var(") && !/^(btn|row|stack|small|link|chip)/.test(node.text)) { n++; uniq.add(node.text); }
    else if (ts.isTemplateExpression(node)) { n++; }
    ts.forEachChild(node, visit);
  };
  visit(sf); per[f] = n; total += n;
}
console.log(total, uniq.size); console.log(Object.entries(per).sort((a,b)=>b[1]-a[1]).slice(0,25).map(x=>x.join(" ")).join("\n"));
