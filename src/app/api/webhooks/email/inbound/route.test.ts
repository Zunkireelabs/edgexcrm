import { describe, it, expect, vi, beforeEach } from "vitest";
import { Webhook } from "svix";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

interface ResolveResult {
  matches: Array<{
    id: string;
    tenantId: string;
    kind: "thread" | "user" | "tenant";
    verb: "reply" | "bcc" | "fwd";
    token: string;
    threadId: string | null;
    userId: string | null;
  }>;
  hadCandidateButNoMatch: boolean;
}

let insertedEvents: Row[];
let insertedDeadLetters: Row[];
let forceDeadLetterError: { code: string; message: string } | null;

const resolveInboundRecipientsMock = vi.fn(
  async (candidates: { to: string[]; cc: string[]; bcc: string[] }): Promise<ResolveResult> => {
    void candidates;
    return { matches: [], hadCandidateButNoMatch: false };
  },
);

vi.mock("@/lib/email/inbound/resolve", () => ({
  resolveInboundRecipients: (candidates: { to: string[]; cc: string[]; bcc: string[] }) =>
    resolveInboundRecipientsMock(candidates),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: vi.fn(async () => ({
    from(table: string) {
      return {
        insert: async (payload: Row) => {
          if (table === "events") {
            insertedEvents.push(payload);
            return { data: payload, error: null };
          }
          if (table === "inbound_email_dead_letter") {
            if (forceDeadLetterError) return { data: null, error: forceDeadLetterError };
            insertedDeadLetters.push(payload);
            return { data: payload, error: null };
          }
          return { data: null, error: null };
        },
      };
    },
  })),
}));

import { POST } from "./route";

const WEBHOOK_SECRET = `whsec_${Buffer.from("a".repeat(32)).toString("base64")}`;

const RECEIVED_EVENT = {
  type: "email.received",
  created_at: "2026-07-28T10:00:00.000Z",
  data: {
    email_id: "resend-inbound-1",
    created_at: "2026-07-28T10:00:00.000Z",
    from: "hardik@example.com",
    to: ["reply+labcdef@inbound.edgex.zunkireelabs.com"],
    cc: [] as string[],
    bcc: [] as string[],
    message_id: "<reply-1@example.com>",
    subject: "Re: Application status",
    attachments: [] as unknown[],
  },
};

function signedRequest(body: unknown, opts?: { badSig?: boolean; omitHeaders?: boolean; secret?: string }) {
  const payload = JSON.stringify(body);
  const msgId = "msg_test123";
  const timestamp = new Date();

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!opts?.omitHeaders) {
    const wh = new Webhook(opts?.secret ?? WEBHOOK_SECRET);
    headers["svix-id"] = msgId;
    headers["svix-timestamp"] = String(Math.floor(timestamp.getTime() / 1000));
    headers["svix-signature"] = opts?.badSig ? "v1,dGFtcGVyZWQ=" : wh.sign(msgId, timestamp, payload);
  }

  return new Request("https://dev-lead-crm.zunkireelabs.com/api/webhooks/email/inbound", {
    method: "POST",
    headers,
    body: payload,
  });
}

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test_dummy";
  process.env.RESEND_INBOUND_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.INBOUND_EMAIL_DOMAINS = "lead-crm.zunkireelabs.com";
  insertedEvents = [];
  insertedDeadLetters = [];
  forceDeadLetterError = null;
  resolveInboundRecipientsMock.mockReset().mockResolvedValue({ matches: [], hadCandidateButNoMatch: false });
});

