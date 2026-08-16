import { describe, it, expect, vi, beforeEach } from "vitest";

// docs/SMS-PHASE4-BRIEF.md item 5 — the F-5 residual (SMS-PHASE3A-FIX-F5-
// BRIEF.md): a blast cancelled while `sending` whose Inngest run then dies
// before `finalize` never settles its reservation. Also asserts the brief's
// two reconciliation rules: sum(provider_credit) over submitted/delivered
// equals the settle call's p_actual, and every sms_credits_settle call
// passes p_ref_type explicitly (never the RPC default).

const createServiceClientMock = vi.fn();
const scopedClientForTenantMock = vi.fn();
const isSmsEnabledMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: createServiceClientMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: scopedClientForTenantMock }));
vi.mock("@/lib/sms/flag", () => ({ isSmsEnabled: isSmsEnabledMock }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: vi.fn((_cfg, handler) => handler) } }));

interface FakeBlast {
  id: string;
  tenant_id: string;
  reserved_credits: number | null;
  status: string;
}

interface FakeMessage {
  blast_id: string;
  status: string;
  provider_credit: number | null;
}

function fakeService(blasts: FakeBlast[], settledRefIds: string[]) {
  return {
    from(table: string) {
      if (table === "sms_blasts") {
        return {
          select: () => ({
            in: () => ({
              not: () => ({
                gt: () => Promise.resolve({ data: blasts, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "sms_credit_ledger") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: () => Promise.resolve({ data: settledRefIds.map((ref_id) => ({ ref_id })), error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function fakeScoped(messages: FakeMessage[]) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    from(table: string) {
      if (table === "sms_messages") {
        return {
          select: () => ({
            eq: (col: string, val: string) => ({
              in: () =>
                Promise.resolve({
                  data: messages.filter((m) => (col === "blast_id" ? m.blast_id === val : true)).map((m) => ({ provider_credit: m.provider_credit })),
                  error: null,
                }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: { ok: true, diff: (args.p_reserved as number) - (args.p_actual as number) }, error: null });
    },
  };
  return { db, rpcCalls };
}

describe("smsCreditReaper", () => {
  beforeEach(() => {
    createServiceClientMock.mockReset();
    scopedClientForTenantMock.mockReset();
    isSmsEnabledMock.mockReset().mockReturnValue(true);
  });

  it("skips before any step.run when SMS is disabled", async () => {
    isSmsEnabledMock.mockReturnValue(false);
    const { smsCreditReaper } = await import("./sms-credit-reaper");
    const stepRun = vi.fn();

    const result = await (smsCreditReaper as unknown as (ctx: unknown) => Promise<unknown>)({ step: { run: stepRun } });

    expect(result).toEqual({ skipped: true, reason: "sms disabled" });
    expect(stepRun).not.toHaveBeenCalled();
    expect(createServiceClientMock).not.toHaveBeenCalled();
  });

  it("settles a cancelled blast with no settle ledger row, passing p_ref_type explicitly and matching sum(provider_credit)", async () => {
    const blast: FakeBlast = { id: "blast-1", tenant_id: "tenant-1", reserved_credits: 10, status: "cancelled" };
    createServiceClientMock.mockResolvedValue(fakeService([blast], []));

    const messages: FakeMessage[] = [
      { blast_id: "blast-1", status: "submitted", provider_credit: 2 },
      { blast_id: "blast-1", status: "delivered", provider_credit: 3 },
      { blast_id: "blast-1", status: "cancelled", provider_credit: null }, // must NOT count toward actual
    ];
    const scoped = fakeScoped(messages);
    scopedClientForTenantMock.mockResolvedValue(scoped.db);

    const { findUnsettledTerminalBlasts, reapBlast } = await import("./sms-credit-reaper");
    const candidates = await findUnsettledTerminalBlasts();
    expect(candidates).toEqual([blast]);
    const outcome = await reapBlast(candidates[0]);

    expect(outcome).toMatchObject({ blastId: "blast-1", actual: 5 });

    expect(scoped.rpcCalls).toHaveLength(1);
    expect(scoped.rpcCalls[0].fn).toBe("sms_credits_settle");
    // Reconciliation rule 1: sum(provider_credit) over submitted/delivered == p_actual.
    expect(scoped.rpcCalls[0].args.p_actual).toBe(5);
    // Reconciliation rule 2: p_ref_type passed explicitly, never the default.
    expect(scoped.rpcCalls[0].args.p_ref_type).toBe("sms_blast");
    expect(scoped.rpcCalls[0].args.p_reserved).toBe(10);
    expect(scoped.rpcCalls[0].args.p_ref_id).toBe("blast-1");
  });

  it("is idempotent — a blast that already has a settle ledger row is excluded from the candidate list", async () => {
    const blast: FakeBlast = { id: "blast-2", tenant_id: "tenant-1", reserved_credits: 10, status: "cancelled" };
    createServiceClientMock.mockResolvedValue(fakeService([blast], ["blast-2"]));

    const { findUnsettledTerminalBlasts } = await import("./sms-credit-reaper");
    const candidates = await findUnsettledTerminalBlasts();

    expect(candidates).toEqual([]);
  });

  it("returns no candidates when there are no terminal blasts with an outstanding reservation", async () => {
    createServiceClientMock.mockResolvedValue(fakeService([], []));

    const { findUnsettledTerminalBlasts } = await import("./sms-credit-reaper");
    const candidates = await findUnsettledTerminalBlasts();

    expect(candidates).toEqual([]);
  });
});
