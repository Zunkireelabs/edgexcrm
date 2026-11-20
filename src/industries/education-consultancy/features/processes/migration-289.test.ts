import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LEARN_DAYS, LEARN_DAY_SHARE, LEARN_MIN_EVENTS, OFFICE_END_HOUR, OFFICE_START_HOUR } from "./lib/working-hours";

const dir = join(process.cwd(), "supabase/migrations");
const sql = readFileSync(join(dir, "289_education_office_hours.sql"), "utf8");
const m287 = readFileSync(join(dir, "288_education_process_changes.sql"), "utf8");
const metricsFn = (s: string) => {
  const a = s.indexOf("CREATE OR REPLACE FUNCTION public.education_process_metrics(");
  const end = "  RETURN v_out;\nEND $$;";
  return s.slice(a, s.indexOf(end, a) + end.length);
};

describe("migration 289 text guards", () => {
  it("is the only file numbered 289, transactional, with a rollback line, a ledger row, and not yet applied", () => {
    expect(readdirSync(dir).filter((f) => f.startsWith("289_"))).toEqual(["289_education_office_hours.sql"]);
    expect(sql.split("\n")[1]).toMatch(/^-- ROLLBACK:/);
    expect(sql).toMatch(/\nBEGIN;\n/);
    expect(sql).toMatch(/\nCOMMIT;\n$/);
    expect(sql).toContain("INSERT INTO public.schema_migrations (version) VALUES ('289_education_office_hours.sql')");
    expect(sql).toContain("Applied: NOT YET");
  });
  it("tenant_office_hours: tenant PK cascades, days/hours are checked, RLS like 287/288 (select by membership, writes service-only)", () => {
    expect(sql).toMatch(/tenant_id\s+UUID PRIMARY KEY REFERENCES public\.tenants\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/days\s+SMALLINT\[\] NOT NULL/);
    expect(sql).toContain("cardinality(days) >= 1 AND days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::SMALLINT[]");
    expect(sql).toContain("start_min >= 0 AND start_min < end_min AND end_min <= 1440");
    expect(sql).toContain("ALTER TABLE public.tenant_office_hours ENABLE ROW LEVEL SECURITY");
    expect(sql).toMatch(/CREATE POLICY "tenant_office_hours_select" ON public\.tenant_office_hours FOR SELECT USING \(tenant_id IN \(SELECT get_user_tenant_ids\(\)\)\)/);
    expect(sql).toMatch(/CREATE POLICY "tenant_office_hours_service_all" ON public\.tenant_office_hours FOR ALL USING \(auth\.role\(\) = 'service_role'\) WITH CHECK \(auth\.role\(\) = 'service_role'\)/);
  });
  it("learning: 90 days, calls + meetings + human notes, NO emails, the same thresholds and default hours as the TS twin", () => {
    const ev = sql.slice(sql.indexOf("education_office_hours_evidence(p_tenant UUID)"), sql.indexOf("CREATE OR REPLACE FUNCTION public.education_office_hours(p_tenant"));
    expect(ev).toContain("a.activity_type IN ('call', 'meeting')");
    expect(ev).not.toMatch(/'email'/);
    expect(ev).toContain("n.ai_tool_call_id IS NULL");
    expect(ev.match(/INTERVAL '90 days'/g)?.length).toBe(2);
    expect(LEARN_DAYS).toBe(90);
    expect(sql).toContain(`IF v_total < ${LEARN_MIN_EVENTS} THEN`);
    expect(sql).toContain(`WHERE t.n::INT >= ${LEARN_DAY_SHARE} * v_max`);
    expect(sql).toContain(`'start_min', ${OFFICE_START_HOUR * 60}, 'end_min', ${OFFICE_END_HOUR * 60}, 'source', 'learned'`);
    expect(sql).toContain(`'days', '[0,1,2,3,4,5,6]'::JSONB, 'start_min', ${OFFICE_START_HOUR * 60}`);
  });
  it("the deadline is the same algorithm as the TS twin: inclusive at closing, a closed day rolls to the next, loop-guarded", () => {
    const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.education_working_deadline_oh("), sql.indexOf("CREATE OR REPLACE FUNCTION public.education_working_deadline(p_tenant"));
    expect(fn).toContain("IF v_working AND v_mins >= v_start AND v_mins < v_end THEN");
    expect(fn).toContain("IF v_rem <= v_avail THEN");
    expect(fn).toContain("ELSIF v_working AND v_mins < v_start THEN");
    expect(fn).toContain("FOR i IN 1..400 LOOP");
  });
  it("education_process_metrics keeps every old key; only office_hours' inner keys are new; within_1wh uses the deadline", () => {
    const keys = (s: string) => new Set([...metricsFn(s).matchAll(/^\s+'([a-z0-9_]+)',/gm)].map((m) => m[1]));
    const old = keys(m287);
    const neu = keys(sql);
    for (const k of old) expect(neu.has(k), k).toBe(true);
    expect([...neu].filter((k) => !old.has(k)).sort()).toEqual(["days", "start_min"]); // the nested office_hours object's own line starts
    expect(metricsFn(sql)).toContain("'within_1wh', (SELECT count(*) FROM fc WHERE at IS NOT NULL AND at <= wdeadline)");
    expect(metricsFn(sql)).toContain("public.education_working_deadline_oh(v_oh, p_tz, c.created_at, 60) AS wdeadline");
    expect(metricsFn(sql)).not.toMatch(/v_office_start|v_office_end|wstart/);
  });
  it("education_process_metrics keeps its signature and grants", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.education_process_metrics\(\s*p_tenant UUID, p_key TEXT, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tz TEXT\s*\)\s*RETURNS JSONB/);
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.education_process_metrics(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO service_role");
  });
  it("education_process_metrics is otherwise the 288 body (only the clock lines differ)", () => {
    const strip = (s: string) =>
      metricsFn(s)
        .split("\n")
        .filter((l) => !/v_office|v_oh|wstart|wdeadline|within_1wh|outside_office_hours|office_hours|education_in_office_hours|'days'|'start_min'|WHEN EXTRACT|THEN date_trunc|ELSE c\.created_at AT|END\) AT TIME ZONE|\(\(CASE|^\s*--|\) AS wdeadline|SELECT count\(\*\) FROM c$|^\s+\),?$|OR EXTRACT/.test(l))
        .join("\n");
    // The regex above removes only clock lines and comments; what remains must match line for line.
    expect(strip(sql)).toBe(strip(m287));
  });
  it("education_home_impact: the 5-arg function is dropped first, the new one has p_working BOOLEAN DEFAULT FALSE and the same grants", () => {
    const drop = sql.indexOf("DROP FUNCTION IF EXISTS public.education_home_impact(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);");
    const create = sql.indexOf("CREATE OR REPLACE FUNCTION public.education_home_impact(");
    expect(drop).toBeGreaterThan(0);
    expect(create).toBeGreaterThan(drop);
    expect(sql).toContain("p_tenant UUID, p_branch UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tz TEXT, p_working BOOLEAN DEFAULT FALSE");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.education_home_impact(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN) TO service_role");
    expect(sql).toContain("ELSE COALESCE(l.assigned_at, l.created_at) + INTERVAL '60 minutes'");
    expect(sql).toContain("a.created_at >= r.at AND a.created_at <= r.dl");
    expect(sql).toContain("n.created_at >= r.at AND n.created_at <= r.dl");
  });
  it("every new function is revoked from PUBLIC and granted to service_role", () => {
    for (const sig of ["education_office_hours_evidence(UUID)", "education_office_hours(UUID)", "education_in_office_hours(JSONB, TEXT, TIMESTAMPTZ)", "education_working_deadline_oh(JSONB, TEXT, TIMESTAMPTZ, INT)", "education_working_deadline(UUID, TIMESTAMPTZ, INT)"]) {
      expect(sql, sig).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC;`);
      expect(sql, sig).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO service_role;`);
    }
  });
});