describe("POST /api/webhooks/email/inbound — verify-first (brief §7)", () => {
  it("rejects with 403 on an invalid signature and never calls resolveInboundRecipients", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = signedRequest(RECEIVED_EVENT, { badSig: true }) as any;
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(resolveInboundRecipientsMock).not.toHaveBeenCalled();
    expect(insertedEvents).toHaveLength(0);
  });

  it("rejects with 403 when svix headers are missing", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = signedRequest(RECEIVED_EVENT, { omitHeaders: true }) as any;
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(resolveInboundRecipientsMock).not.toHaveBeenCalled();
  });

  it("rejects with 403 (fail-closed) when RESEND_INBOUND_WEBHOOK_SECRET is unset", async () => {
    delete process.env.RESEND_INBOUND_WEBHOOK_SECRET;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = signedRequest(RECEIVED_EVENT) as any;
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(resolveInboundRecipientsMock).not.toHaveBeenCalled();
  });

  it("200 no-op for a non-'email.received' event type — never resolves recipients", async () => {
    const otherEvent = { type: "email.delivered", created_at: "2026-07-28T10:00:00.000Z", data: { email_id: "x" } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = signedRequest(otherEvent) as any;
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(resolveInboundRecipientsMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/email/inbound — tenant resolution + enqueue (brief §8)", () => {
  it("enqueues one events row per matched address (multi-tenant CC)", async () => {
    resolveInboundRecipientsMock.mockResolvedValue({
      matches: [
        { id: "addr-a", tenantId: "tenant-a", kind: "thread", verb: "reply", token: "tok-a", threadId: "thread-a", userId: null },
        { id: "addr-b", tenantId: "tenant-b", kind: "thread", verb: "reply", token: "tok-b", threadId: "thread-b", userId: null },
      ],
      hadCandidateButNoMatch: false,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = signedRequest(RECEIVED_EVENT) as any;
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(insertedEvents).toHaveLength(2);
    const tenantIds = insertedEvents.map((e) => e.tenant_id).sort();
    expect(tenantIds).toEqual(["tenant-a", "tenant-b"]);
    expect(insertedEvents[0]).toMatchObject({
      type: "email.inbound_received",
      entity_type: "inbound_address",
      status: "pending",
    });
    expect(insertedEvents[0].payload).toMatchObject({
      resend_email_id: "resend-inbound-1",
      envelope: { subject: "Re: Application status" },
    });
    expect(insertedDeadLetters).toHaveLength(0);
  });

  it("zero matches + hadCandidateButNoMatch=true: writes a dead-letter row with tenant_id=null", async () => {
    resolveInboundRecipientsMock.mockResolvedValue({ matches: [], hadCandidateButNoMatch: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = signedRequest(RECEIVED_EVENT) as any;
    await POST(req);

    expect(insertedEvents).toHaveLength(0);
    expect(insertedDeadLetters).toHaveLength(1);
    expect(insertedDeadLetters[0]).toMatchObject({
      tenant_id: null,
      provider_message_id: "resend-inbound-1",
      reason: "no_token",
    });
  });

  it("zero matches + hadCandidateButNoMatch=false (cross-env/cross-domain junk): writes NOTHING — the PII-leak-prevention path", async () => {
    resolveInboundRecipientsMock.mockResolvedValue({ matches: [], hadCandidateButNoMatch: false });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = signedRequest(RECEIVED_EVENT) as any;
    await POST(req);

    expect(insertedEvents).toHaveLength(0);
    expect(insertedDeadLetters).toHaveLength(0);
  });

  it("a redelivered dead-letter (23505 unique violation) is a silent no-op, not an error", async () => {
    forceDeadLetterError = { code: "23505", message: "duplicate key" };
    resolveInboundRecipientsMock.mockResolvedValue({ matches: [], hadCandidateButNoMatch: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = signedRequest(RECEIVED_EVENT) as any;
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });

  it("Stage 1: addressed to noreply@<inbound domain> writes exactly one dead-letter (inbound_unroutable_platform_address) and no event", async () => {
    resolveInboundRecipientsMock.mockResolvedValue({ matches: [], hadCandidateButNoMatch: false });
    const event = {
      ...RECEIVED_EVENT,
      data: { ...RECEIVED_EVENT.data, to: ["noreply@lead-crm.zunkireelabs.com"] },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = signedRequest(event) as any;
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(insertedEvents).toHaveLength(0);
    expect(insertedDeadLetters).toHaveLength(1);
    expect(insertedDeadLetters[0]).toMatchObject({
      tenant_id: null,
      provider_message_id: "resend-inbound-1",
      reason: "inbound_unroutable_platform_address",
    });
  });

  it("Stage 1: addressed to randomjunk@<inbound domain> writes neither a dead-letter nor an event", async () => {
    resolveInboundRecipientsMock.mockResolvedValue({ matches: [], hadCandidateButNoMatch: false });
    const event = {
      ...RECEIVED_EVENT,
      data: { ...RECEIVED_EVENT.data, to: ["randomjunk@lead-crm.zunkireelabs.com"] },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = signedRequest(event) as any;
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(insertedEvents).toHaveLength(0);
    expect(insertedDeadLetters).toHaveLength(0);
  });

  it("response body is IDENTICAL ({received:true}) whether matched or not — no token-enumeration oracle", async () => {
    resolveInboundRecipientsMock.mockResolvedValueOnce({
      matches: [{ id: "addr-a", tenantId: "tenant-a", kind: "thread", verb: "reply", token: "tok-a", threadId: "thread-a", userId: null }],
      hadCandidateButNoMatch: false,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matchedRes = await POST(signedRequest(RECEIVED_EVENT) as any);
    const matchedBody = await matchedRes.json();

    resolveInboundRecipientsMock.mockResolvedValueOnce({ matches: [], hadCandidateButNoMatch: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unmatchedRes = await POST(signedRequest(RECEIVED_EVENT) as any);
    const unmatchedBody = await unmatchedRes.json();

    expect(matchedRes.status).toBe(unmatchedRes.status);
    expect(matchedBody).toEqual(unmatchedBody);
    expect(matchedBody).toEqual({ received: true });
  });
});
