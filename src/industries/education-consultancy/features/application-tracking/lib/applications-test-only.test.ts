import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Fix round 2 (A4): the in-memory PostgREST stand-in is test-only. No non-test source file may import
// anything from a `__test__/` folder.
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "node_modules" && name !== "__test__") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("test-only helpers stay out of app code", () => {
  it("no app source file imports from a __test__ folder", () => {
    const offenders = walk(path.resolve(__dirname, "../../../../../")).filter((f) => /from\s+["'][^"']*\/__test__\//.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
  it("the old dev fixture page is gone", () => {
    expect(() => statSync(path.resolve(__dirname, "../../../../../app/(main)/(dashboard)/applications-fixture"))).toThrow();
  });
});
