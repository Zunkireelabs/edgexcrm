import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guards migration 255 against an accidental edit that would widen who can see which leads, or make the
// app's call (visibility-query.ts) stop matching the function. File-content checks only — no DB access.
const sql = readFileSync(join(process.cwd(), "supabase/migrations/255_leads_visible_to_user_with_collaborators.sql"), "utf8");

describe("migration 255 — leads_visible_to_user_with_collaborators", () => {
  it("narrows the EXISTING visibility function — it calls leads_visible_to_user, never re-implements visibility", () => {
    expect(sql).toMatch(/FROM\s+public\.leads_visible_to_user\(\s*p_tenant, p_user, p_scope, p_branch_id, p_user_branch_id, p_cross_pool_slug\s*\)/);
    // The only table it reads itself is lead_collaborators (never `leads`) — so it can't widen the set.
    expect(sql).not.toMatch(/FROM\s+public\.leads\s/);
  });

  it("keeps rows only when a listed collaborator exists, tenant-matched", () => {
    expect(sql).toMatch(/lc\.lead_id\s*=\s*l\.id/);
    expect(sql).toMatch(/lc\.tenant_id\s*=\s*p_tenant/);
    expect(sql).toMatch(/lc\.user_id\s*=\s*ANY \(p_collaborator_ids\)/);
  });

  it("is SECURITY INVOKER (no SECURITY DEFINER) so lead_collaborators RLS applies to the caller", () => {
    expect(sql).not.toMatch(/SECURITY DEFINER/);
  });

  it("is a NEW function name (no overload of leads_visible_to_user) and returns SETOF leads", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.leads_visible_to_user_with_collaborators\(/);
    expect(sql).toMatch(/RETURNS SETOF public\.leads/);
    expect(sql).not.toMatch(/DROP FUNCTION(?! IF EXISTS public\.leads_visible_to_user_with_collaborators)/);
  });

  it("takes exactly the arguments the app sends (p_collaborator_ids uuid[] + the scope args of leads_visible_to_user)", () => {
    for (const arg of ["p_collaborator_ids uuid[]", "p_tenant           uuid", "p_user             uuid", "p_scope            text", "p_branch_id        uuid", "p_user_branch_id   uuid", "p_cross_pool_slug  text"]) {
      expect(sql).toContain(arg);
    }
  });

  it("is executable by the authenticated role only (same as leads_visible_to_user)", () => {
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.leads_visible_to_user_with_collaborators\(uuid\[\],uuid,uuid,text,uuid,uuid,text\) TO authenticated/);
  });

  it("changes no data and no table: no INSERT/UPDATE/DELETE/ALTER besides the ledger row", () => {
    const body = sql.replace(/--.*$/gm, "");
    expect(body).not.toMatch(/\b(UPDATE|DELETE|ALTER|DROP TABLE|TRUNCATE)\b/i);
    expect((body.match(/INSERT INTO/gi) ?? []).length).toBe(1); // schema_migrations only
  });

  it("runs in one transaction and self-records in the migration ledger", () => {
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/^COMMIT;/m);
    expect(sql).toMatch(/INSERT INTO public\.schema_migrations \(version\) VALUES \('255_leads_visible_to_user_with_collaborators\.sql'\)/);
  });
});
