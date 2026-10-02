import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guards migration 254 against an accidental edit that would silently weaken "at most one active
// unsigned consent per lead" — or make it fail on existing data and block the staging deploy.
// File-content checks only — no DB access.
const sql = readFileSync(join(process.cwd(), "supabase/migrations/254_lead_consents_one_active_unsigned.sql"), "utf8");

describe("migration 254 — one active unsigned consent per lead", () => {
  it("is a UNIQUE index on lead_id, partial to active (not deleted) unsigned rows only", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_consents_one_active_unsigned\s+ON public\.lead_consents \(lead_id\)\s+WHERE deleted_at IS NULL AND status <> 'signed'/,
    );
  });

  it("never constrains signed rows (a lead may have several) — the predicate excludes them", () => {
    expect(sql).toMatch(/status <> 'signed'/);
    expect(sql).not.toMatch(/UNIQUE INDEX[^;]*\(lead_id, status\)/);
  });

  it("clears pre-existing duplicates BEFORE building the index, keeping the newest row", () => {
    const cleanup = sql.indexOf("UPDATE public.lead_consents");
    const index = sql.indexOf("CREATE UNIQUE INDEX");
    expect(cleanup).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(cleanup);
    expect(sql).toMatch(/\(n\.created_at, n\.id\) > \(c\.created_at, c\.id\)/);
  });

  it("only ever soft-deletes (never hard-deletes) and only active unsigned rows", () => {
    expect(sql).not.toMatch(/DELETE FROM/i);
    expect(sql).toMatch(/SET\s+deleted_at = now\(\)[\s\S]*?c\.deleted_at IS NULL[\s\S]*?c\.status <> 'signed'/);
  });

  it("runs in one transaction and self-records in the migration ledger", () => {
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/^COMMIT;/m);
    expect(sql).toMatch(/INSERT INTO public\.schema_migrations \(version\) VALUES \('254_lead_consents_one_active_unsigned\.sql'\)/);
  });
});
