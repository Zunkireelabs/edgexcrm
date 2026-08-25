import { describe, it, expect, vi, beforeEach } from "vitest";

// OUTREACH-PHASE2-BRIEF.md §5.6 — the load-bearing regression for this whole
// phase: it_agency's manual-copy sequences (email_sequences.auto_send
// defaults to false) must take ZERO new code path through this worker.
// processTenantAutoSendDrafts scopes every query to auto_send=true, so a
// tenant with no auto-send sequences must short-circuit before ever touching
// sequence_step_drafts or sendQueuedEmailBatch.

const scopedClientForTenantMock = vi.fn();
const sendQueuedEmailBatchMock = vi.fn();
const markDraftSentViaEdgeXMock = vi.fn();

vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: (...args: unknown[]) => scopedClientForTenantMock(...args) }));
vi.mock("@/lib/email/outbound/send", () => ({ sendQueuedEmailBatch: (...args: unknown[]) => sendQueuedEmailBatchMock(...args) }));
vi.mock("@/industries/_shared/features/outreach/lib/engine", () => ({
  markDraftSentViaEdgeX: (...args: unknown[]) => markDraftSentViaEdgeXMock(...args),
}));
vi.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: vi.fn(() => ({})) } }));

function fakeDbNoAutoSendSequences() {
  return {
    from(table: string) {
      if (table === "email_sequences") {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
      }
      throw new Error(`unexpected table for a tenant with no auto-send sequences: ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("processTenantAutoSendDrafts — it_agency (auto_send=false) regression", () => {
  beforeEach(() => {
    scopedClientForTenantMock.mockReset();
    sendQueuedEmailBatchMock.mockReset();
    markDraftSentViaEdgeXMock.mockReset();
  });

  it("short-circuits before ever querying enrollments/drafts or sending when a tenant has no auto_send sequences", async () => {
    scopedClientForTenantMock.mockResolvedValue(fakeDbNoAutoSendSequences());
    const { processTenantAutoSendDrafts } = await import("./sequence-step-send");

    const result = await processTenantAutoSendDrafts("it-agency-tenant");

    expect(result).toEqual({ sent: 0, throttled: 0, failed: 0, skipped: 0 });
    expect(sendQueuedEmailBatchMock).not.toHaveBeenCalled();
    expect(markDraftSentViaEdgeXMock).not.toHaveBeenCalled();
  });
});

describe("processTenantAutoSendDrafts — auto-send happy path", () => {
  beforeEach(() => {
    scopedClientForTenantMock.mockReset();
    sendQueuedEmailBatchMock.mockReset();
    markDraftSentViaEdgeXMock.mockReset();
  });

  function fakeDbWithDueDraft() {
    const upsertedRows: Record<string, unknown>[] = [];
    return {
      db: {
        from(table: string) {
          if (table === "email_sequences") {
            return { select: () => ({ eq: () => Promise.resolve({ data: [{ id: "seq-1" }], error: null }) }) };
          }
          if (table === "sequence_enrollments") {
            return {
              select: () => ({ in: () => ({ eq: () => Promise.resolve({ data: [{ id: "enr-1" }], error: null }) }) }),
            };
          }
          if (table === "sequence_step_drafts") {
            return {
              select: () => ({
                eq: () => ({
                  lte: () => ({
                    in: () => ({
                      order: () => ({
                        limit: () =>
                          Promise.resolve({
                            data: [{ id: "draft-1", lead_id: "lead-1", subject: "Hi", body_html: "<p>Hi</p>" }],
                            error: null,
                          }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "leads") {
            return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { email: "lead@example.com" }, error: null }) }) }) };
          }
          if (table === "email_messages") {
            return {
              upsert: (row: Record<string, unknown>) => {
                upsertedRows.push(row);
                return Promise.resolve({ data: null, error: null });
              },
              select: () => ({
                eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "message-1", status: "queued" }, error: null }) }) }),
              }),
            };
          }
          throw new Error(`unexpected table: ${table}`);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      upsertedRows,
    };
  }

  it("materializes an email_messages row, sends it, and marks the draft sent via EdgeX on success", async () => {
    const fake = fakeDbWithDueDraft();
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    sendQueuedEmailBatchMock.mockResolvedValue({ sent: 1, failed: 0, suppressed: 0, throttled: 0 });
    const { processTenantAutoSendDrafts } = await import("./sequence-step-send");

    const result = await processTenantAutoSendDrafts("edu-tenant");

    expect(result).toEqual({ sent: 1, throttled: 0, failed: 0, skipped: 0 });
    expect(fake.upsertedRows[0]).toMatchObject({ source: "sequence", source_id: "draft-1", to_email: "lead@example.com" });
    // Drip caller passes NO capCaller option — it always sees the full remaining (§3.1/§5.3).
    expect(sendQueuedEmailBatchMock).toHaveBeenCalledWith("edu-tenant", ["message-1"]);
    expect(markDraftSentViaEdgeXMock).toHaveBeenCalledWith(fake.db, "edu-tenant", "draft-1", "message-1");
  });

  it("leaves the draft untouched (never marks sent) when the batch reports throttled", async () => {
    const fake = fakeDbWithDueDraft();
    scopedClientForTenantMock.mockResolvedValue(fake.db);
    sendQueuedEmailBatchMock.mockResolvedValue({ sent: 0, failed: 0, suppressed: 0, throttled: 1 });
    const { processTenantAutoSendDrafts } = await import("./sequence-step-send");

    const result = await processTenantAutoSendDrafts("edu-tenant");

    expect(result).toEqual({ sent: 0, throttled: 1, failed: 0, skipped: 0 });
    expect(markDraftSentViaEdgeXMock).not.toHaveBeenCalled();
  });
});
