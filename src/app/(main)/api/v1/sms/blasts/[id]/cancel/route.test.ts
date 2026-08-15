import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// SMS-PHASE3A-FIX-F5-BRIEF.md — /cancel must only settle immediately when
// nothing can be in flight (scheduled/queued). A 'sending' blast has a
// send-batch-N Inngest step that may submit more messages to the provider
// after our snapshot, so settling here would undercharge the ledger; that
// case is left to finalizeBlast, which settles with the true total once the
// batch loop notices the cancelled rows (F-1 guarantees no transition out of
// 'cancelled').

const requireSmsAccessMock = vi.fn();

vi.mock("@/lib/sms/api-guard", () => ({ requireSmsAccess: requireSmsAccessMock }));

const AUTH = { userId: "user-1", tenantId: "tenant-1", role: "owner" } as unknown as AuthContext;
const params = Promise.resolve({ id: "blast-1" });

function fakeReq(): NextRequest {
  return {} as unknown as NextRequest;
}

function fakeDb(opts: { blastStatus: string; reservedCredits?: number; chargedRows?: { provider_credit: number | null }[] }) {
  const blastRow: Record<string, unknown> = {
    id: "blast-1",
    status: opts.blastStatus,
    reserved_credits: opts.reservedCredits ?? 200,
  };
  const messagesUpdateCalls: { patch: Record<string, unknown>; statuses: string[] }[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const chargedRows = opts.chargedRows ?? [];

  const db = {
    from(table: string) {
      if (table === "sms_blasts") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { ...blastRow }, error: null }) }) }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              select: () => ({
                single: () => {
                  Object.assign(blastRow, patch);
                  return Promise.resolve({ data: { ...blastRow }, error: null });
                },
              }),
            }),
          }),
        };
      }
      if (table === "sms_messages") {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              in: (_col: string, statuses: string[]) => {
                messagesUpdateCalls.push({ patch, statuses });
                return Promise.resolve({ error: null });
              },
            }),
          }),
          select: (_cols: string) => ({
            eq: () => ({
              in: () => Promise.resolve({ data: chargedRows, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: { ok: true }, error: null });
    },
  };

  return { db, blastRow, messagesUpdateCalls, rpcCalls };
}

describe("POST /api/v1/sms/blasts/[id]/cancel", () => {
  beforeEach(() => {
    requireSmsAccessMock.mockReset();
  });

  it("cancelling a queued blast settles once, with the computed actual and p_ref_type sms_blast", async () => {
    const fake = fakeDb({
      blastStatus: "queued",
      reservedCredits: 50,
      chargedRows: [{ provider_credit: 3 }, { provider_credit: 2 }],
    });
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    const { POST } = await import("./route");

    const res = await POST(fakeReq(), { params });
    expect(res.status).toBe(200);

    expect(fake.rpcCalls).toHaveLength(1);
    expect(fake.rpcCalls[0].fn).toBe("sms_credits_settle");
    expect(fake.rpcCalls[0].args).toMatchObject({
      p_ref_id: "blast-1",
      p_reserved: 50,
      p_actual: 5,
      p_ref_type: "sms_blast",
    });
    expect(fake.blastRow.status).toBe("cancelled");
    expect(fake.blastRow.actual_credits).toBe(5);
  });

  it("cancelling a sending blast cancels rows and marks the blast cancelled but does NOT settle", async () => {
    const fake = fakeDb({
      blastStatus: "sending",
      reservedCredits: 200,
      chargedRows: [{ provider_credit: 100 }],
    });
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    const { POST } = await import("./route");

    const res = await POST(fakeReq(), { params });
    expect(res.status).toBe(200);

    // pending rows still cancelled
    expect(fake.messagesUpdateCalls).toHaveLength(1);
    expect(fake.messagesUpdateCalls[0].patch).toEqual({ status: "cancelled" });
    expect(fake.messagesUpdateCalls[0].statuses).toEqual(["queued", "deferred"]);

    // blast marked cancelled, but no settle call
    expect(fake.blastRow.status).toBe("cancelled");
    expect(fake.rpcCalls).toHaveLength(0);
    expect(fake.blastRow.actual_credits).toBeUndefined();
  });

  it("finalizeBlast on an already-cancelled blast still settles with its own total and returns finalStatus cancelled (F-1 regression)", async () => {
    vi.resetModules();
    const scopedClientForTenantMock = vi.fn();
    vi.doMock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: scopedClientForTenantMock }));
    vi.doMock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

    const statusRows = [
      { status: "submitted" },
      { status: "submitted" },
      { status: "cancelled" },
    ];
    const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
    const blastUpdateCalls: Record<string, unknown>[] = [];

    const db = {
      from(table: string) {
        if (table === "sms_blasts") {
          return {
            select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { status: "cancelled" }, error: null }) }) }),
            update: (patch: Record<string, unknown>) => {
              blastUpdateCalls.push(patch);
              return { eq: () => Promise.resolve({ error: null }) };
            },
          };
        }
        if (table === "sms_messages") {
          return {
            select: () => ({ eq: () => Promise.resolve({ data: statusRows, error: null }) }),
            update: () => ({ eq: () => ({ in: () => Promise.resolve({ error: null }) }) }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
      rpc: (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve({ error: null });
      },
      raw: () => db,
    };
    scopedClientForTenantMock.mockResolvedValue(db);

    const { finalizeBlast } = await import("@/lib/inngest/functions/sms-blast-send");
    const outcome = await finalizeBlast("tenant-1", "blast-1", 50, 5, null);

    expect(outcome.finalStatus).toBe("cancelled");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("sms_credits_settle");
    expect(rpcCalls[0].args).toMatchObject({ p_ref_id: "blast-1", p_reserved: 50, p_actual: 5, p_ref_type: "sms_blast" });
    expect(blastUpdateCalls[0]).toMatchObject({ status: "cancelled" });

    vi.doUnmock("@/lib/supabase/scoped");
    vi.doUnmock("@/lib/logger");
  });
});
