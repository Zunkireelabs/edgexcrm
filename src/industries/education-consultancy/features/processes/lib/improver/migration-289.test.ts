import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { CUTS } from "./breakdown";

// Migration 289 is written, not applied by the executor: these checks keep its shape honest (additive, transactional, rollback line, the
// fixed menu of cuts the TypeScript offers, service-role only).
const sql = readFileSync(join(process.cwd(), "supabase/migrations/289_education_process_improver.sql"), "utf8");

describe("migration 289", () => {
  it("is transactional, carries a rollback line and drops/deletes nothing existing", () => {
    expect(sql).toMatch(/^-- Migration 289:/m);
    expect(sql).toMatch(/^-- ROLLBACK:/m);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    const live = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
    expect(live).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(live).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|UPDATE\s+public\.)/i);
  });
  it("adds two nullable badge columns with CHECKs on a fixed list", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS needs\s+TEXT,/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS turns_on TEXT;/);
    expect(sql).toContain("'EDGEX-104', 'EDGEX-105', 'EDGEX-107', 'EDGEX-108'");
    expect(sql).toContain("'smart_assignment_auto'");
  });
  it("offers exactly the cuts the tool offers (the SQL refuses anything else)", () => {
    for (const cut of CUTS.new_lead_first_call) expect(sql).toContain(`'${cut}'`);
    for (const cut of [...CUTS.visa_to_enrolled, ...CUTS.dropping_a_student]) expect(sql).toContain(`'${cut}'`);
    expect(sql).toMatch(/unknown cut/);
  });
  it("is SECURITY DEFINER with a pinned search_path, revoked from PUBLIC and granted to the service role only", () => {
    expect(sql).toMatch(/SECURITY DEFINER SET search_path = public/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.education_process_breakdown\([^)]*\) FROM PUBLIC;/);
    const grants = sql.match(/^GRANT .*$/gm) ?? [];
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatch(/TO service_role;$/);
  });
  it("returns counts only: no lead id, name, phone or message column is selected into the result", () => {
    const body = sql.slice(sql.indexOf("jsonb_build_object"));
    expect(body).not.toMatch(/\b(first_name|last_name|full_name|phone|email|message|body)\b/i);
  });
});
