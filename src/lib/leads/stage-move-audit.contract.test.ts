import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Guard (no DB): System Activity shows `Moved from X to Y · with <name>`, which needs the lead's holder on every
// stage-move log entry. Any non-test file that writes a stage move (`changes.list = …` or `list: { old: …`) must
// also use holderChange() — otherwise its lines would be missing the name again (the client-reported gap).

const SRC = join(process.cwd(), "src");
const WRITES_STAGE_MOVE = /changes\.list\s*=|\blist:\s*\{\s*old:/;
const EXEMPT = new Set<string>([
  // The reader (renders the line); not a writer.
  "components/dashboard/lead/activities/activities-panel.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe("every stage-move audit writer records the lead's holder", () => {
  const writers = walk(SRC)
    .map((p) => ({ rel: p.slice(SRC.length + 1), text: readFileSync(p, "utf8") }))
    .filter((f) => WRITES_STAGE_MOVE.test(f.text) && !EXEMPT.has(f.rel));

  it("finds the known writers (so this guard can't silently match nothing)", () => {
    const names = writers.map((w) => w.rel);
    expect(names).toEqual(
      expect.arrayContaining([
        "lib/leads/apply-lead-patch.ts",
        "app/(main)/api/v1/leads/bulk/route.ts",
        "app/(main)/api/v1/leads/[id]/check-in/route.ts",
        "app/(main)/api/v1/class-enrollments/route.ts",
        "app/(main)/api/v1/archived-leads/[id]/restore/route.ts",
      ]),
    );
  });

  it("each one calls holderChange()", () => {
    const missing = writers.filter((w) => !w.text.includes("holderChange(")).map((w) => w.rel);
    expect(missing, `These write a stage move to the audit log without holderChange(): ${missing.join(", ")}`).toEqual([]);
  });
});
