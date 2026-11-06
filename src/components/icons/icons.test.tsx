import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import * as Local from "./index";
// Test-only: the original package, as the pixel-identity oracle.
import * as Phosphor from "@phosphor-icons/react/dist/ssr";
import { generate, scan } from "../../../scripts/icons/build-icons.mjs";

const root = path.resolve(__dirname, "../../..");
const walk = (d: string, acc: string[] = []): string[] => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(tsx?|jsx?)$/.test(f)) acc.push(p);
  }
  return acc;
};

describe("generated icons", () => {
  it("generated.tsx is up to date (regenerating gives the same output)", async () => {
    const { text } = await generate();
    expect(fs.readFileSync(path.join(root, "src/components/icons/generated.tsx"), "utf8")).toBe(text);
  });

  it("every icon imported in src is exported, and every weight= use is covered", () => {
    const { icons, errors } = scan(walk(path.join(root, "src")));
    expect(errors).toEqual([]);
    for (const name of icons) expect(Local, name).toHaveProperty(name);
  });

  it("renders markup identical to Phosphor (regular, plus the generated extra weights)", () => {
    const names = Object.keys(Local).filter((k) => k.endsWith("Icon"));
    expect(names.length).toBeGreaterThan(100);
    for (const n of names) {
      const L = (Local as unknown as Record<string, React.ComponentType<Record<string, unknown>>>)[n];
      const P = (Phosphor as unknown as Record<string, React.ComponentType<Record<string, unknown>>>)[n];
      expect(renderToStaticMarkup(<L className="h-4 w-4" />), n).toBe(renderToStaticMarkup(<P className="h-4 w-4" />));
    }
    for (const n of ["StarIcon", "CircleIcon"]) {
      const L = (Local as unknown as Record<string, React.ComponentType<Record<string, unknown>>>)[n];
      const P = (Phosphor as unknown as Record<string, React.ComponentType<Record<string, unknown>>>)[n];
      expect(renderToStaticMarkup(<L weight="fill" size={14} />)).toBe(renderToStaticMarkup(<P weight="fill" size={14} />));
    }
  });

  it("an unknown weight renders the regular paths, never an empty svg", () => {
    const html = renderToStaticMarkup(<Local.TrashIcon weight="duotone" />);
    expect(html).toBe(renderToStaticMarkup(<Local.TrashIcon />));
    expect(html).toContain("<path");
  });
});
