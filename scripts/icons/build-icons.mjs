#!/usr/bin/env node
/**
 * EDGEX-94b: generate src/components/icons/generated.tsx — only the Phosphor icons the app
 * imports, and only the weights it uses (regular + the entries in extra-weights.json).
 * Phosphor ships all 6 weights per icon, which cost +12..39 KB of JS per page.
 *
 *   node scripts/icons/build-icons.mjs           # (re)generate
 *   node scripts/icons/build-icons.mjs --check   # exit 1 if generated.tsx is stale
 *
 * Re-run after adding an icon (import it from "@/components/icons") or a non-regular `weight=`.
 * The paths come straight from @phosphor-icons/react/dist/defs/<Name>.es.js, so output is identical.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import ts from "typescript";
import React from "react";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "src");
const OUT = path.join(SRC, "components/icons/generated.tsx");
const DEFS = path.join(ROOT, "node_modules/@phosphor-icons/react/dist/defs");
const MODULES = new Set(["@phosphor-icons/react", "@phosphor-icons/react/dist/ssr", "@/components/icons"]);
const TYPE_NAMES = new Set(["Icon", "IconProps", "IconWeight"]);
const WEIGHTS = ["thin", "light", "regular", "bold", "fill", "duotone"];

function walk(dir, acc = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(tsx?|jsx?)$/.test(f)) acc.push(p);
  }
  return acc;
}

/** Scan src: which icons are imported, and which non-regular weights are used on them. */
export function scan(files) {
  const icons = new Set();
  const used = {}; // base -> Set(weights)
  const errors = [];
  for (const f of files) {
    if (f.startsWith(path.join(SRC, "components/icons") + path.sep)) continue;
    const text = fs.readFileSync(f, "utf8");
    if (!text.includes("phosphor-icons") && !text.includes("@/components/icons")) continue;
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.ES2022, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const local = new Map(); // local identifier -> imported icon name
    const addName = (name) => {
      if (TYPE_NAMES.has(name)) return;
      if (!name.endsWith("Icon")) errors.push(`${path.relative(ROOT, f)}: "${name}" is not a ...Icon name`);
      else icons.add(name);
    };
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && MODULES.has(st.moduleSpecifier.text)) {
        const nb = st.importClause?.namedBindings;
        if (!st.importClause || st.importClause.isTypeOnly || !nb || !ts.isNamedImports(nb)) continue;
        for (const el of nb.elements) {
          if (el.isTypeOnly) continue;
          const imported = (el.propertyName ?? el.name).text;
          addName(imported);
          local.set(el.name.text, imported);
        }
      } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && MODULES.has(st.moduleSpecifier.text) && st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) if (!el.isTypeOnly) addName((el.propertyName ?? el.name).text);
      }
    }
    const visit = (n) => {
      if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
        for (const a of n.attributes.properties) {
          if (!ts.isJsxAttribute(a) || a.name.getText(sf) !== "weight") continue;
          const lits = [];
          const grab = (x) => {
            if (ts.isStringLiteralLike(x)) lits.push(x.text);
            ts.forEachChild(x, grab);
          };
          if (a.initializer) grab(a.initializer);
          const where = `${path.relative(ROOT, f)}: <${n.tagName.getText(sf)} weight=...>`;
          const imported = local.get(n.tagName.getText(sf));
          if (!lits.length) errors.push(`${where}: weight has no string literal; add the weights to extra-weights.json and use literals`);
          for (const w of lits) {
            if (!WEIGHTS.includes(w)) errors.push(`${where}: unknown weight "${w}"`);
            else if (w !== "regular") {
              if (!imported) errors.push(`${where}: "${w}" used on a non-icon tag; cannot attribute it to an icon`);
              else (used[imported.slice(0, -4)] ??= new Set()).add(w);
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { icons, used, errors };
}

function emitNode(node, errors, name) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map((c) => emitNode(c, errors, name)).join("");
  if (node.type === React.Fragment) return emitNode(node.props.children, errors, name);
  if (typeof node.type !== "string") {
    errors.push(`${name}: unexpected non-DOM element in defs`);
    return "";
  }
  const { children, ...props } = node.props;
  const attrs = Object.entries(props)
    .map(([k, v]) => {
      if (typeof v !== "string") errors.push(`${name}: non-string attribute ${k}`);
      return ` ${k}=${JSON.stringify(v)}`;
    })
    .join("");
  const inner = emitNode(children, errors, name);
  return inner ? `<${node.type}${attrs}>${inner}</${node.type}>` : `<${node.type}${attrs} />`;
}

export async function generate() {
  const { icons, used, errors } = scan(walk(SRC));
  const extra = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/icons/extra-weights.json"), "utf8"));
  for (const [base, ws] of Object.entries(used)) {
    for (const w of ws) if (!(extra[base] ?? []).includes(w)) errors.push(`weight "${w}" on ${base}Icon is not listed in scripts/icons/extra-weights.json`);
  }
  for (const base of Object.keys(extra)) icons.add(`${base}Icon`);
  const blocks = [];
  const summary = {};
  for (const name of [...icons].sort()) {
    const base = name.slice(0, -4);
    const file = path.join(DEFS, `${base}.es.js`);
    if (!fs.existsSync(file)) {
      errors.push(`${name}: no Phosphor icon "${base}"`);
      continue;
    }
    const map = (await import(pathToFileURL(file).href)).default;
    const ws = ["regular", ...(extra[base] ?? []).filter((w) => w !== "regular")];
    summary[name] = ws;
    const entries = ws.map((w) => {
      if (!map.has(w)) errors.push(`${name}: no "${w}" weight`);
      return `    ${w}: <>${emitNode(map.get(w), errors, name)}</>,`;
    });
    blocks.push(`export const ${name} = /* @__PURE__ */ makeIcon("${name}", {\n${entries.join("\n")}\n});`);
  }
  if (errors.length) throw new Error(`build-icons failed:\n  ${errors.join("\n  ")}`);
  const text = `// GENERATED by scripts/icons/build-icons.mjs — do not edit. Run \`node scripts/icons/build-icons.mjs\`
// after adding an icon or a non-regular weight=. Only the weights the app uses are shipped (EDGEX-94b).
import { forwardRef, type ReactElement } from "react";
import SSRBase from "@phosphor-icons/react/dist/lib/SSRBase";
import type { Icon, IconProps, IconWeight } from "@phosphor-icons/react";

function makeIcon(name: string, weights: Partial<Record<IconWeight, ReactElement>>): Icon {
  const map = new Map(Object.entries(weights) as [IconWeight, ReactElement][]);
  const C = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
    // A weight we did not generate falls back to regular, never to an empty svg.
    <SSRBase ref={ref} {...props} weight={props.weight && map.has(props.weight) ? props.weight : "regular"} weights={map} />
  ));
  C.displayName = name;
  return C;
}

${blocks.join("\n\n")}
`;
  return { text, summary };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { text, summary } = await generate();
  if (process.argv.includes("--check")) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (cur !== text) {
      console.error("src/components/icons/generated.tsx is stale: run node scripts/icons/build-icons.mjs");
      process.exit(1);
    }
    console.log("generated.tsx is up to date");
  } else {
    fs.writeFileSync(OUT, text);
    console.log(`wrote ${path.relative(ROOT, OUT)}: ${Object.keys(summary).length} icons, ${text.length} bytes`);
    for (const [n, w] of Object.entries(summary)) if (w.length > 1) console.log(`  ${n}: ${w.join(", ")}`);
  }
}
