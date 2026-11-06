import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { transformSource } from "../../../scripts/codemods/lucide-to-phosphor.mjs";

const run = (src: string, file = "a.tsx") => transformSource(file, src);
const CLIENT = '"use client";\n';

describe("lucide-to-phosphor codemod", () => {
  it("plain import: renames import and every usage", () => {
    const r = run(`${CLIENT}import { Trash2, Loader2 } from "lucide-react";\nexport const A = () => <div><Trash2 className="h-4" /><Loader2 /></div>;\n`);
    expect(r.text).toContain('import { TrashIcon, CircleNotchIcon } from "@phosphor-icons/react";');
    expect(r.text).toContain('<TrashIcon className="h-4" />');
    expect(r.text).toContain("<CircleNotchIcon />");
    expect(r.text).not.toContain("lucide");
  });

  it("aliased import keeps the local alias", () => {
    const r = run(`${CLIENT}import { Trash2 as Bin } from "lucide-react";\nexport const A = () => <Bin />;\n`);
    expect(r.text).toContain('import { TrashIcon as Bin } from "@phosphor-icons/react";');
    expect(r.text).toContain("<Bin />");
    expect(r.info.aliases).toContain("TrashIcon as Bin");
  });

  it("lucide …Icon alias maps via its base name, shorthand props get a prefix", () => {
    const r = run(`${CLIENT}import { SearchIcon } from "lucide-react";\nconst m = { SearchIcon };\nexport const A = () => <SearchIcon />;\n`);
    expect(r.text).toContain('import { MagnifyingGlassIcon } from "@phosphor-icons/react";');
    expect(r.text).toContain("{ SearchIcon: MagnifyingGlassIcon }");
    expect(r.text).toContain("<MagnifyingGlassIcon />");
  });

  it("two lucide names mapping to one Phosphor icon import once", () => {
    const r = run(`${CLIENT}import { ListTodo, ListChecks } from "lucide-react";\nexport const A = () => <><ListTodo /><ListChecks /></>;\n`);
    expect(r.text.match(/ListChecksIcon/g)!.length).toBe(3); // one import + two usages
    expect(r.text).toContain('import { ListChecksIcon } from "@phosphor-icons/react";');
    expect(r.text).not.toContain("ListTodo");
  });

  it("falls back to an alias when the new name collides with a local binding", () => {
    const r = run(`${CLIENT}import { Trash2 } from "lucide-react";\nconst TrashIcon = 1;\nexport const A = () => <Trash2 n={TrashIcon} />;\n`);
    expect(r.text).toContain('import { TrashIcon as Trash2 } from "@phosphor-icons/react";');
    expect(r.text).toContain("<Trash2 n={TrashIcon} />");
    expect(r.info.aliases).toContain("TrashIcon as Trash2");
  });

  it("server files (no use client) import from /dist/ssr", () => {
    const r = run(`import { Plus } from "lucide-react";\nexport default function P() { return <Plus />; }\n`);
    expect(r.text).toContain('import { PlusIcon } from "@phosphor-icons/react/dist/ssr";');
  });

  it("LucideIcon / LucideProps become Icon / IconProps (type imports)", () => {
    const r = run(`${CLIENT}import { Plus, type LucideIcon, type LucideProps } from "lucide-react";\nconst I: LucideIcon = Plus;\nlet p: LucideProps;\n`);
    expect(r.text).toContain('import { PlusIcon } from "@phosphor-icons/react";');
    expect(r.text).toContain('import type { Icon, IconProps } from "@phosphor-icons/react";');
    expect(r.text).toContain("const I: Icon = PlusIcon;");
    expect(r.text).toContain("let p: IconProps;");
  });

  it("strokeWidth is removed; >= 2.5 becomes weight=bold", () => {
    const r = run(`${CLIENT}import { Check, X } from "lucide-react";\nexport const A = () => <><Check strokeWidth={3} /><X className="a" strokeWidth={1.75} /></>;\n`);
    expect(r.text).toContain('<CheckIcon weight="bold" />');
    expect(r.text).toContain('<XIcon className="a" />');
  });

  it("is idempotent", () => {
    const once = run(`${CLIENT}import { Trash2 } from "lucide-react";\nexport const A = () => <Trash2 />;\n`);
    const twice = run(once.text);
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once.text);
  });

  it("reports unmapped names and changes nothing", () => {
    const r = run(`${CLIENT}import { NotARealIcon } from "lucide-react";\n`);
    expect(r.changed).toBe(false);
    expect(r.info.unmapped).toEqual(["NotARealIcon"]);
  });
});

describe("lucide-to-phosphor CLI modes", () => {
  const script = path.resolve(__dirname, "../../../scripts/codemods/lucide-to-phosphor.mjs");
  const src = `"use client";\nimport { Trash2 } from "lucide-react";\nexport const A = () => <Trash2 />;\n`;

  it("dry run by default: prints the report, writes nothing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l2p-"));
    const f = path.join(dir, "a.tsx");
    fs.writeFileSync(f, src);
    const out = execFileSync("node", [script, f], { encoding: "utf8" });
    expect(out).toContain("DRY RUN");
    expect(fs.readFileSync(f, "utf8")).toBe(src);
  });

  it("--write applies the change", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l2p-"));
    const f = path.join(dir, "a.tsx");
    fs.writeFileSync(f, src);
    const out = execFileSync("node", [script, "--write", f], { encoding: "utf8" });
    expect(out).toContain("WROTE");
    expect(fs.readFileSync(f, "utf8")).toContain("TrashIcon");
  });
});
