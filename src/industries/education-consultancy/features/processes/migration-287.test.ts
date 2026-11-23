import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROCESS_KEYS } from "./lib/keys";
import { FEATURES, INDUSTRIES } from "../../../_registry";
import { getFeatureAccess } from "../../../_loader";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/287_education_processes.sql"), "utf8");

// Migration text guards: the DB is the last line of defence, so the invariants must be IN the migration, not only in app code.
describe("migration 287 text guards", () => {
  it("a live or retired version's spec is immutable, enforced by a BEFORE UPDATE trigger", () => {
    expect(sql).toMatch(/OLD\.status IN \('live', 'retired'\) AND NEW\.spec IS DISTINCT FROM OLD\.spec/);
    expect(sql).toMatch(/RAISE EXCEPTION/);
    expect(sql).toMatch(/CREATE TRIGGER trg_process_versions_guard_spec\s+BEFORE UPDATE ON public\.process_versions/);
  });
  it("at most one live version per process (partial unique index)", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uniq_process_versions_one_live ON public\.process_versions \(process_id\) WHERE status = 'live'/);
  });
  it("unique keys: (tenant, key), (process, version), snapshot PK (process, day)", () => {
    expect(sql).toMatch(/UNIQUE \(tenant_id, key\)/);
    expect(sql).toMatch(/UNIQUE \(process_id, version\)/);
    expect(sql).toMatch(/PRIMARY KEY \(process_id, day\)/);
  });
  it("RLS on all three tables: tenant SELECT via get_user_tenant_ids, writes service-role only", () => {
    for (const t of ["processes", "process_versions", "process_metric_snapshots"]) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toMatch(new RegExp(`CREATE POLICY "${t}_select" ON public\\.${t} FOR SELECT USING \\(tenant_id IN \\(SELECT get_user_tenant_ids\\(\\)\\)\\)`));
      expect(sql).toMatch(new RegExp(`CREATE POLICY "${t}_service_all" ON public\\.${t} FOR ALL USING \\(auth\\.role\\(\\) = 'service_role'\\)`));
    }
  });
  it("status and source are constrained; keys match the four processes", () => {
    expect(sql).toContain("CHECK (status IN ('draft', 'live', 'retired', 'rejected'))");
    expect(sql).toContain("CHECK (source IN ('system', 'person', 'agent'))");
    for (const k of PROCESS_KEYS) expect(sql).toContain(`'${k}'`);
  });
  it("the metrics function handles every key, is service-role only, and starts with a rollback line", () => {
    for (const k of PROCESS_KEYS) expect(sql).toContain(`p_key = '${k}'`);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.education_process_metrics\(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT\) FROM PUBLIC/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.education_process_metrics\(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT\) TO service_role/);
    expect(sql.split("\n")[1]).toMatch(/^-- ROLLBACK:/);
  });
  it("reuses Home's definitions: human notes + activities as contact, walk-in tags, call-back SQL from migration 285", () => {
    expect(sql).toContain("n.ai_tool_call_id IS NULL");
    expect(sql).toContain("ARRAY['other', 'parent']");
    expect(sql).toContain("callback_reminder_minutes");
    expect(sql).toContain("g.changes ? 'assigned_to'");
  });
  it("is transactional and records itself in schema_migrations", () => {
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    expect(sql).toContain("287_education_processes.sql");
  });
});

describe("feature gate (the same function the sidebar, page and API use)", () => {
  it("education_consultancy has Processes", () => {
    expect(getFeatureAccess(INDUSTRIES.EDUCATION_CONSULTANCY, FEATURES.PROCESSES)).toBe(true);
  });
  it.each(["it_agency", "travel_agency", "construction", "general", "real_estate", null, undefined])("%s does not", (industry) => {
    expect(getFeatureAccess(industry as string | null | undefined, FEATURES.PROCESSES)).toBe(false);
  });
});
