import { beforeEach, describe, expect, it, vi } from "vitest";

const bulkEnabledMock = vi.fn();
const sendDraftMock = vi.fn();
const updates: Array<{ patch: Record<string, unknown>; id: string }> = [];
let tenantScan: Array<{ tenant_id: string }> = [];
let dueDrafts: Array<Record<string, unknown>> = [];

vi.mock("./flag", () => ({ isBulkEmailEnabledForTenant: (...a: unknown[]) => bulkEnabledMock(...a) }));
vi.mock("@/industries/_shared/features/outreach/lib/send-draft", () => ({ sendDraftViaEdgeX: (...a: unknown[]) => sendDraftMock(...a) }));

// A tiny chainable, thenable query stub: every filter returns the same object and awaiting it yields `rows`.
function chain(rows: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "not", "lte", "is", "order", "limit"]) q[m] = () => q;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return q;
}

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => ({ from: () => chain(tenantScan) }) }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClientForTenant: async () => ({
    from: () => ({
      ...(chain(dueDrafts) as object),
      update: (patch: Record<string, unknown>) => ({
        eq: async (_c: string, id: string) => {
          updates.push({ patch, id });
          return { error: null };
        },
      }),
    }),
  }),
}));

import { runScheduledSequenceSends } from "./sequence-schedule-runner";

const draft = (over: Record<string, unknown> = {}) => ({
  id: "d1", lead_id: "l1", subject: "Hi", body_html: "<p/>", scheduled_by: "u9", ...over,
});

describe("runScheduledSequenceSends", () => {
  beforeEach(() => {
    bulkEnabledMock.mockReset().mockResolvedValue(true);
    sendDraftMock.mockReset();
    updates.length = 0;
    tenantScan = [{ tenant_id: "t1" }, { tenant_id: "t1" }];
    dueDrafts = [draft()];
  });

  it("does nothing when no scheduled draft is due", async () => {
    tenantScan = [];
    expect(await runScheduledSequenceSends()).toEqual({});
    expect(sendDraftMock).not.toHaveBeenCalled();
  });

  it("sends a due draft, credited to whoever scheduled it, once per tenant", async () => {
    sendDraftMock.mockResolvedValue({ status: "sent", emailMessageId: "m1" });
    const out = await runScheduledSequenceSends();
    expect(out.t1).toEqual({ sent: 1, throttled: 0, cleared: 0 });
    expect(sendDraftMock).toHaveBeenCalledTimes(1);
    expect(sendDraftMock.mock.calls[0][3]).toEqual({ sentBy: "u9", scheduled: true });
    expect(updates).toHaveLength(0);
  });

  it("keeps the schedule when the daily cap is reached (retried next pass)", async () => {
    sendDraftMock.mockResolvedValue({ status: "throttled" });
    expect((await runScheduledSequenceSends()).t1).toEqual({ sent: 0, throttled: 1, cleared: 0 });
    expect(updates).toHaveLength(0);
  });

  it("clears the schedule with a reason when the send fails, has no email, or was already finished as failed", async () => {
    sendDraftMock.mockResolvedValueOnce({ status: "failed", suppressed: false, errorCode: "x", errorMessage: "Mailbox unavailable" });
    await runScheduledSequenceSends();
    sendDraftMock.mockResolvedValueOnce({ status: "no_email" });
    await runScheduledSequenceSends();
    sendDraftMock.mockResolvedValueOnce({ status: "already_handled", messageStatus: "failed", errorCode: null, errorMessage: null });
    await runScheduledSequenceSends();

    expect(updates).toHaveLength(3);
    for (const u of updates) expect(u.patch.scheduled_send_at).toBeNull();
    expect(updates[0].patch.scheduled_error).toBe("Mailbox unavailable");
    expect(String(updates[1].patch.scheduled_error)).toMatch(/no email/i);
    expect(String(updates[2].patch.scheduled_error)).toMatch(/not sent again/i);
  });

  it("never sends when sending is switched off at fire time; it clears the schedule with a reason instead", async () => {
    bulkEnabledMock.mockResolvedValue(false);
    const out = await runScheduledSequenceSends();
    expect(sendDraftMock).not.toHaveBeenCalled();
    expect(out.t1.cleared).toBe(1);
    expect(String(updates[0].patch.scheduled_error)).toMatch(/turned off/i);
  });

  it("does not send a draft whose subject was blanked after scheduling", async () => {
    dueDrafts = [draft({ subject: "   " })];
    await runScheduledSequenceSends();
    expect(sendDraftMock).not.toHaveBeenCalled();
    expect(String(updates[0].patch.scheduled_error)).toMatch(/subject/i);
  });
});
