// Full-pipeline coverage for the INBOUND_ENV_MARKER amendment (brief §8/§13,
// commit 7495bce3): unlike route.test.ts (which mocks resolveInboundRecipients
// to unit-test the webhook route's own branching), THIS file leaves
// resolveInboundRecipients and the tokens.ts codec real, so a cross-environment
// delivery is proven end to end — the marker check must run before the DB
// lookup and before the dead-letter write, so a sibling environment's mail
// (stage's mail hitting prod's webhook, or vice versa) is silently ack'd with
// zero rows written to either `events` or `inbound_email_dead_letter`.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Webhook } from "svix";
import { mintToken } from "@/lib/email/inbound/tokens";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let insertedEvents: Row[];
let insertedDeadLetters: Row[];

vi.mock("@/lib/api/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 1, limit: 1, resetAt: 0, retryAfterSeconds: 0 }),
  INBOUND_TOKEN_LIMIT: { maxRequests: 30, windowMs: 60_000 },
}));

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
            if (table !== "inbound_addresses") return { data: null, error: null };
            const match = DB_ADDRESS_ROWS.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
            return { data: match ?? null, error: null };
          },
        }),
        insert: async (payload: Row) => {
          if (table === "events") {
            insertedEvents.push(payload);
            return { data: payload, error: null };
          }
          if (table === "inbound_email_dead_letter") {
            insertedDeadLetters.push(payload);
            return { data: payload, error: null };
          }
          return { data: null, error: null };
        },
      };
    },
  })),
}));

// A real DB row for the token minted below — proves the marker check trips
// BEFORE this row would ever be consulted, not because the row is absent.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DB_ADDRESS_ROWS: any[] = [];

import { POST } from "./route";

const WEBHOOK_SECRET = `whsec_${Buffer.from("a".repeat(32)).toString("base64")}`;
const DOMAIN = "inbound.edgex.zunkireelabs.com";

function signedRequest(body: unknown) {
  const payload = JSON.stringify(body);
  const msgId = "msg_env_marker_test";
  const timestamp = new Date();
  const wh = new Webhook(WEBHOOK_SECRET);
  return new Request("https://dev-lead-crm.zunkireelabs.com/api/webhooks/email/inbound", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": msgId,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": wh.sign(msgId, timestamp, payload),
    },
    body: payload,
  });
}

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test_dummy";
  process.env.RESEND_INBOUND_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.INBOUND_TOKEN_SECRET = "a".repeat(64);
  process.env.INBOUND_EMAIL_DOMAINS = DOMAIN;
  insertedEvents = [];
  insertedDeadLetters = [];
  DB_ADDRESS_ROWS = [];
});

describe("POST /api/webhooks/email/inbound — INBOUND_ENV_MARKER end to end (real tokens.ts + resolve.ts)", () => {
  it("a well-formed address minted by a SIBLING environment: 200, zero rows in events AND inbound_email_dead_letter", async () => {
    // Mint as if this were stage...
    process.env.INBOUND_ENV_MARKER = "s";
    const mintedOnStage = mintToken("reply");
    expect(mintedOnStage.localPart.startsWith("reply+s")).toBe(true);

    // ...but a real, active DB row exists for it (proves rejection happens
    // BEFORE the lookup would have found this row, not because it's missing).
    DB_ADDRESS_ROWS = [
      {
        id: "addr-1",
        tenant_id: "tenant-a",
        kind: "thread",
        verb: "reply",
        token: mintedOnStage.token,
        thread_id: "thread-1",
        user_id: null,
        status: "active",
      },
    ];

    // ...now this environment (prod) receives it via the shared Resend webhook.
    process.env.INBOUND_ENV_MARKER = "p";

    const event = {
      type: "email.received",
      created_at: "2026-07-28T10:00:00.000Z",
      data: {
        email_id: "resend-cross-env-1",
        created_at: "2026-07-28T10:00:00.000Z",
        from: "hardik@example.com",
        to: [mintedOnStage.address],
        cc: [] as string[],
        bcc: [] as string[],
        message_id: "<cross-env-1@example.com>",
        subject: "Re: Application status",
        attachments: [] as unknown[],
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(signedRequest(event) as any);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(insertedEvents).toHaveLength(0);
    expect(insertedDeadLetters).toHaveLength(0);
  });

  it("control: the SAME environment's token DOES resolve and enqueue (proves the test setup isn't just universally broken)", async () => {
    process.env.INBOUND_ENV_MARKER = "p";
    const minted = mintToken("reply");
    DB_ADDRESS_ROWS = [
      {
        id: "addr-1",
        tenant_id: "tenant-a",
        kind: "thread",
        verb: "reply",
        token: minted.token,
        thread_id: "thread-1",
        user_id: null,
        status: "active",
      },
    ];

    const event = {
      type: "email.received",
      created_at: "2026-07-28T10:00:00.000Z",
      data: {
        email_id: "resend-same-env-1",
        created_at: "2026-07-28T10:00:00.000Z",
        from: "hardik@example.com",
        to: [minted.address],
        cc: [] as string[],
        bcc: [] as string[],
        message_id: "<same-env-1@example.com>",
        subject: "Re: Application status",
        attachments: [] as unknown[],
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(signedRequest(event) as any);

    expect(res.status).toBe(200);
    expect(insertedEvents).toHaveLength(1);
    expect(insertedEvents[0].tenant_id).toBe("tenant-a");
    expect(insertedDeadLetters).toHaveLength(0);
  });
});
