import { beforeEach, describe, expect, it, vi } from "vitest";

const isSmsEnabledMock = vi.fn();
const loadSuppressedMock = vi.fn();
const sendQueuedBatchMock = vi.fn();
const markDraftSentViaSmsMock = vi.fn();
const stopSmsEnrollmentsMock = vi.fn();

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/sms/flag", () => ({ isSmsEnabledForTenant: (...a: unknown[]) => isSmsEnabledMock(...a) }));
vi.mock("@/lib/sms/suppression", () => ({ loadSuppressedPhones: (...a: unknown[]) => loadSuppressedMock(...a) }));
vi.mock("@/lib/sms/send", () => ({ sendQueuedBatch: (...a: unknown[]) => sendQueuedBatchMock(...a) }));
vi.mock("@/lib/sms/settings", () => ({
  loadTenantSmsSettings: async () => ({ sender_label: null, optout_footer: "Opt out: {url}" }),
  resolveTenantTimezone: async () => "Asia/Kathmandu",
}));
vi.mock("@/lib/sms/optout", () => ({ getOrCreateOptOutToken: async () => "TOKEN12345", optOutUrl: (t: string) => `https://x/${t}` }));
vi.mock("./engine", () => ({ markDraftSentViaSms: (...a: unknown[]) => markDraftSentViaSmsMock(...a) }));
vi.mock("./stop-on-sms-optout", () => ({ stopSmsEnrollmentsForLead: (...a: unknown[]) => stopSmsEnrollmentsMock(...a) }));

import { sendDraftViaSms } from "./send-draft-sms";

const draft = { id: "d1", lead_id: "l1", body_html: "Hi Sita, checking in" };

interface FakeOpts {
  phone?: string | null;
  reserveOk?: boolean;
  claimed?: boolean;
  existing?: { id: string; status: string; error_code?: string | null; error_message?: string | null } | null;
}

