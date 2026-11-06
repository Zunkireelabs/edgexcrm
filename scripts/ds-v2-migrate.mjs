#!/usr/bin/env node
// Design System v2 codemod (EDGEX-85 §9).
//
//   node scripts/ds-v2-migrate.mjs <file-or-dir>... [--write]
//
// Dry run by default: prints a unified diff and a report. Only touches JSX for Button, Badge, Table
// and SheetContent imported from "@/components/ui/*". Adds look="v2" and maps legacy variant/size
// names to v2 ones. It never guesses: anything dynamic, unknown, spread, asChild, or a
// buttonVariants(...) call goes to the report and is left untouched.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const TARGETS = {
  "@/components/ui/button": ["Button"],
  "@/components/ui/badge": ["Badge"],
  "@/components/ui/table": ["Table"],
  "@/components/ui/sheet": ["SheetContent"],
}

const BUTTON_VARIANT = {
  default: "primary",
  outline: "secondary",
  secondary: "secondary",
  ghost: "ghost",
  link: "link",
  destructive: "destructive",
}
const BUTTON_SIZE = { default: "default", lg: "default", sm: "sm", xs: "sm" }
const BADGE_VARIANT = { secondary: "neutral", outline: "neutral" }

function mapButtonSize(name) {
  if (name.startsWith("icon")) return "icon"
  return BUTTON_SIZE[name] ?? null
}

/** The string value of an attribute, or { dynamic: true } when it is not a plain literal. */
function literalOf(attr) {
  const init = attr.initializer
  if (!init) return { dynamic: true }
  if (ts.isStringLiteral(init)) return { value: init.text, node: init }
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { value: e.text, node: init }
  }
  return { dynamic: true }
}

const FIGHT_RE = /^(rounded|h|min-h|max-h|p|px|py|pt|pb|pl|pr|bg|border|shadow|font)(-|$)/
const TEXT_NOT_STYLE = /^text-(left|center|right|justify|start|end|ellipsis|clip|wrap|nowrap|balance|pretty)$/

/** Utilities in a className that would fight the v2 look (rounded, size, padding, bg, text size/colour, border, shadow, font). */
function styleOverrides(attr) {
  if (!attr || !attr.initializer) return []
  const found = []
  const scan = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      for (const tok of node.text.split(/\s+/).filter(Boolean)) {
        const base = tok.replace(/^(?:[^[\s]*?:)+(?=[^:]*$)/, "").replace(/^!/, "")
        if (FIGHT_RE.test(base) || (base.startsWith("text-") && !TEXT_NOT_STYLE.test(base))) found.push(tok)
      }
    }
    ts.forEachChild(node, scan)
  }
  scan(attr.initializer)
  return found
}

/**
 * Transform one source string. Returns { output, changed, report } where report is a list of
 * { line, component, kind: "changed" | "needs-human", message }.
 */
