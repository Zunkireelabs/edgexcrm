import { beforeEach, describe, expect, it, vi } from "vitest";

const sendQueuedEmailBatchMock = vi.fn();
const markDraftSentViaEdgeXMock = vi.fn();

vi.mock("@/lib/email/outbound/send", () => ({ sendQueuedEmailBatch: (...a: unknown[]) => sendQueuedEmailBatchMock(...a) }));
vi.mock("./engine", () => ({ markDraftSentViaEdgeX: (...a: unknown[]) => markDraftSentViaEdgeXMock(...a) }));

import { sendDraftViaEdgeX } from "./send-draft";

const draft = { id: "d1", lead_id: "l1", subject: "Hi", body_html: "<p>x</p>" };

interface FakeOpts {
  email?: string | null;
  upsertError?: boolean;
  // Successive reads of the email_messages row (before send, then after a failed send).
  messages?: Array<{ id: string; status: string; error_code?: string | null; error_message?: string | null } | null>;
}

function fakeDb(opts: FakeOpts = {}) {
  const upserts: unknown[] = [];
  const messages = [...(opts.messages ?? [{ id: "m1", status: "queued" }])];
  const db = {
    from(table: string) {
      if (table === "leads") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { email: opts.email === undefined ? "a@b.com" : opts.email } }) }) }) };
      }
      return {
        upsert: async (row: unknown) => {
          upserts.push(row);
          return { error: opts.upsertError ? { message: "boom" } : null };
        },
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: messages.length > 1 ? messages.shift() : messages[0] }) }) }) }),
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { db, upserts };
}

describe("sendDraftViaEdgeX", () => {
  beforeEach(() => {
    sendQueuedEmailBatchMock.mockReset();
    markDraftSentViaEdgeXMock.mockReset();
  });

  it("sends and marks the draft sent on success", async () => {
    sendQueuedEmailBatchMock.mockResolvedValue({ sent: 1, failed: 0, suppressed: 0, throttled: 0 });
    const { db, upserts } = fakeDb();
    const r = await sendDraftViaEdgeX(db, "t1", draft);
    expect(r).toEqual({ status: "sent", emailMessageId: "m1" });
    expect(upserts).toHaveLength(1);
    expect(sendQueuedEmailBatchMock).toHaveBeenCalledWith("t1", ["m1"]);
    expect(markDraftSentViaEdgeXMock).toHaveBeenCalledWith(db, "t1", "d1", "m1");
  });

  it("credits the person who clicked Send now; the cron path passes no sender", async () => {
    sendQueuedEmailBatchMock.mockResolvedValue({ sent: 1, failed: 0, suppressed: 0, throttled: 0 });
    const { db } = fakeDb();
    await sendDraftViaEdgeX(db, "t1", draft, { sentBy: "user-9" });
    expect(markDraftSentViaEdgeXMock).toHaveBeenCalledWith(db, "t1", "d1", "m1", { sentBy: "user-9" });
  });

  it("does nothing when the lead has no email", async () => {
    const { db } = fakeDb({ email: null });
    expect(await sendDraftViaEdgeX(db, "t1", draft)).toEqual({ status: "no_email" });
    expect(sendQueuedEmailBatchMock).not.toHaveBeenCalled();
  });

  it("leaves the draft pending when the daily cap is hit", async () => {
    sendQueuedEmailBatchMock.mockResolvedValue({ sent: 0, failed: 0, suppressed: 0, throttled: 1 });
    const { db } = fakeDb();
    expect(await sendDraftViaEdgeX(db, "t1", draft)).toEqual({ status: "throttled" });
    expect(markDraftSentViaEdgeXMock).not.toHaveBeenCalled();
  });

  it("returns the stored reason on a failed send and does not mark the draft sent", async () => {
    sendQueuedEmailBatchMock.mockResolvedValue({ sent: 0, failed: 1, suppressed: 0, throttled: 0 });
    const { db } = fakeDb({
      messages: [
        { id: "m1", status: "queued" },
        { id: "m1", status: "failed", error_code: "provider_error", error_message: "Mailbox unavailable" },
      ],
    });
    expect(await sendDraftViaEdgeX(db, "t1", draft)).toEqual({
      status: "failed",
      suppressed: false,
      errorCode: "provider_error",
      errorMessage: "Mailbox unavailable",
    });
    expect(markDraftSentViaEdgeXMock).not.toHaveBeenCalled();
  });

  it("flags a suppressed recipient", async () => {
    sendQueuedEmailBatchMock.mockResolvedValue({ sent: 0, failed: 0, suppressed: 1, throttled: 0 });
    const { db } = fakeDb();
    const r = await sendDraftViaEdgeX(db, "t1", draft);
    expect(r.status).toBe("failed");
    expect(r.status === "failed" && r.suppressed).toBe(true);
  });

  it("never re-sends a message a previous attempt already finished as failed", async () => {
    const { db } = fakeDb({ messages: [{ id: "m1", status: "failed", error_code: "x", error_message: "bad" }] });
    expect(await sendDraftViaEdgeX(db, "t1", draft)).toEqual({
      status: "already_handled",
      messageStatus: "failed",
      errorCode: "x",
      errorMessage: "bad",
    });
    expect(sendQueuedEmailBatchMock).not.toHaveBeenCalled();
  });

  it("heals a crash between send and mark without sending twice (double click safe)", async () => {
    const { db } = fakeDb({ messages: [{ id: "m1", status: "sent" }] });
    expect(await sendDraftViaEdgeX(db, "t1", draft)).toEqual({ status: "already_sent" });
    expect(sendQueuedEmailBatchMock).not.toHaveBeenCalled();
    expect(markDraftSentViaEdgeXMock).toHaveBeenCalledWith(db, "t1", "d1", "m1");
  });

  it("reports a queueing failure without sending", async () => {
    const { db } = fakeDb({ upsertError: true });
    const r = await sendDraftViaEdgeX(db, "t1", draft);
    expect(r.status).toBe("failed");
    expect(sendQueuedEmailBatchMock).not.toHaveBeenCalled();
  });
});
