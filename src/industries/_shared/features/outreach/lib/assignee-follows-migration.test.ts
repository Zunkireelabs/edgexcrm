import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guards migration 263 (a lead's sequence follows the lead's assignee) against an edit that would rewrite history,
// touch other leads, or lose the SECURITY DEFINER the sequence tables' RLS needs. File-content checks only — no DB access.
const sql = readFileSync(join(process.cwd(), "supabase/migrations/263_sequence_follows_lead_assignee.sql"), "utf8");
const code = sql.replace(/^\s*--.*$/gm, ""); // ignore comments

describe("migration 263 — leads_assignee_follows_sequences", () => {
  it("fires only when assigned_to actually changes (NULL included), per row, after the update", () => {
    expect(code).toMatch(/AFTER UPDATE OF assigned_to ON public\.leads/);
    expect(code).toMatch(/FOR EACH ROW/);
    expect(code).toMatch(/WHEN \(NEW\.assigned_to IS DISTINCT FROM OLD\.assigned_to\)/);
  });

  it("copies the new assignee onto RUNNING enrollments only (active / paused) — never finished ones", () => {
    expect(code).toMatch(/UPDATE public\.sequence_enrollments\s+SET assigned_to = NEW\.assigned_to\s+WHERE lead_id = NEW\.id\s+AND status IN \('active', 'paused'\)/);
  });

  it("copies it onto PENDING drafts only — sent / skipped drafts keep who they were assigned to", () => {
    expect(code).toMatch(/UPDATE public\.sequence_step_drafts\s+SET assigned_to = NEW\.assigned_to\s+WHERE lead_id = NEW\.id\s+AND status = 'pending'/);
  });

  it("only ever touches THIS lead's rows (every UPDATE is keyed on the lead id)", () => {
    const updates = code.match(/UPDATE public\.\w+/g) ?? [];
    expect(updates).toHaveLength(2);
    expect((code.match(/lead_id = NEW\.id/g) ?? []).length).toBe(2);
  });

  it("is SECURITY DEFINER with a pinned search_path, so the sequence follows whoever reassigns the lead", () => {
    expect(code).toMatch(/LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp/);
  });

  it("does not reset notified_at (a bulk reassignment must not fire thousands of due bells)", () => {
    expect(code).not.toMatch(/notified_at/);
  });

  it("is idempotent (CREATE OR REPLACE / DROP TRIGGER IF EXISTS) and self-records in the ledger", () => {
    expect(code).toMatch(/CREATE OR REPLACE FUNCTION public\.leads_assignee_follows_sequences\(\)/);
    expect(code).toMatch(/DROP TRIGGER IF EXISTS trg_leads_assignee_follows_sequences ON public\.leads/);
    expect(code).toMatch(/INSERT INTO public\.schema_migrations \(version\) VALUES \('263_sequence_follows_lead_assignee\.sql'\)\s+ON CONFLICT \(version\) DO NOTHING/);
  });
});
