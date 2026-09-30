import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guards migration 253 (lead_aggregates stage/pipeline scope). File-content checks only.
const sql = readFileSync(join(process.cwd(), "supabase/migrations/253_lead_aggregates_stage_pipeline_scope.sql"), "utf8");
const OLD_SIG = "uuid,timestamptz,timestamptz,uuid,text,uuid,uuid,text,uuid[],boolean,\n  uuid[],uuid[],text,uuid[],boolean,uuid[],uuid[],text,text,boolean,uuid,timestamptz,uuid,uuid[],uuid[],text,boolean";

describe("migration 253 — lead_aggregates stage/pipeline scope", () => {
  it("DROPs the old signature before CREATE (never an overload — a defaulted-param overload makes calls ambiguous)", () => {
    const dropOld = sql.indexOf(`DROP FUNCTION IF EXISTS public.lead_aggregates(\n  ${OLD_SIG}\n);`);
    const create = sql.indexOf("CREATE FUNCTION public.lead_aggregates(");
    expect(dropOld).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(dropOld);
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.lead_aggregates/);
  });

  it("adds the two params LAST and defaulted, so existing named-argument callers keep working", () => {
    expect(sql).toMatch(/p_include_converted\s+boolean DEFAULT false,\s+p_stage_eq\s+uuid\s+DEFAULT NULL,\s+p_pipeline_eq\s+uuid\s+DEFAULT NULL\s*\)/);
  });

  it("applies them as plain equality predicates, NULL = no restriction (identical results to 229 for old callers)", () => {
    expect(sql).toContain("AND (p_stage_eq IS NULL OR l.stage_id = p_stage_eq)");
    expect(sql).toContain("AND (p_pipeline_eq IS NULL OR l.pipeline_id = p_pipeline_eq)");
  });

  it("re-grants EXECUTE on the NEW 29-arg signature and self-records", () => {
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.lead_aggregates\([\s\S]*?text,boolean,uuid,uuid\n\) TO authenticated;/);
    expect(sql).toContain("VALUES ('253_lead_aggregates_stage_pipeline_scope.sql')");
  });

  it("everything else in the function body is still migration 229's (all dimensions still present)", () => {
    for (const dim of ["'status'", "'stage'", "'source_combo'", "'counselor'", "'collaborator'", "'destination'", "'list'", "'list_status'", "'intake_source'", "'intake_source_part'"]) {
      expect(sql).toContain(dim);
    }
  });
});
