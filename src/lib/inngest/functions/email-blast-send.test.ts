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
  const orderCalls: { col: string; opts: unknown }[] = [];

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
          const rangeNode = {
            range: (from: number, to: number) => {
              const statuses = messages.map((m) => ({ status: m.status }));
              return Promise.resolve({ data: statuses.slice(from, to + 1), error: null });
            },
          };
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  // offset pagination needs a deterministic total order —
                  // paginate.ts's ORDERING CONTRACT. Record the call so the
                  // test can assert .order fires before .range.
                  order: (col: string, opts: unknown) => {
                    orderCalls.push({ col, opts });
                    return rangeNode;
                  },
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    },
    blastUpdateCalls,
    orderCalls,
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

  it("counts every row across a real Admizz-scale (3000+) blast, not just the first 1000 (PostgREST page-cap trap)", async () => {
    // The 3,118-row email blast that motivated this branch is already past
    // PostgREST's 1000-row unpaged-select cap — an unpaginated query here
    // would show a wrong live count on the "Throttled" banner mid-send and a
    // wrong final tally once the blast completes.
    const rows: FakeMessageRow[] = [
      ...Array.from({ length: 2000 }, () => ({ status: "sent" })),
      ...Array.from({ length: 1118 }, () => ({ status: "queued" })),
    ];
    const fake = fakeDb("throttled", rows);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { computeBlastCounts } = await import("./email-blast-send");

    const counts = await computeBlastCounts("tenant-1", "blast-large");

    expect(counts.sent).toBe(2000);
  });

  it("orders the paged query by a deterministic key before ranging (offset paging over an unordered result skips/dupes boundary rows)", async () => {
    const fake = fakeDb("throttled", [{ status: "sent" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { computeBlastCounts } = await import("./email-blast-send");

    await computeBlastCounts("tenant-1", "blast-1");

    expect(fake.orderCalls.length).toBeGreaterThan(0);
    expect(fake.orderCalls[0]).toEqual({ col: "id", opts: { ascending: true } });
  });

  // F5 (docs/BLAST-FINDINGS-2026-09-06.md) — total is what lets a caller
  // (finalizeEmailBlast) tell "everyone's accounted for" apart from "some
  // rows are still 'queued'/'sending' and nobody's noticed."
  it("total reflects every row regardless of status, including ones no bucket counts ('queued', 'sending')", async () => {
    const fake = fakeDb("sending", [{ status: "sent" }, { status: "queued" }, { status: "sending" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { computeBlastCounts } = await import("./email-blast-send");

    const counts = await computeBlastCounts("tenant-1", "blast-1");

    expect(counts.total).toBe(3);
    expect(counts.sent + counts.failed + counts.cancelled + counts.suppressed).toBe(1); // only the 'sent' row
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

// F5 (docs/BLAST-FINDINGS-2026-09-06.md) — the real incident: a blast
// finalized 'sent' with 12,100 of 16,000 rows still 'queued'. Regression
// coverage for the safety net: finalize must never report a clean 'sent' (or
// silently drop the shortfall into any other bucket) while rows are still
// unaccounted for.
describe("finalizeEmailBlast — F5 regression (never a false 'sent' while rows are unaccounted for)", () => {
  beforeEach(() => {
    scopedClientForTenantMock.mockReset();
  });

  it("rows still 'queued' at finalize time -> partially_failed, never a false 'sent'", async () => {
    const fake = fakeDb("sending", [{ status: "sent" }, { status: "sent" }, { status: "queued" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./email-blast-send");

    const result = await finalizeEmailBlast("tenant-1", "blast-unaccounted-1");

    expect(result.finalStatus).toBe("partially_failed");
    expect(result.sent).toBe(2); // the two real successes are still reported accurately
  });

  it("a row stranded 'sending' at finalize time -> partially_failed, never a false 'sent' (the exact F5 mechanism)", async () => {
    const fake = fakeDb("sending", Array.from({ length: 9 }, () => ({ status: "sent" })).concat([{ status: "sending" }]));
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./email-blast-send");

    const result = await finalizeEmailBlast("tenant-1", "blast-unaccounted-2");

    expect(result.finalStatus).toBe("partially_failed");
    expect(result.sent).toBe(9);
  });

  it("everyone accounted for (no queued/sending leftover) still finalizes sent normally — the safety net never fires on a genuinely clean run", async () => {
    const fake = fakeDb("sending", [{ status: "sent" }, { status: "sent" }, { status: "suppressed" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./email-blast-send");

    const result = await finalizeEmailBlast("tenant-1", "blast-clean");

    expect(result.finalStatus).toBe("sent");
  });

  it("a cancelled blast with leftover cancelled-but-uncounted rows still finalizes cancelled — the F-1 guarantee takes priority over the unaccounted-for check", async () => {
    // /cancel only flips 'queued' rows to 'cancelled', never a 'sending' one
    // — so a cancel racing a crash can leave a 'sending' row behind even on
    // an intentionally-cancelled blast. That must still resolve to
    // 'cancelled', not 'partially_failed'.
    const fake = fakeDb("cancelled", [{ status: "sent" }, { status: "cancelled" }, { status: "sending" }]);
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    const { finalizeEmailBlast } = await import("./email-blast-send");

    const result = await finalizeEmailBlast("tenant-1", "blast-cancelled-with-leftover");

    expect(result.finalStatus).toBe("cancelled");
  });
});
