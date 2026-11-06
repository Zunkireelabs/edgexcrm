#!/usr/bin/env node
/**
 * EDGEX-94 codemod: lucide-react -> @phosphor-icons/react.
 *
 *   node scripts/codemods/lucide-to-phosphor.mjs [--write] [dir-or-file ...]
 *
 * DRY RUN by default: prints the report and changes nothing. `--write` applies.
 * Idempotent: files without a `lucide-react` import are untouched.
 * Mapping: lucide-to-phosphor.map.json (lucide name -> Phosphor base name).
 * Renames use the TypeScript LanguageService (findRenameLocations), never regex.
 *
 * After adding a shadcn component (it ships with lucide imports), run this with --write.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAP = JSON.parse(fs.readFileSync(path.join(HERE, "lucide-to-phosphor.map.json"), "utf8"));
const TYPE_MAP = { LucideIcon: "Icon", LucideProps: "IconProps" };
const CLIENT_ENTRY = "@phosphor-icons/react";
const SSR_ENTRY = "@phosphor-icons/react/dist/ssr";

/** lucide import name -> Phosphor base name (or undefined if unmapped). */
function resolveBase(name) {
  if (MAP[name]) return MAP[name];
  if (name.endsWith("Icon") && MAP[name.slice(0, -4)]) return MAP[name.slice(0, -4)];
  return undefined;
}

function hasUseClient(sf) {
  for (const st of sf.statements) {
    if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)) {
      if (st.expression.text === "use client") return true;
    } else break;
  }
  return false;
}

