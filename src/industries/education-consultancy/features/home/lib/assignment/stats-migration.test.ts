import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// education_assignment_stats_refresh must only write rows for CURRENT tenant members. Leads still held by people who
// left would otherwise violate the user_id FK (or quietly put ex-staff in the stats). The SQL can't be unit-run here,
// so this guards the migration text.
const sql = fs.readFileSync(path.resolve(__dirname, "../../../../../../../supabase/migrations/285_education_smart_assignment.sql"), "utf8");
const recv = sql.slice(sql.indexOf("recv AS ("), sql.indexOf("first_contact AS ("));

describe("migration 285: stats refresh counts current members only", () => {
  it("the recv CTE is found", () => expect(recv.length).toBeGreaterThan(50));
  it("keeps only leads whose holder is a member of p_tenant", () => {
    expect(recv).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM tenant_users tu\s+WHERE tu\.tenant_id = p_tenant AND tu\.user_id = l\.assigned_to\s*\)/);
  });
  it("does not filter on suspended status (suspended members stay in)", () => {
    expect(recv).not.toMatch(/tu\.(status|suspended|active)/i);
  });
});