export function transformSource(source, fileName = "file.tsx") {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const local = new Map() // local identifier -> canonical component name
  const variantsLocals = new Set() // local names of buttonVariants
  const report = []
  const edits = [] // { start, end, text }

  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue
    const mod = st.moduleSpecifier.text
    const named = st.importClause?.namedBindings
    if (!named || !ts.isNamedImports(named)) continue
    for (const el of named.elements) {
      const imported = (el.propertyName ?? el.name).text
      if (TARGETS[mod]?.includes(imported)) local.set(el.name.text, imported)
      if (mod === "@/components/ui/button" && imported === "buttonVariants") variantsLocals.add(el.name.text)
    }
  }
  if (local.size === 0 && variantsLocals.size === 0) return { output: source, changed: false, report }

  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1

  function handle(node, opening) {
    const name = opening.tagName
    if (!ts.isIdentifier(name)) return
    const comp = local.get(name.text)
    if (!comp) return
    const line = lineOf(opening)
    const attrs = opening.attributes.properties
    const hold = (message) => report.push({ line, component: comp, kind: "needs-human", message })

    if (attrs.some((a) => ts.isJsxAttribute(a) && a.name.text === "look")) return // already has look: skipped
    if (attrs.some((a) => ts.isJsxSpreadAttribute(a))) return hold("spread props: cannot tell the variant statically")
    const attr = (n) => attrs.find((a) => ts.isJsxAttribute(a) && a.name.text === n)

    const local_edits = [{ start: name.getEnd(), end: name.getEnd(), text: ' look="v2"' }]

    if (comp === "Button") {
      const v = attr("variant")
      if (v) {
        const lit = literalOf(v)
        if (lit.dynamic) return hold("dynamic variant expression")
        const to = BUTTON_VARIANT[lit.value]
        if (!to) return hold(`unknown variant "${lit.value}"`)
        local_edits.push({ start: lit.node.getStart(sf), end: lit.node.getEnd(), text: `"${to}"` })
      } else {
        // The legacy default is "default" (a solid fill) which is v2 "primary"; v2's own default is secondary.
        local_edits.push({ start: name.getEnd(), end: name.getEnd(), text: ' variant="primary"' })
      }
      const sz = attr("size")
      if (sz) {
        const lit = literalOf(sz)
        if (lit.dynamic) return hold("dynamic size expression")
        const to = mapButtonSize(lit.value)
        if (!to) return hold(`unknown size "${lit.value}"`)
        local_edits.push({ start: lit.node.getStart(sf), end: lit.node.getEnd(), text: `"${to}"` })
      }
    } else if (comp === "Badge") {
      const v = attr("variant")
      if (!v) return hold('no variant (legacy "default" has no v2 equivalent)')
      const lit = literalOf(v)
      if (lit.dynamic) return hold("dynamic variant expression")
      const to = BADGE_VARIANT[lit.value]
      if (!to) return hold(`variant "${lit.value}" needs a human (v2 has neutral/count/ai/preview only)`)
      local_edits.push({ start: lit.node.getStart(sf), end: lit.node.getEnd(), text: `"${to}"` })
    }

    edits.push(...local_edits)
    report.push({ line, component: comp, kind: "changed", message: "look=\"v2\" added" })
    const fights = styleOverrides(attr("className"))
    if (fights.length) report.push({ line, component: comp, kind: "review", message: `overrides: ${fights.join(" ")}` })
  }

  function visit(node) {
    if (ts.isJsxSelfClosingElement(node)) handle(node, node)
    else if (ts.isJsxElement(node)) handle(node, node.openingElement)
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && variantsLocals.has(node.expression.text)) {
      report.push({ line: lineOf(node), component: "buttonVariants", kind: "needs-human", message: "buttonVariants(...) call: left untouched" })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (edits.length === 0) return { output: source, changed: false, report }
  // Apply back to front; at equal positions keep insertion order stable (look before variant).
  const indexed = edits.map((e, i) => ({ ...e, i }))
  indexed.sort((a, b) => b.start - a.start || b.i - a.i)
  let output = source
  for (const e of indexed) output = output.slice(0, e.start) + e.text + output.slice(e.end)
  return { output, changed: true, report }
}

/** Line-by-line unified diff. Edits never add or remove lines, so lines align by index. */
export function unifiedDiff(file, before, after) {
  if (before === after) return ""
  const a = before.split("\n")
  const b = after.split("\n")
  const changedAt = []
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changedAt.push(i)
  const CTX = 2
  const hunks = []
  for (const i of changedAt) {
    const last = hunks[hunks.length - 1]
    if (last && i - last.end <= CTX * 2) last.end = i
    else hunks.push({ start: i, end: i })
  }
  const out = [`--- a/${file}`, `+++ b/${file}`]
  for (const h of hunks) {
    const s = Math.max(0, h.start - CTX)
    const e = Math.min(a.length - 1, h.end + CTX)
    out.push(`@@ -${s + 1},${e - s + 1} +${s + 1},${e - s + 1} @@`)
    for (let i = s; i <= e; i++) {
      if (a[i] === b[i]) out.push(` ${a[i]}`)
      else out.push(`-${a[i]}`, `+${b[i]}`)
    }
  }
  return out.join("\n")
}

function collect(target, out) {
  const st = fs.statSync(target)
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(target)) {
      if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue
      collect(path.join(target, e), out)
    }
  } else if (/\.(tsx|jsx)$/.test(target)) out.push(target)
}

function main(argv) {
  const write = argv.includes("--write")
  const targets = argv.filter((a) => !a.startsWith("--"))
  if (targets.length === 0) {
    console.error("usage: node scripts/ds-v2-migrate.mjs <file-or-dir>... [--write]")
    process.exit(2)
  }
  const files = []
  for (const t of targets) collect(t, files)
  let changedFiles = 0
  let humanCount = 0
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const { output, changed, report } = transformSource(src, f)
    const human = report.filter((r) => r.kind === "needs-human")
    for (const r of report.filter((x) => x.kind === "review")) console.log(`REVIEW STYLING  ${f}:${r.line}  <${r.component}>  ${r.message}`)
    humanCount += human.length
    if (changed) {
      changedFiles++
      console.log(unifiedDiff(f, src, output))
      if (write) fs.writeFileSync(f, output)
    }
    for (const r of human) console.log(`NEEDS A HUMAN  ${f}:${r.line}  <${r.component}>  ${r.message}`)
  }
  console.log(`\n${write ? "WROTE" : "DRY RUN"}: ${changedFiles} file(s) changed of ${files.length} scanned; ${humanCount} item(s) need a human.`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main(process.argv.slice(2))
