import { describe, it, expect, vi, beforeEach } from "vitest";

// SMS-PHASE3A-FIXES-BRIEF.md F-1 regression coverage: finalizeBlast() must
// never transition a user-cancelled blast out of 'cancelled', and must count
// 'cancelled' rows separately from 'failed' (recipients_failed means "we
// tried and it failed", not "we never got to it").

const scopedClientForTenantMock = vi.fn();

vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: scopedClientForTenantMock }));
vi.mock("@/lib/sms/send", () => ({ sendQueuedBatch: vi.fn() }));
vi.mock("@/lib/sms/settings", () => ({ loadTenantSmsSettings: vi.fn(), resolveTenantTimezone: vi.fn() }));
vi.mock("@/lib/sms/quiet-hours", () => ({ resolveSendWindow: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), getTenantAdminRecipients: vi.fn() }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: vi.fn(() => ({})), send: vi.fn() } }));

interface FakeMessageRow {
  status: string;
}

function fakeDb(initialBlastStatus: string, messageRows: FakeMessageRow[]) {
  const messages = messageRows.map((r) => ({ ...r }));
  const blastUpdateCalls: Record<string, unknown>[] = [];
  const settleCalls: Record<string, unknown>[] = [];
  let messagesCancelCalled = false;

  return {
    db: {
      from(table: string) {
        if (table === "sms_blasts") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: { status: initialBlastStatus }, error: null }) }),
            }),
            update: (patch: Record<string, unknown>) => {
              blastUpdateCalls.push(patch);
              return { eq: () => Promise.resolve({ data: null, error: null }) };
            },
          };
        }
        if (table === "sms_messages") {
          return {
            update: (patch: { status: string }) => ({
              eq: () => ({
                in: (_col: string, statuses: string[]) => {
                  messagesCancelCalled = true;
                  for (const m of messages) if (statuses.includes(m.status)) m.status = patch.status;
                  return Promise.resolve({ data: null, error: null });
                },
              }),
            }),
            select: () => ({ eq: () => Promise.resolve({ data: messages.map((m) => ({ status: m.status })), error: null }) }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
      rpc: (fn: string, args: Record<string, unknown>) => {
        settleCalls.push({ fn, args });
        return Promise.resolve({ data: { ok: true, balance: 100, reserved: 0 }, error: null });
      },
    },
    blastUpdateCalls,
    settleCalls,
    messagesCancelCalledGetter: () => messagesCancelCalled,
  };
}

describe("finalizeBlast — F-1 regression", () => {
  beforeEach(() => {
    scopedClientForTenantMock.mockReset();
  });

  it("a blast already cancelled (by /cancel) stays cancelled — never overwritten to failed/partially_failed", async () => {
    const fake = fakeDb("cancelled", [{ status: "submitted" }, { status: "cancelled" }, { status: "cancelled" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeBlast } = await import("./sms-blast-send");

    const result = await finalizeBlast("tenant-1", "blast-1", 10, 1, null);

    expect(result.finalStatus).toBe("cancelled");
    // recipients_failed must mean "we tried and it failed" — the 2 cancelled
    // rows must NOT inflate it.
    expect(result.failed).toBe(0);
    expect(result.cancelled).toBe(2);
    expect(result.sent).toBe(1);

    const finalUpdate = fake.blastUpdateCalls[fake.blastUpdateCalls.length - 1];
    expect(finalUpdate.status).toBe("cancelled");
    expect(finalUpdate.recipients_failed).toBe(0);

    // Already cancelled — /cancel already did the queued/deferred cleanup;
    // finalizeBlast must not re-run it.
    expect(fake.messagesCancelCalledGetter()).toBe(false);
  });

  it("still settles credits for an already-cancelled blast (idempotent no-op if /cancel already settled)", async () => {
    const fake = fakeDb("cancelled", [{ status: "cancelled" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeBlast } = await import("./sms-blast-send");

    await finalizeBlast("tenant-1", "blast-1", 10, 0, null);

    expect(fake.settleCalls).toHaveLength(1);
    expect(fake.settleCalls[0].args).toMatchObject({ p_ref_id: "blast-1", p_ref_type: "sms_blast" });
  });

  it("insufficient_balance stop with some sent forces partially_failed and does not count cancelled-because-stopped rows as failed", async () => {
    const fake = fakeDb("queued", [{ status: "submitted" }, { status: "queued" }, { status: "queued" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeBlast } = await import("./sms-blast-send");

    const result = await finalizeBlast("tenant-1", "blast-2", 10, 3, "insufficient_balance");

    expect(result.finalStatus).toBe("partially_failed");
    expect(result.failed).toBe(0);
    expect(result.cancelled).toBe(2);
    expect(fake.messagesCancelCalledGetter()).toBe(true);
  });

  it("natural completion with no failures and no stop reason finalizes sent", async () => {
    const fake = fakeDb("queued", [{ status: "submitted" }, { status: "submitted" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeBlast } = await import("./sms-blast-send");

    const result = await finalizeBlast("tenant-1", "blast-3", 2, 2, null);

    expect(result.finalStatus).toBe("sent");
    expect(result.failed).toBe(0);
    expect(result.cancelled).toBe(0);
  });
});
