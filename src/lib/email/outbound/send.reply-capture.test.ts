import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProvisionedReply, SentReplyRecord } from "./reply-capture";

// How sendQueuedEmailBatch wires in reply capture. Everything around it is mocked (no database,
// no network) — the point is the wiring: which Reply-To each message gets, what is handed to
// finalize, and that cleanup ALWAYS runs. (send.test.ts covers the rest of the sender and is DB-backed.)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const resendSendMock = vi.fn();
const provisionMock = vi.fn();
const finalizeMock = vi.fn(async (...args: unknown[]) => {
  void args;
});
const capStatusMock = vi.fn();

let queuedRows: Row[] = [];

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClientForTenant: async () => ({
    from() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        update: () => b,
        in: () => b,
        eq: () => b,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve({ data: queuedRows, error: null }).then(res, rej),
      };
      return b;
    },
  }),
}));
vi.mock("../sender", () => ({
  resolveTenantSender: async () => ({
    from: "Admizz Education <hello@mail.admizz.com>",
    replyTo: "hello@admizz.com",
    orgName: "Admizz Education",
    mailingAddress: null,
  }),
}));
vi.mock("../index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../index")>()),
  getResendClient: () => ({ emails: { send: (p: unknown) => resendSendMock(p) } }),
}));
vi.mock("./suppression", () => ({
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
  loadSuppressedEmails: async () => new Set<string>(),
}));
vi.mock("./unsubscribe", () => ({
  getOrCreateUnsubscribeToken: async () => "tok",
  unsubscribeUrl: () => "https://x/unsub",
  injectUnsubscribe: (html: string) => `${html}<footer/>`,
}));
vi.mock("./cap", () => ({ getDailyCapStatus: (...a: unknown[]) => capStatusMock(...a) }));
vi.mock("./rate-limit", () => ({ acquireResendRateLimitSlot: async () => {} }));
vi.mock("./reply-capture", async () => {
  const actual = await vi.importActual<typeof import("./reply-capture")>("./reply-capture");
  return {
    parseFromHeader: actual.parseFromHeader,
    provisionBulkReplyCapture: (...a: unknown[]) => provisionMock(...a),
    finalizeBulkReplyCapture: (...a: unknown[]) => finalizeMock(...a),
  };
});

const row = (id: string, lead: string | null = `lead-${id}`): Row => ({
  id,
  tenant_id: "tenant-a",
  lead_id: lead,
  to_email: `${id}@lead.com`,
  subject: `Subject ${id}`,
  body_html: `<p>Body ${id}</p>`,
  status: "queued",
  sending_started_at: null,
  attempt_count: 0,
});

const prov = (id: string): ProvisionedReply => ({
  threadId: `thread-${id}`,
  replyTo: `"Admizz Education" <reply+s${id}@edgex.zunkireelabs.com>`,
  leadId: `lead-${id}`,
  subject: `Subject ${id}`,
});

const ENV_KEYS = ["EMAIL_TRANSPORT", "EMAIL_OUTBOUND_SANDBOX", "EMAIL_TEST_RECIPIENTS"] as const;
const SAVED: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) SAVED[k] = process.env[k];
  process.env.EMAIL_TRANSPORT = "resend";
  process.env.EMAIL_OUTBOUND_SANDBOX = "false";
  delete process.env.EMAIL_TEST_RECIPIENTS;
  resendSendMock.mockReset().mockImplementation(async () => ({ data: { id: `resend-${Math.random()}` }, error: null }));
  provisionMock.mockReset().mockResolvedValue(new Map());
  finalizeMock.mockClear();
  capStatusMock.mockReset().mockResolvedValue({ dailyCap: 100, sentToday: 0, remaining: 100 });
  queuedRows = [];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

async function send(ids: string[]) {
  const { sendQueuedEmailBatch } = await import("./send");
  return sendQueuedEmailBatch("tenant-a", ids);
}

