import { describe, it, expect, vi, beforeEach } from "vitest";

// OUTREACH-PHASE1-BRIEF.md §8 items 4/5, mirroring SMS-PHASE3A-FIXES-BRIEF.md
// F-1: finalizeEmailBlast() must never transition a user-cancelled blast out
// of 'cancelled', and must count 'cancelled' rows separately from 'failed'
// (recipients_failed means "we tried and it failed", not "we never got to it").

const scopedClientForTenantMock = vi.fn();

vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: scopedClientForTenantMock }));
vi.mock("@/lib/email/outbound/send", () => ({ sendQueuedEmailBatch: vi.fn() }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: vi.fn(() => ({})), send: vi.fn() } }));

interface FakeMessageRow {
  status: string;
}

function fakeDb(initialBlastStatus: string, messageRows: FakeMessageRow[]) {
  const messages = messageRows.map((r) => ({ ...r }));
  const blastUpdateCalls: Record<string, unknown>[] = [];

  return {
    db: {
      from(table: string) {
        if (table === "email_blasts") {
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
        if (table === "email_messages") {
          return {
            select: () => ({
              eq: () => ({ eq: () => Promise.resolve({ data: messages.map((m) => ({ status: m.status })), error: null }) }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    },
    blastUpdateCalls,
  };
}

describe("computeBlastCounts — throttle-branch counter staleness regression", () => {
  beforeEach(() => {
    scopedClientForTenantMock.mockReset();
  });

  it("recomputes sent/failed/suppressed live from email_messages, not from a caller's accumulated total — this is what the throttle branch stamps so recipients_sent never lags the per-row table while a blast sits in 'throttled' (OUTREACH-PHASE1-BRIEF.md §6)", async () => {
    const fake = fakeDb("throttled", [
      { status: "sent" },
      { status: "sent" },
      { status: "delivered" },
      { status: "queued" },
      { status: "queued" },
      { status: "suppressed" },
      { status: "failed" },
    ]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { computeBlastCounts } = await import("./email-blast-send");

    const counts = await computeBlastCounts("tenant-1", "blast-throttled");

    // 'queued' rows (not yet attempted this cycle) must NOT count as sent —
    // the bug this regression guards against is the opposite: reporting 0
    // sent while rows have actually already landed as 'sent'/'delivered'.
    expect(counts.sent).toBe(3);
    expect(counts.failed).toBe(1);
    expect(counts.suppressed).toBe(1);
    expect(counts.cancelled).toBe(0);
  });
});

describe("finalizeEmailBlast — F-1 regression (cancel never overwritten)", () => {
  beforeEach(() => {
    scopedClientForTenantMock.mockReset();
  });

  it("a blast already cancelled (by /cancel) stays cancelled — never overwritten to failed/partially_failed", async () => {
    const fake = fakeDb("cancelled", [{ status: "sent" }, { status: "cancelled" }, { status: "cancelled" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./email-blast-send");

    const result = await finalizeEmailBlast("tenant-1", "blast-1");

    expect(result.finalStatus).toBe("cancelled");
    // recipients_failed must mean "we tried and it failed" — the 2 cancelled
    // rows must NOT inflate it.
    expect(result.failed).toBe(0);
    expect(result.cancelled).toBe(2);
    expect(result.sent).toBe(1);

    const finalUpdate = fake.blastUpdateCalls[fake.blastUpdateCalls.length - 1];
    expect(finalUpdate.status).toBe("cancelled");
    expect(finalUpdate.recipients_failed).toBe(0);
  });

  it("natural completion with no failures finalizes sent", async () => {
    const fake = fakeDb("sending", [{ status: "sent" }, { status: "sent" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./email-blast-send");

    const result = await finalizeEmailBlast("tenant-1", "blast-3");

    expect(result.finalStatus).toBe("sent");
    expect(result.failed).toBe(0);
    expect(result.cancelled).toBe(0);
  });

  it("mixed sent/failed with no cancellation finalizes partially_failed, and bounced counts as failed", async () => {
    const fake = fakeDb("sending", [{ status: "sent" }, { status: "failed" }, { status: "bounced" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./email-blast-send");

    const result = await finalizeEmailBlast("tenant-1", "blast-4");

    expect(result.finalStatus).toBe("partially_failed");
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(2);
  });

  it("all failed with nothing sent finalizes failed", async () => {
    const fake = fakeDb("sending", [{ status: "failed" }, { status: "failed" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./email-blast-send");

    const result = await finalizeEmailBlast("tenant-1", "blast-5");

    expect(result.finalStatus).toBe("failed");
    expect(result.sent).toBe(0);
  });
});
