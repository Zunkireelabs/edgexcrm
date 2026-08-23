import { describe, it, expect, vi, beforeEach } from "vitest";
import { Webhook } from "svix";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let messageRows: Row[];
let suppressionInserts: Row[];

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: vi.fn(async () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      return {
        select: () => ({
          eq(col: string, val: unknown) {
            filters[col] = val;
            return this;
          },
          maybeSingle: async () => {
            if (table !== "email_messages") return { data: null, error: null };
            const match = messageRows.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
            return { data: match ?? null, error: null };
          },
        }),
      };
    },
  })),
}));

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClientForTenant: vi.fn(async (tenantId: string) => ({
    from(table: string) {
      function selectBuilder(filters: Record<string, unknown>, opts?: { count?: string; head?: boolean }) {
        return {
          eq(col: string, val: unknown) {
            return selectBuilder({ ...filters, [col]: val }, opts);
          },
          then(resolve: (v: { count: number; error: null }) => unknown) {
            const n = messageRows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v)).length;
            return Promise.resolve(resolve({ count: n, error: null }));
          },
        };
      }
      return {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          return selectBuilder({ tenant_id: tenantId }, opts);
        },
        update(values: Row) {
          return {
            eq: (col: string, val: unknown) => {
              const target = messageRows.find((r) => r[col] === val && r.tenant_id === tenantId);
              if (target) Object.assign(target, values);
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
        upsert(rows: Row) {
          if (table === "email_suppressions") suppressionInserts.push({ ...rows, tenant_id: tenantId });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  })),
}));

import { POST } from "./route";

const WEBHOOK_SECRET = `whsec_${Buffer.from("b".repeat(32)).toString("base64")}`;

function baseEventData(emailId: string) {
  return {
    email_id: emailId,
    created_at: "2026-08-23T10:00:00.000Z",
    from: "hello@admizz.com",
    to: ["student@example.com"],
    subject: "Hello",
  };
}

function signedRequest(body: unknown, opts?: { badSig?: boolean; omitHeaders?: boolean; secret?: string }) {
  const payload = JSON.stringify(body);
  const msgId = "msg_events_test";
  const timestamp = new Date();

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!opts?.omitHeaders) {
    const wh = new Webhook(opts?.secret ?? WEBHOOK_SECRET);
    headers["svix-id"] = msgId;
    headers["svix-timestamp"] = String(Math.floor(timestamp.getTime() / 1000));
    headers["svix-signature"] = opts?.badSig ? "v1,dGFtcGVyZWQ=" : wh.sign(msgId, timestamp, payload);
  }

  return new Request("https://dev-lead-crm.zunkireelabs.com/api/webhooks/email/events", {
    method: "POST",
    headers,
    body: payload,
  });
}

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test_dummy";
  process.env.RESEND_EVENTS_WEBHOOK_SECRET = WEBHOOK_SECRET;
  messageRows = [];
  suppressionInserts = [];
});

describe("POST /api/webhooks/email/events — verify-first", () => {
  it("rejects with 403 on an invalid signature", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = signedRequest({ type: "email.delivered", data: baseEventData("x") }, { badSig: true }) as any;
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("rejects with 403 when svix headers are missing", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = signedRequest({ type: "email.delivered", data: baseEventData("x") }, { omitHeaders: true }) as any;
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("rejects with 403 (fail-closed) when RESEND_EVENTS_WEBHOOK_SECRET is unset", async () => {
    delete process.env.RESEND_EVENTS_WEBHOOK_SECRET;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = signedRequest({ type: "email.delivered", data: baseEventData("x") }) as any;
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("200 no-op for an ignored event type (email.opened) — never touches a row", async () => {
    messageRows = [{ id: "m1", tenant_id: "t1", to_email: "student@example.com", lead_id: null, provider_message_id: "re_1" }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = signedRequest({ type: "email.opened", data: baseEventData("re_1") }) as any;
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(messageRows[0].status).toBeUndefined();
  });

  it("200 no-op for an unmatched provider_message_id — never 500s", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = signedRequest({ type: "email.delivered", data: baseEventData("re_unknown") }) as any;
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });

  it("response body is IDENTICAL whether matched or not", async () => {
    messageRows = [{ id: "m1", tenant_id: "t1", to_email: "student@example.com", lead_id: null, provider_message_id: "re_1" }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matched = await POST(signedRequest({ type: "email.delivered", data: baseEventData("re_1") }) as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unmatched = await POST(signedRequest({ type: "email.delivered", data: baseEventData("re_unknown") }) as any);
    expect(await matched.json()).toEqual(await unmatched.json());
    expect(matched.status).toBe(unmatched.status);
  });
});

describe("POST /api/webhooks/email/events — tenant derived from the matched row, never the payload", () => {
  it("email.delivered stamps delivered_at on the matched tenant's row", async () => {
    messageRows = [{ id: "m1", tenant_id: "tenant-a", to_email: "student@example.com", lead_id: null, provider_message_id: "re_1", status: "sent" }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = signedRequest({ type: "email.delivered", data: baseEventData("re_1") }) as any;
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(messageRows[0].status).toBe("delivered");
    expect(messageRows[0].delivered_at).toBeDefined();
  });

  it("email.bounced with a Permanent bounce suppresses immediately with reason hard_bounce", async () => {
    messageRows = [{ id: "m1", tenant_id: "tenant-a", to_email: "bounced@example.com", lead_id: "lead-1", provider_message_id: "re_2", status: "sent" }];
    const req = signedRequest({
      type: "email.bounced",
      data: { ...baseEventData("re_2"), bounce: { type: "Permanent", subType: "General", message: "mailbox does not exist" } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(messageRows[0].status).toBe("bounced");
    expect(suppressionInserts).toHaveLength(1);
    expect(suppressionInserts[0]).toMatchObject({ email: "bounced@example.com", reason: "hard_bounce", tenant_id: "tenant-a" });
  });

  it("email.bounced with a Transient bounce does NOT suppress on the first occurrence", async () => {
    messageRows = [{ id: "m1", tenant_id: "tenant-a", to_email: "soft@example.com", lead_id: null, provider_message_id: "re_3", status: "sent" }];
    const req = signedRequest({
      type: "email.bounced",
      data: { ...baseEventData("re_3"), bounce: { type: "Transient", subType: "MailboxFull", message: "mailbox full" } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    await POST(req);
    expect(suppressionInserts).toHaveLength(0);
    expect(messageRows[0].status).toBe("bounced");
  });

  it("email.bounced with an ambiguous/unrecognized bounce type does NOT suppress", async () => {
    messageRows = [{ id: "m1", tenant_id: "tenant-a", to_email: "unclear@example.com", lead_id: null, provider_message_id: "re_4", status: "sent" }];
    const req = signedRequest({
      type: "email.bounced",
      data: { ...baseEventData("re_4"), bounce: { type: "Undetermined", subType: "Unknown", message: "unclear" } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    await POST(req);
    expect(suppressionInserts).toHaveLength(0);
  });

  it("email.complained always suppresses, no threshold", async () => {
    messageRows = [{ id: "m1", tenant_id: "tenant-a", to_email: "complainer@example.com", lead_id: null, provider_message_id: "re_5", status: "delivered" }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = signedRequest({ type: "email.complained", data: baseEventData("re_5") }) as any;
    await POST(req);
    expect(suppressionInserts).toHaveLength(1);
    expect(suppressionInserts[0]).toMatchObject({ email: "complainer@example.com", reason: "complaint" });
    expect(messageRows[0].status).toBe("complained");
  });
});