function fakeDb(opts: FakeOpts = {}) {
  const calls: Array<{ table: string; op: string; row?: unknown }> = [];
  const phone = opts.phone === undefined ? "9801234567" : opts.phone;
  const chain = (table: string, op: string, row?: unknown) => {
    if (op !== "select") calls.push({ table, op, row });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      eq: () => b,
      is: () => b,
      select: () => b,
      single: async () => ({ data: { id: "m1", status: "queued" }, error: null }),
      maybeSingle: async () => {
        if (table === "leads") return { data: { phone } };
        if (table === "sms_messages") return { data: opts.existing ?? { id: "m1", status: "queued", estimated_credits: 1 } };
        return { data: null };
      },
      then: (resolve: (v: unknown) => void) => {
        const data = op === "update" && table === "sequence_step_drafts" ? (opts.claimed === false ? [] : [{ id: "d1" }]) : null;
        resolve({ data, error: null });
      },
    };
    return b;
  };
  const db = {
    from: (table: string) => ({
      select: () => chain(table, "select"),
      insert: (row: unknown) => chain(table, "insert", row),
      update: (row: unknown) => chain(table, "update", row),
      delete: () => chain(table, "delete"),
    }),
    rpc: async (name: string) => ({ data: name === "sms_credits_reserve" ? { ok: opts.reserveOk !== false } : { ok: true }, error: null }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { db, calls };
}

describe("sendDraftViaSms", () => {
  beforeEach(() => {
    for (const m of [isSmsEnabledMock, loadSuppressedMock, sendQueuedBatchMock, markDraftSentViaSmsMock, stopSmsEnrollmentsMock]) m.mockReset();
    isSmsEnabledMock.mockResolvedValue(true);
    loadSuppressedMock.mockResolvedValue(new Set());
  });

  it("queues, reserves credits, sends, settles and marks the draft sent", async () => {
    sendQueuedBatchMock.mockResolvedValue({ sent: 1, failed: 0, totalCreditsCharged: 1 });
    const { db, calls } = fakeDb();
    const r = await sendDraftViaSms(db, "t1", draft);
    expect(r).toEqual({ status: "sent", smsMessageId: "m1" });
    expect(sendQueuedBatchMock).toHaveBeenCalledWith("t1", ["m1"]);
    expect(markDraftSentViaSmsMock).toHaveBeenCalledWith(db, "t1", "d1", "m1");
    const inserted = calls.find((c) => c.table === "sms_messages" && c.op === "insert")?.row as { source: string; body: string };
    expect(inserted.source).toBe("sequence");
    expect(inserted.body).toContain("Hi Sita, checking in");
    expect(inserted.body).toContain("Opt out:"); // the opt-out footer is added at send time
  });

  it("never sends an empty message (it would be just the sender name and the opt-out link)", async () => {
    const { db } = fakeDb();
    const r = await sendDraftViaSms(db, "t1", { ...draft, body_html: "   " });
    expect(r).toMatchObject({ status: "failed", errorCode: "empty_message" });
    expect(sendQueuedBatchMock).not.toHaveBeenCalled();
  });

  it("does nothing when SMS is not turned on for the tenant", async () => {
    const { db } = fakeDb();
    isSmsEnabledMock.mockResolvedValue(false);
    expect(await sendDraftViaSms(db, "t1", draft)).toEqual({ status: "sms_disabled" });
    expect(sendQueuedBatchMock).not.toHaveBeenCalled();
  });

  it("leaves the draft pending when the lead has no usable phone", async () => {
    const { db } = fakeDb({ phone: null });
    const r = await sendDraftViaSms(db, "t1", draft);
    expect(r.status).toBe("no_phone");
    expect(sendQueuedBatchMock).not.toHaveBeenCalled();
  });

  it("never texts an opted-out number and ends that lead's SMS sequence", async () => {
    loadSuppressedMock.mockResolvedValue(new Set(["+9779801234567"]));
    const { db } = fakeDb();
    const r = await sendDraftViaSms(db, "t1", draft);
    expect(r).toMatchObject({ status: "failed", suppressed: true });
    expect(stopSmsEnrollmentsMock).toHaveBeenCalledWith(db, { tenantId: "t1", leadId: "l1", reason: "opt_out" });
    expect(sendQueuedBatchMock).not.toHaveBeenCalled();
  });

  it("with too few credits sends nothing, drops the queued row and stays retryable", async () => {
    const { db, calls } = fakeDb({ reserveOk: false });
    expect(await sendDraftViaSms(db, "t1", draft)).toEqual({ status: "no_credits" });
    expect(sendQueuedBatchMock).not.toHaveBeenCalled();
    expect(calls.some((c) => c.table === "sms_messages" && c.op === "delete")).toBe(true);
  });

  it("does not queue a second text when another run already claimed the draft", async () => {
    const { db, calls } = fakeDb({ claimed: false });
    expect(await sendDraftViaSms(db, "t1", draft)).toEqual({ status: "in_progress" });
    expect(sendQueuedBatchMock).not.toHaveBeenCalled();
    expect(calls.some((c) => c.table === "sms_messages" && c.op === "delete")).toBe(true);
  });

  it("heals a draft whose text already went out instead of sending again", async () => {
    const { db } = fakeDb({ existing: { id: "m9", status: "delivered" } });
    expect(await sendDraftViaSms(db, "t1", { ...draft, sms_message_id: "m9" })).toEqual({ status: "already_sent" });
    expect(markDraftSentViaSmsMock).toHaveBeenCalledWith(db, "t1", "d1", "m9");
    expect(sendQueuedBatchMock).not.toHaveBeenCalled();
  });

  it("a message the provider accepted but the batch could not confirm (left 'submitted') still counts as sent, never as failed", async () => {
    sendQueuedBatchMock.mockResolvedValue({ sent: 0, failed: 0, totalCreditsCharged: 0 });
    const { db } = fakeDb({ existing: { id: "m1", status: "submitted" } });
    const r = await sendDraftViaSms(db, "t1", draft);
    expect(r).toEqual({ status: "sent", smsMessageId: "m1" });
    expect(markDraftSentViaSmsMock).toHaveBeenCalledWith(db, "t1", "d1", "m1");
  });

  it("reports a failed send with the reason from the message row", async () => {
    sendQueuedBatchMock.mockResolvedValue({ sent: 0, failed: 1, totalCreditsCharged: 0 });
    const { db } = fakeDb();
    const r = await sendDraftViaSms(db, "t1", draft);
    expect(r.status).toBe("failed");
    expect(markDraftSentViaSmsMock).not.toHaveBeenCalled();
  });
});
