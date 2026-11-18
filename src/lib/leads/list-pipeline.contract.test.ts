import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Guard (no DB): every Stage (lead_lists row) needs a hidden pipeline — its statuses. A stage created without one makes
// every move into it fail ("Failed to update lead": leads.pipeline_id is NOT NULL). Client report (Manish, Nov 2026):
// the admin-created "Enrolled" stage. This fails the build if code
//   1. creates a lead_lists row without ensureListPipeline(),
//   2. stops self-healing a pipeline-less stage on a lead move, or
//   3. writes pipeline_id = null onto a lead.
// (A DB trigger would also cover manual SQL — tracked separately as a migration; this guards the app code.)

const SRC = join(process.cwd(), "src");

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

const files = walk(SRC).map((p) => ({ rel: p.slice(SRC.length + 1), text: readFileSync(p, "utf8") }));

// Whitespace-tolerant: `.from("lead_lists")` then `.insert(` / `.upsert(` even across lines.
const CREATES_LIST = /from\(\s*["']lead_lists["']\s*\)\s*\.(insert|upsert)\(/;
const BLANKS_LEAD_PIPELINE = /\b\w*[pP]ayload\.pipeline_id\s*=\s*null\b/;

describe("every stage has a pipeline", () => {
  const creators = files.filter((f) => CREATES_LIST.test(f.text));

  it("finds the known stage creator (so this guard can't silently match nothing)", () => {
    expect(creators.map((c) => c.rel)).toContain("app/(main)/api/v1/lead-lists/route.ts");
  });

  it("every file that creates a lead_lists row also calls ensureListPipeline()", () => {
    const missing = creators.filter((c) => !c.text.includes("ensureListPipeline(")).map((c) => c.rel);
    expect(missing, `These create a stage without building its pipeline: ${missing.join(", ")}`).toEqual([]);
  });

  it("the lead-move paths still self-heal a stage that has no pipeline", () => {
    for (const rel of ["lib/leads/apply-lead-patch.ts", "app/(main)/api/v1/leads/bulk/route.ts"]) {
      const f = files.find((x) => x.rel === rel);
      expect(f, `${rel} not found`).toBeDefined();
      expect(f!.text.includes("ensureListPipeline("), `${rel} must call ensureListPipeline()`).toBe(true);
    }
  });

  it("nothing writes pipeline_id = null onto a lead (the NOT NULL column that caused the failure)", () => {
    const offenders = files.filter((f) => BLANKS_LEAD_PIPELINE.test(f.text)).map((f) => f.rel);
    expect(offenders, `These blank a lead's pipeline_id: ${offenders.join(", ")}`).toEqual([]);
  });
});