describe("sendQueuedEmailBatch × reply capture", () => {
  it("capture OFF (provision returns an empty map): Reply-To is the tenant's, exactly as before", async () => {
    queuedRows = [row("m1"), row("m2")];
    const result = await send(["m1", "m2"]);

    expect(result).toMatchObject({ sent: 2, failed: 0 });
    for (const call of resendSendMock.mock.calls) expect(call[0].replyTo).toBe("hello@admizz.com");
    // finalize is still called, with nothing provisioned and nothing recorded (a no-op inside)
    const [, provisioned, sentRecords] = finalizeMock.mock.calls[0] as [unknown, Map<string, unknown>, Map<string, unknown>];
    expect(provisioned.size).toBe(0);
    expect(sentRecords.size).toBe(0);
  });

  it("capture ON: each message gets ITS OWN EdgeX reply address as Reply-To", async () => {
    queuedRows = [row("m1"), row("m2")];
    provisionMock.mockResolvedValue(new Map([["m1", prov("m1")], ["m2", prov("m2")]]));
    const result = await send(["m1", "m2"]);

    expect(result.sent).toBe(2);
    const byTo = new Map(resendSendMock.mock.calls.map((c) => [c[0].to[0], c[0].replyTo]));
    expect(byTo.get("m1@lead.com")).toBe(prov("m1").replyTo);
    expect(byTo.get("m2@lead.com")).toBe(prov("m2").replyTo);
  });

  it("a message with no provisioned address (e.g. no lead) falls back to the tenant Reply-To while others are captured", async () => {
    queuedRows = [row("m1"), row("m2", null)];
    provisionMock.mockResolvedValue(new Map([["m1", prov("m1")]]));
    await send(["m1", "m2"]);

    const byTo = new Map(resendSendMock.mock.calls.map((c) => [c[0].to[0], c[0].replyTo]));
    expect(byTo.get("m1@lead.com")).toBe(prov("m1").replyTo);
    expect(byTo.get("m2@lead.com")).toBe("hello@admizz.com");
  });

  it("hands finalize exactly the messages that went out, with the body WITHOUT the unsubscribe footer", async () => {
    queuedRows = [row("m1"), row("m2")];
    provisionMock.mockResolvedValue(new Map([["m1", prov("m1")], ["m2", prov("m2")]]));
    resendSendMock.mockImplementation(async (p: Row) =>
      p.to[0] === "m2@lead.com"
        ? { data: null, error: { name: "validation_error", message: "rejected" } }
        : { data: { id: "resend-ok" }, error: null },
    );
    const result = await send(["m1", "m2"]);

    expect(result).toMatchObject({ sent: 1, failed: 1 });
    const [, provisioned, sentRecords] = finalizeMock.mock.calls[0] as [unknown, Map<string, ProvisionedReply>, Map<string, SentReplyRecord>];
    expect(provisioned.size).toBe(2);
    expect([...sentRecords.keys()]).toEqual(["m1"]); // m2 failed → not "sent" → finalize will delete its provisional thread
    expect(sentRecords.get("m1")).toMatchObject({
      bodyHtml: "<p>Body m1</p>",
      toEmail: "m1@lead.com",
      fromAddress: "hello@mail.admizz.com",
      fromName: "Admizz Education",
      providerMessageId: "resend-ok",
    });
    expect(sentRecords.get("m1")!.bodyHtml).not.toContain("footer");
  });

  it("only provisions for messages inside the daily cap", async () => {
    queuedRows = [row("m1"), row("m2"), row("m3")];
    capStatusMock.mockResolvedValue({ dailyCap: 1, sentToday: 0, remaining: 1 });
    const result = await send(["m1", "m2", "m3"]);

    expect(result.throttled).toBe(2);
    const provisionedFor = (provisionMock.mock.calls[0][1] as Row[]).map((m) => m.id);
    expect(provisionedFor).toEqual(["m1"]);
  });

  it("cleanup ALWAYS runs: if the env guard aborts the whole batch, finalize is still called so no empty threads are left", async () => {
    process.env.EMAIL_OUTBOUND_SANDBOX = "true"; // sandbox with no EMAIL_TEST_RECIPIENTS → the guard throws
    queuedRows = [row("m1")];
    provisionMock.mockResolvedValue(new Map([["m1", prov("m1")]]));

    await expect(send(["m1"])).rejects.toThrow(/EMAIL_TEST_RECIPIENTS/);

    expect(finalizeMock).toHaveBeenCalledTimes(1);
    const [, provisioned, sentRecords] = finalizeMock.mock.calls[0] as [unknown, Map<string, unknown>, Map<string, unknown>];
    expect(provisioned.size).toBe(1);
    expect(sentRecords.size).toBe(0);
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("stub transport (stage): still records sent messages for finalize, and never calls Resend", async () => {
    process.env.EMAIL_TRANSPORT = "stub";
    queuedRows = [row("m1")];
    provisionMock.mockResolvedValue(new Map([["m1", prov("m1")]]));
    const result = await send(["m1"]);

    expect(result.sent).toBe(1);
    expect(resendSendMock).not.toHaveBeenCalled();
    const [, , sentRecords] = finalizeMock.mock.calls[0] as [unknown, unknown, Map<string, SentReplyRecord>];
    expect(String(sentRecords.get("m1")!.providerMessageId)).toMatch(/^stub_/);
  });
});
