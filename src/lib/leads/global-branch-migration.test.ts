import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guards migration 270 (Admizz "Global" default branch) against an edit that would touch existing
// leads or break the one-default-per-tenant rule. File-content checks only — no DB access.
const raw = readFileSync(join(process.cwd(), "supabase/migrations/270_admizz_global_default_branch.sql"), "utf8");
// Statements only — the header comments legitimately mention leads / lead_branches.
const sql = raw
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("migration 270 — Admizz Global default branch", () => {
  it("touches ONLY the branches table: never leads, lead_branches, tenant_users or lead_collaborators", () => {
    expect(sql).not.toMatch(/\b(UPDATE|INSERT INTO|DELETE FROM)\s+(public\.)?(leads|lead_branches|tenant_users|lead_collaborators)\b/i);
    expect(sql).toMatch(/INSERT INTO branches/);
    expect(sql).toMatch(/UPDATE branches/);
  });

  it("clears the old default BEFORE setting Global (the unique index allows one default per tenant)", () => {
    const clear = sql.indexOf("SET is_default = false");
    const set = sql.indexOf("SET is_default = true");
    expect(clear).toBeGreaterThan(-1);
    expect(set).toBeGreaterThan(clear);
  });

  it("is scoped to the admizz tenant and idempotent", () => {
    expect(sql).toMatch(/slug = 'admizz'/);
    expect(sql).toMatch(/ON CONFLICT \(tenant_id, slug\) DO NOTHING/);
  });

  it("runs in one transaction", () => {
    expect(sql).toMatch(/BEGIN;/);
    expect(sql).toMatch(/COMMIT;/);
  });
});
