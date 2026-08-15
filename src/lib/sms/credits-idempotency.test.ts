import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

// Regression test for REVIEW HIGH-1 / HIGH-2 (docs/SMS-PHASE1-REVIEW.md): a
// retried sms_credits_reserve/sms_credits_settle call with the same ref_id
// must be a safe no-op, not a silent double-debit (HIGH-1) or a thrown CHECK
// violation on a diff=0 settle (HIGH-2). Unit-mocking supabase-js can't catch
// either bug — both live entirely in the SQL RPCs (migration 202) — so this
// hits the real local Postgres function.
//
// Runs only against the local dev Supabase stack (127.0.0.1), never CI/stage/
// prod: CI's Test job has no database at all, and stage/prod don't have these
// RPCs applied yet (HELD per the migration's own header). Skips cleanly, not
// a failure, when the local stack isn't up.

const API_URL = "http://127.0.0.1:54321";
// Static, well-known LOCAL Supabase demo service-role key (safe to commit — local only).
// Same key scripts/local-db-setup.sh uses.
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

let localDbAvailable = false;
let tenantId: string;

const db = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

beforeAll(async () => {
  try {
    const { data, error } = await db.from("tenants").select("id").limit(1).single();
    if (error || !data) return;
    tenantId = data.id;
    localDbAvailable = true;
  } catch {
    // Local Supabase stack not running — tests below skip via localDbAvailable.
  }
}, 5000);

describe("sms_credits_reserve / sms_credits_settle idempotency", () => {
  it("a repeated reserve with the same ref_id debits the account exactly once", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }

    const refId = crypto.randomUUID();
    await db.from("sms_credit_accounts").upsert({ tenant_id: tenantId, balance: 100, reserved: 0 });

    const first = await db.rpc("sms_credits_reserve", {
      p_tenant_id: tenantId,
      p_amount: 10,
      p_ref_type: "sms_blast",
      p_ref_id: refId,
    });
    const retry = await db.rpc("sms_credits_reserve", {
      p_tenant_id: tenantId,
      p_amount: 10,
      p_ref_type: "sms_blast",
      p_ref_id: refId,
    });

    expect(first.error).toBeNull();
    expect(retry.error).toBeNull();
    expect(first.data).toMatchObject({ ok: true, balance: 90, reserved: 10 });
    // The retry must return the SAME state as the first call, not debit again.
    expect(retry.data).toMatchObject({ ok: true, balance: 90, reserved: 10, replayed: true });

    const { data: account } = await db
      .from("sms_credit_accounts")
      .select("balance, reserved")
      .eq("tenant_id", tenantId)
      .single();
    expect(account).toMatchObject({ balance: 90, reserved: 10 });

    const { data: ledgerRows } = await db
      .from("sms_credit_ledger")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("ref_id", refId)
      .eq("reason", "reserve");
    expect(ledgerRows).toHaveLength(1);
  });

  it("a repeated settle with diff=0 is a safe no-op, not a thrown CHECK violation", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }

    const refId = crypto.randomUUID();
    await db.from("sms_credit_accounts").upsert({ tenant_id: tenantId, balance: 100, reserved: 0 });
    await db.rpc("sms_credits_reserve", { p_tenant_id: tenantId, p_amount: 10, p_ref_type: "sms_blast", p_ref_id: refId });

    const first = await db.rpc("sms_credits_settle", { p_tenant_id: tenantId, p_ref_id: refId, p_reserved: 10, p_actual: 10 });
    const retry = await db.rpc("sms_credits_settle", { p_tenant_id: tenantId, p_ref_id: refId, p_reserved: 10, p_actual: 10 });

    // Before the fix, the retry threw a CHECK (reserved >= 0) violation
    // instead of returning cleanly.
    expect(first.error).toBeNull();
    expect(retry.error).toBeNull();
    expect(first.data).toMatchObject({ ok: true, diff: 0, balance: 90, reserved: 0 });
    expect(retry.data).toMatchObject({ ok: true, diff: 0, balance: 90, reserved: 0, replayed: true });

    const { data: account } = await db
      .from("sms_credit_accounts")
      .select("balance, reserved")
      .eq("tenant_id", tenantId)
      .single();
    expect(account).toMatchObject({ balance: 90, reserved: 0 });

    const { data: ledgerRows } = await db
      .from("sms_credit_ledger")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("ref_id", refId)
      .eq("reason", "settle");
    expect(ledgerRows).toHaveLength(1);
  });
});