/** Names declared in the file, split by namespace (value / type). Imports count as both. */
function collectDeclarations(sf, skipImport) {
  const values = new Set();
  const types = new Set();
  const visit = (n) => {
    if (n === skipImport) return;
    const add = (id, v, t) => {
      if (id && ts.isIdentifier(id)) {
        if (v) values.add(id.text);
        if (t) types.add(id.text);
      }
    };
    if (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) {
      if (ts.isIdentifier(n.name)) add(n.name, true, false);
    } else if (ts.isFunctionDeclaration(n) || ts.isEnumDeclaration(n)) add(n.name, true, ts.isEnumDeclaration(n));
    else if (ts.isClassDeclaration(n)) add(n.name, true, true);
    else if (ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isTypeParameterDeclaration(n)) add(n.name, false, true);
    else if (ts.isImportSpecifier(n) || ts.isNamespaceImport(n) || ts.isImportClause(n)) add(n.name, true, true);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { values, types };
}

function makeService(fileName, text) {
  const host = {
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => "1",
    getScriptSnapshot: (f) => (f === fileName ? ts.ScriptSnapshot.fromString(text) : undefined),
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => ({ jsx: ts.JsxEmit.Preserve, allowJs: true, noResolve: true, noLib: true, target: ts.ScriptTarget.ES2022 }),
    getDefaultLibFileName: () => "lib.d.ts",
    fileExists: (f) => f === fileName,
    readFile: (f) => (f === fileName ? text : undefined),
  };
  return ts.createLanguageService(host, ts.createDocumentRegistry());
}

/**
 * Transform one source string. Returns { text, changed, info } where info has
 * { aliases: string[], unmapped: string[], renames: [from,to][], props: string[], manual: string[] }.
 */
export function transformSource(fileName, text) {
  const info = { aliases: [], unmapped: [], renames: [], props: [], manual: [] };
  const kind = /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : /\.ts$/.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.TSX;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, kind);
  const imports = sf.statements.filter((s) => ts.isImportDeclaration(s) && s.moduleSpecifier.text === "lucide-react");
  if (!imports.length) return { text, changed: false, info };

  const service = makeService(fileName, text);
  const edits = []; // { start, end, text }
  const lucideLocals = new Set();
  const newImports = []; // per declaration replacement

  const client = hasUseClient(sf);
  for (const decl of imports) {
    const clause = decl.importClause;
    const bindings = clause?.namedBindings;
    if (!clause || clause.name || !bindings || !ts.isNamedImports(bindings)) {
      info.unmapped.push("<non-named lucide import>");
      return { text, changed: false, info };
    }
    const { values, types } = collectDeclarations(sf, decl);
    // groups: key = `${typeOnly}:${phosphorName}` -> { phosphor, typeOnly, locals:Set }
    const groups = new Map();
    for (const spec of bindings.elements) {
      const imported = (spec.propertyName ?? spec.name).text;
      const local = spec.name.text;
      const hasAlias = !!spec.propertyName;
      const typeOnly = clause.isTypeOnly || spec.isTypeOnly;
      let phosphor;
      if (TYPE_MAP[imported]) phosphor = TYPE_MAP[imported];
      else {
        const base = resolveBase(imported);
        if (!base) {
          info.unmapped.push(imported);
          continue;
        }
        phosphor = `${base}Icon`;
      }
      const isType = !!TYPE_MAP[imported];
      const key = `${isType || typeOnly ? "t" : "v"}:${phosphor}`;
      if (!groups.has(key)) groups.set(key, { phosphor, typeOnly: isType || typeOnly, isType, locals: [] });
      groups.get(key).locals.push({ local, hasAlias, spec });
    }
    if (info.unmapped.length) return { text, changed: false, info };

    const specs = [];
    for (const g of groups.values()) {
      // Does the Phosphor name collide with something in the file (not one of our own lucide locals)?
      const ownLocals = new Set(g.locals.map((l) => l.local));
      const space = g.isType ? types : values;
      const collides = space.has(g.phosphor) && !ownLocals.has(g.phosphor);
      const aliased = g.locals.filter((l) => l.hasAlias);
      const plain = g.locals.filter((l) => !l.hasAlias);
      // Pick the canonical local name for plain locals.
      if (plain.length) {
        const canonical = collides ? plain[0].local : g.phosphor;
        if (collides) {
          info.aliases.push(`${g.phosphor} as ${canonical}`);
          specs.push(`${g.typeOnly && !g.isType ? "type " : ""}${g.phosphor} as ${canonical}`);
        } else {
          specs.push(`${g.typeOnly && !g.isType ? "type " : ""}${g.phosphor}`);
        }
        for (const l of plain) {
          lucideLocals.add(l.local);
          if (l.local !== canonical) {
            // rename every reference of this local to canonical
            const pos = l.spec.name.getStart(sf);
            const locs = service.findRenameLocations(fileName, pos, false, false, { providePrefixAndSuffixTextForRename: true }) ?? [];
            for (const loc of locs) {
              if (loc.textSpan.start >= decl.getStart(sf) && loc.textSpan.start < decl.getEnd()) continue;
              edits.push({
                start: loc.textSpan.start,
                end: loc.textSpan.start + loc.textSpan.length,
                text: `${loc.prefixText ?? ""}${canonical}${loc.suffixText ?? ""}`,
              });
            }
            info.renames.push([l.local, canonical]);
          }
        }
        if (collides) {
          // fallthrough: alias keeps the old local, so nothing else to rename for plain[0]
        }
      }
      for (const l of aliased) {
        lucideLocals.add(l.local);
        const typePrefix = g.typeOnly && !g.isType ? "type " : "";
        if (l.local === g.phosphor) specs.push(`${typePrefix}${g.phosphor}`);
        else {
          info.aliases.push(`${g.phosphor} as ${l.local}`);
          specs.push(`${typePrefix}${g.phosphor} as ${l.local}`);
        }
      }
    }
    // dedupe, keep order
    const uniq = [...new Set(specs)];
    const typeSpecs = uniq.filter((s) => /^(Icon|IconProps)\b/.test(s));
    const valueSpecs = uniq.filter((s) => !typeSpecs.includes(s));
    const parts = [];
    const fmt = (list, prefix, entry) => {
      const oneLine = `import ${prefix}{ ${list.join(", ")} } from "${entry}";`;
      return oneLine.length <= 100 ? oneLine : `import ${prefix}{\n${list.map((s) => `  ${s},`).join("\n")}\n} from "${entry}";`;
    };
    if (valueSpecs.length) {
      const allTypeOnlyVals = valueSpecs.every((s) => s.startsWith("type "));
      if (allTypeOnlyVals) parts.push(fmt(valueSpecs.map((s) => s.replace(/^type /, "")), "type ", client ? CLIENT_ENTRY : SSR_ENTRY));
      else parts.push(fmt(valueSpecs, "", client ? CLIENT_ENTRY : SSR_ENTRY));
    }
    // Phosphor's ssr entry does not export the Icon/IconProps types: type imports always use the main entry
    // (erased at build, so no client-context code is pulled into server files).
    if (typeSpecs.length) parts.push(fmt(typeSpecs, "type ", CLIENT_ENTRY));
    newImports.push({ decl, text: parts.join("\n") });
  }

  // JSX props: strip strokeWidth / absoluteStrokeWidth on lucide tags.
  const visit = (n) => {
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
      const tag = n.tagName.getText(sf);
      if (lucideLocals.has(tag)) {
        for (const attr of n.attributes.properties) {
          if (!ts.isJsxAttribute(attr)) continue;
          const name = attr.name.getText(sf);
          if (name !== "strokeWidth" && name !== "absoluteStrokeWidth") continue;
          let replacement = "";
          let desc = `${tag} ${name} removed`;
          if (name === "strokeWidth") {
            const init = attr.initializer;
            const expr = init && ts.isJsxExpression(init) ? init.expression : init;
            if (expr && ts.isNumericLiteral(expr)) {
              if (Number(expr.text) >= 2.5) {
                replacement = 'weight="bold"';
                desc = `${tag} strokeWidth={${expr.text}} -> weight="bold"`;
              } else desc = `${tag} strokeWidth={${expr.text}} removed`;
            } else {
              info.manual.push(`${tag} non-literal strokeWidth (${attr.getText(sf)}) removed, check weight`);
            }
          }
          // eat one leading space
          let start = attr.getFullStart();
          const end = attr.getEnd();
          if (replacement) start = attr.getStart(sf);
          edits.push({ start, end, text: replacement });
          info.props.push(desc);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  for (const ni of newImports) edits.push({ start: ni.decl.getStart(sf), end: ni.decl.getEnd(), text: ni.text });

  // apply (descending, dedupe identical ranges)
  const seen = new Set();
  const uniqEdits = edits.filter((e) => {
    const k = `${e.start}:${e.end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  uniqEdits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of uniqEdits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { text: out, changed: out !== text, info };
}

function walk(p, acc) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(p)) {
      if (f === "node_modules" || f === ".next" || f.startsWith(".")) continue;
      walk(path.join(p, f), acc);
    }
  } else if (/\.(tsx?|jsx?)$/.test(p)) acc.push(p);
  return acc;
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const targets = args.filter((a) => !a.startsWith("--"));
  const files = (targets.length ? targets : ["src"]).flatMap((t) => walk(t, []));
  let changed = 0;
  const aliasReport = [];
  const unmapped = [];
  const propReport = [];
  const manual = [];
  const renameCount = {};
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    if (!text.includes("lucide-react")) continue;
    const r = transformSource(f, text);
    for (const u of r.info.unmapped) unmapped.push(`${f}: ${u}`);
    if (!r.changed) continue;
    changed++;
    for (const a of r.info.aliases) aliasReport.push(`${f}: ${a}`);
    for (const p of r.info.props) propReport.push(`${f}: ${p}`);
    for (const m of r.info.manual) manual.push(`${f}: ${m}`);
    for (const [from, to] of r.info.renames) renameCount[`${from} -> ${to}`] = (renameCount[`${from} -> ${to}`] ?? 0) + 1;
    if (write) fs.writeFileSync(f, r.text);
  }
  console.log(`${write ? "WROTE" : "DRY RUN (no files changed; pass --write)"}: ${changed} file(s) with lucide imports`);
  console.log(`Renames (${Object.keys(renameCount).length} distinct):`);
  for (const [k, v] of Object.entries(renameCount).sort()) console.log(`  ${k}  x${v}`);
  console.log(`Alias fallbacks (${aliasReport.length}):`);
  aliasReport.forEach((a) => console.log(`  ${a}`));
  console.log(`Prop changes (${propReport.length}):`);
  propReport.forEach((a) => console.log(`  ${a}`));
  console.log(`Manual follow-ups (${manual.length}):`);
  manual.forEach((a) => console.log(`  ${a}`));
  console.log(`Unmapped / skipped (${unmapped.length}):`);
  unmapped.forEach((a) => console.log(`  ${a}`));
  if (unmapped.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
