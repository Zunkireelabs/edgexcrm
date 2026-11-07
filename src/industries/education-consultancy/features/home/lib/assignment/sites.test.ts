import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// A 7.5k import (or a bulk create, ETL or merge) must NEVER auto-assign. The only callers of requestSmartAssignment() are the
// single-lead creation sites below; anything else asking for an assignment fails this test until it is reviewed here.
const ALLOWED = [
  "src/app/(main)/api/v1/leads/route.ts",
  "src/app/api/public/submit/[tenantSlug]/[formSlug]/route.ts",
  "src/app/(main)/api/v1/integrations/crm/leads/route.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

describe("who may request a smart assignment", () => {
  const root = path.resolve(__dirname, "../../../../../../..");
  const callers = walk(path.join(root, "src"))
    .filter((f) => /\brequestSmartAssignment\(/.test(fs.readFileSync(f, "utf8")) && !f.endsWith("assignment/request.ts"))
    .map((f) => path.relative(root, f));

  it("only the single-lead creation sites call it", () => {
    expect(callers.sort()).toEqual([...ALLOWED].sort());
  });
  it("no import, bulk-create, ETL or merge path is among them", () => {
    for (const f of callers) expect(f).not.toMatch(/import|bulk|etl|merge|backfill/i);
  });
});

// Multi-step website forms finalise in the UPDATE path of /api/v1/leads (lead_id + session_id, is_final flips to true). That path must
// request an assignment exactly once per completion: on the lead that survives a dedup fold, and on the updated lead otherwise.
describe("multi-step form finalisation requests a smart assignment", () => {
  const root2 = path.resolve(__dirname, "../../../../../../..");
  const src = fs.readFileSync(path.join(root2, "src/app/(main)/api/v1/leads/route.ts"), "utf8");
  const update = src.slice(src.indexOf("// Update path: lead_id + session_id provided"), src.indexOf("// Staff-created leads (Add Lead"));
  const calls = update.match(/requestSmartAssignment\(/g) ?? [];

  it("the update path has exactly two call sites: the fold's survivor and the normal finalise", () => {
    expect(update.length).toBeGreaterThan(1000);
    expect(calls).toHaveLength(2);
  });
  it("each fires only when THIS update flipped is_final (the stored lead was not final yet)", () => {
    for (const line of update.split("\n").filter((l) => l.includes("requestSmartAssignment("))) {
      expect(line).toMatch(/!\((existingLead|draftLead) as Lead\)\.is_final/);
    }
  });
  it("the fold requests it for the canonical (surviving) lead, never the soft-deleted draft", () => {
    const fold = update.split("\n").find((l) => l.includes("requestSmartAssignment(") && l.includes("draftLead")) ?? "";
    expect(fold).toContain("leadId: canonical.id");
  });
  it("the create path still requests it once, for new final leads", () => {
    const create = src.slice(src.indexOf("// Staff-created leads (Add Lead"));
    expect(create.match(/requestSmartAssignment\(/g)).toHaveLength(1);
  });
});
