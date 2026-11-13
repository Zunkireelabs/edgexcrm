import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OFFICE_END_HOUR, OFFICE_START_HOUR } from "./lib/working-hours";

const dir = join(process.cwd(), "supabase/migrations");
const sql = readFileSync(join(dir, "287_education_process_changes.sql"), "utf8");
const m286 = readFileSync(join(dir, "286_education_processes.sql"), "utf8");
const fnOf = (s: string) => s.slice(s.indexOf("CREATE OR REPLACE FUNCTION public.education_process_metrics("), s.indexOf("REVOKE ALL ON FUNCTION public.education_process_metrics"));

describe("migration 287 text guards", () => {
  it("is the only file numbered 287, transactional, with a rollback line and a ledger row", () => {
    expect(readdirSync(dir).filter((f) => f.startsWith("287_"))).toEqual(["287_education_process_changes.sql"]);
    expect(sql).toMatch(/^-- ROLLBACK:/m);
    expect(sql).toMatch(/\nBEGIN;\n/);
    expect(sql).toMatch(/\nCOMMIT;\n$/);
    expect(sql).toContain("INSERT INTO public.schema_migrations (version) VALUES ('287_education_process_changes.sql')");
  });
  it("one open draft per process, enforced by a partial unique index", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uniq_process_versions_one_draft ON public\.process_versions \(process_id\) WHERE status = 'draft'/);
  });
  it("process_changes: tenant + process + version FKs cascade, RLS like 286", () => {
    expect(sql).toMatch(/tenant_id\s+UUID NOT NULL REFERENCES public\.tenants\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/process_id\s+UUID NOT NULL REFERENCES public\.processes\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/version_id\s+UUID NOT NULL REFERENCES public\.process_versions\(id\) ON DELETE CASCADE/);
    expect(sql).toContain("ALTER TABLE public.process_changes ENABLE ROW LEVEL SECURITY");
    expect(sql).toMatch(/CREATE POLICY "process_changes_select" ON public\.process_changes FOR SELECT USING \(tenant_id IN \(SELECT get_user_tenant_ids\(\)\)\)/);
    expect(sql).toMatch(/CREATE POLICY "process_changes_service_all" ON public\.process_changes FOR ALL USING \(auth\.role\(\) = 'service_role'\)/);
  });
  it("process_changes: the value sets match the app", () => {
    expect(sql).toMatch(/field\s+TEXT NOT NULL CHECK \(field IN \('target', 'wording', 'who'\)\)/);
    expect(sql).toMatch(/author_kind\s+TEXT NOT NULL CHECK \(author_kind IN \('person', 'agent'\)\)/);
    expect(sql).toMatch(/status\s+TEXT NOT NULL DEFAULT 'open' CHECK \(status IN \('open', 'taken', 'not_taken'\)\)/);
    expect(sql).toMatch(/taken\s+BOOLEAN NOT NULL DEFAULT TRUE/);
    expect(sql).toMatch(/part IN \('trigger', 'done', 'exceptions'\) OR part LIKE 'step:%'/);
  });
  it("rejection columns are added, nullable", () => {
    for (const c of ["rejected_reason TEXT", "rejected_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL", "rejected_at     TIMESTAMPTZ"]) expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${c}`);
  });
  it("replaces education_process_metrics with the SAME signature and grants", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.education_process_metrics\(\s*p_tenant UUID, p_key TEXT, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tz TEXT\s*\)\s*RETURNS JSONB/);
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.education_process_metrics(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO service_role");
  });
  it("the new function keeps every key the old one returned and adds only within_1wh", () => {
    const keys = (s: string) => new Set([...fnOf(s).matchAll(/^\s+'([a-z0-9_]+)',/gm)].map((m) => m[1]));
    const old = keys(m286);
    const neu = keys(sql);
    for (const k of old) expect(neu.has(k), k).toBe(true);
    expect([...neu].filter((k) => !old.has(k))).toEqual(["within_1wh"]);
  });
  it("the working clock uses the same office hours as the app twin", () => {
    expect(sql).toContain(`v_office_start CONSTANT INT := ${OFFICE_START_HOUR}`);
    expect(sql).toContain(`v_office_end   CONSTANT INT := ${OFFICE_END_HOUR}`);
    expect(sql).toMatch(/'within_1wh', \(SELECT count\(\*\) FROM fc WHERE at IS NOT NULL AND at <= wstart \+ INTERVAL '60 minutes'\)/);
    expect(sql).toMatch(/< v_office_start\s+THEN date_trunc\('day', c\.created_at AT TIME ZONE p_tz\) \+ make_interval\(hours => v_office_start\)/);
    expect(sql).toMatch(/>= v_office_end\s+THEN date_trunc\('day', c\.created_at AT TIME ZONE p_tz\) \+ INTERVAL '1 day' \+ make_interval\(hours => v_office_start\)/);
  });
  it("the function body is otherwise identical to 286 (only the wstart column and within_1wh differ)", () => {
    const strip = (s: string) => fnOf(s).split("\n").filter((l) => !/wstart|within_1wh|^\s*(WHEN EXTRACT|THEN date_trunc|ELSE c\.created_at AT|END\) AT TIME ZONE|-- `wstart`|-- 09:00 \(same day|\(\(CASE)/.test(l)).join("\n");
    expect(strip(sql)).toBe(strip(m286));
  });
});
