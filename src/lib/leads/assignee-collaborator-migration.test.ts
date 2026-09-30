import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guards migration 252 against an accidental edit that would silently weaken the guarantee
// ("a lead's assignee is always a collaborator"). File-content checks only — no DB access.
const sql = readFileSync(join(process.cwd(), "supabase/migrations/252_lead_assignee_is_collaborator.sql"), "utf8");

describe("migration 252 — assignee is a collaborator", () => {
  it("fires on INSERT and on UPDATE OF assigned_to, only for a real non-null change", () => {
    expect(sql).toMatch(/AFTER INSERT ON public\.leads[\s\S]*?WHEN \(NEW\.assigned_to IS NOT NULL\)/);
    expect(sql).toMatch(/AFTER UPDATE OF assigned_to ON public\.leads[\s\S]*?IS DISTINCT FROM OLD\.assigned_to/);
  });

  it("is idempotent and can't double-count migration 210's counter (ON CONFLICT DO NOTHING everywhere)", () => {
    const inserts = sql.match(/INSERT INTO public\.lead_collaborators/g) ?? [];
    const conflicts = sql.match(/ON CONFLICT \(lead_id, user_id\) DO NOTHING/g) ?? [];
    expect(inserts.length).toBe(3); // trigger + two backfills
    expect(conflicts.length).toBe(3);
  });

  it("runs as SECURITY DEFINER with a pinned search_path (lead_collaborators INSERT policy is admin-only)", () => {
    expect(sql).toMatch(/SECURITY DEFINER SET search_path = public, pg_temp/);
  });

  it("backfill skips deleted users so a stale audit-trail id can't abort the migration", () => {
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM auth\.users au WHERE au\.id = u\.uid\)/);
  });

  it("self-records in the migration ledger", () => {
    expect(sql).toMatch(/INSERT INTO public\.schema_migrations \(version\) VALUES \('252_lead_assignee_is_collaborator\.sql'\)/);
  });
});
