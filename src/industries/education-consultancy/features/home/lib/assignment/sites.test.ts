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
