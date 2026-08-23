import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { localRawClient } from "./test-support";

// DB-backed, same precedent as src/lib/sms/credits-idempotency.test.ts /
// optout.test.ts: skips cleanly when the local Supabase stack isn't up.
//
// Unlike the SMS tests, this file points the REAL createServiceClient() at
// the local stack (rather than hand-rolling a fake ScopedClient) so
// sendQueuedEmailBatch runs through its actual production code path —
// scopedClientForTenant, resolveTenantSender — end to end. Only the Resend
// provider call is mocked; everything else hits real local Postgres.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.EMAIL_OUTBOUND_SANDBOX = "false"; // env-guard itself is covered separately in env-guard.test.ts

const sendMock = vi.fn();
vi.mock("../index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../index")>();
  return {
    ...actual,
    getResendClient: () => ({ emails: { send: sendMock } }),
  };
});

const db = localRawClient();

let localDbAvailable = false;
let tenantId: string;
let leadId: string;

beforeAll(async () => {
  try {
    const { data, error } = await db.from("leads").select("id, tenant_id").limit(1).single();
    if (error || !data) return;
    tenantId = (data as { id: string; tenant_id: string }).tenant_id;
    leadId = (data as { id: string; tenant_id: string }).id;
    localDbAvailable = true;
  } catch {
    // Local Supabase stack not running.
  }
}, 5000);

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockImplementation(async (payload: { to: string[] }) => ({
    data: { id: `resend-${payload.to[0]}-${Math.random().toString(36).slice(2)}` },
    error: null,
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

async function insertMessage(overrides: Record<string, unknown>) {
  const { data, error } = await db
    .from("email_messages")
    .insert({
      tenant_id: tenantId,
      lead_id: leadId,
      source: "manual",
      source_id: null,
      to_email: `test.${Math.random().toString(36).slice(2)}@example.com`,
      subject: "Hi",
      body_html: "<p>hi</p>",
      status: "queued",
      attempt_count: 0,
      ...overrides,
    })
    .select("*")
    .single();
  if (error) throw new Error(`insertMessage failed: ${error.message}`);
  return data as {
    id: string;
    to_email: string;
    status: string;
    attempt_count: number;
    error_code: string | null;
    provider_message_id: string | null;
  };
}

async function readMessage(id: string) {
  const { data } = await db.from("email_messages").select("*").eq("id", id).single();
  return data as {
    id: string;
    to_email: string;
    status: string;
    attempt_count: number;
    error_code: string | null;
    provider_message_id: string | null;
  };
}

describe("§5.1 — double-send on retry (non-idempotent materialization analogue)", () => {
  it("the partial unique index rejects a duplicate (source_id, lead_id) materialization, and a retried send never re-sends an already-sent row", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }

    const { sendQueuedEmailBatch } = await import("./send");

    const sourceId = crypto.randomUUID();
    const toEmail = `retry.${Date.now()}@example.com`;

    const first = await db
      .from("email_messages")
      .insert({
        tenant_id: tenantId,
        lead_id: leadId,
        source: "manual",
        source_id: sourceId,
        to_email: toEmail,
        subject: "Retry test",
        body_html: "<p>hi</p>",
        status: "queued",
      })
      .select("id")
      .single();
    expect(first.error).toBeNull();
    const messageId = (first.data as { id: string }).id;

    // A retried materialization job re-inserting the SAME (source_id, lead_id)
    // pair must be rejected by the unique index, not silently create a
    // second row that would later cause the provider to be called twice.
    const second = await db.from("email_messages").insert({
      tenant_id: tenantId,
      lead_id: leadId,
      source: "manual",
      source_id: sourceId,
      to_email: toEmail,
      subject: "Retry test",
      body_html: "<p>hi</p>",
      status: "queued",
    });
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe("23505");

    const { count } = await db
      .from("email_messages")
      .select("id", { count: "exact", head: true })
      .eq("source_id", sourceId);
    expect(count).toBe(1);

    // Now simulate the retried SEND (e.g. an Inngest step re-run) over the
    // same single materialized id, twice.
    const firstRun = await sendQueuedEmailBatch(tenantId, [messageId]);
    expect(firstRun.sent).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);

    const secondRun = await sendQueuedEmailBatch(tenantId, [messageId]);
    expect(secondRun.sent).toBe(0); // no longer queued/sending — already 'sent'
    expect(sendMock).toHaveBeenCalledTimes(1); // still exactly once, not twice

    const finalRow = await readMessage(messageId);
    expect(finalRow.status).toBe("sent");
  });

  it("a chunked upsert materialization with one pre-existing (source_id, lead_id) pair skips only that pair and lands the rest — the actual Phase 1 failure mode", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }

    // Distinct lead ids so only ONE (source_id, lead_id) pair in the chunk
    // collides — the other N-1 pairs must land in the SAME statement. This is
    // what breaks under a WHERE source_id IS NOT NULL partial index: PostgREST's
    // on_conflict can only target columns, not a partial index's predicate, so
    // Postgres can't resolve the ON CONFLICT clause and the whole chunk 23505s.
    const { data: leads, error: leadsError } = await db
      .from("leads")
      .select("id")
      .eq("tenant_id", tenantId)
      .limit(4);
    expect(leadsError).toBeNull();
    const leadIds = (leads as { id: string }[]).map((l) => l.id);
    expect(leadIds.length).toBeGreaterThanOrEqual(4);

    const sourceId = crypto.randomUUID();

    // Materialize one row up front, simulating a prior partial run.
    const preExisting = await db
      .from("email_messages")
      .insert({
        tenant_id: tenantId,
        lead_id: leadIds[0],
        source: "blast",
        source_id: sourceId,
        to_email: `chunk0.${Date.now()}@example.com`,
        subject: "Blast",
        body_html: "<p>hi</p>",
        status: "queued",
      })
      .select("id")
      .single();
    expect(preExisting.error).toBeNull();

    // Re-run the chunk exactly as a retried materialization job would: the
    // SAME (source_id, leadIds[0]) pair plus 3 new pairs, in one .upsert() call.
    const chunk = leadIds.map((leadId, i) => ({
      tenant_id: tenantId,
      lead_id: leadId,
      source: "blast",
      source_id: sourceId,
      to_email: `chunk${i}.${Date.now()}@example.com`,
      subject: "Blast",
      body_html: "<p>hi</p>",
      status: "queued",
    }));

    const { error: upsertError } = await db
      .from("email_messages")
      .upsert(chunk, { onConflict: "source_id,lead_id", ignoreDuplicates: true });
    expect(upsertError).toBeNull();

    const { count } = await db
      .from("email_messages")
      .select("id", { count: "exact", head: true })
      .eq("source_id", sourceId);

    // 1 pre-existing + 3 new = 4 total, never 1 (whole chunk dropped) or 5
    // (duplicate landed as a second row).
    expect(count).toBe(4);
  });
});

describe("§5.2 — stranded 'sending' rows", () => {
  it("reclaims a stale 'sending' row and resends it", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }
    const { sendQueuedEmailBatch } = await import("./send");

    const staleTimestamp = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago
    const row = await insertMessage({ status: "sending", sending_started_at: staleTimestamp, attempt_count: 1 });

    const result = await sendQueuedEmailBatch(tenantId, [row.id]);
    expect(result.sent).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);

    const final = await readMessage(row.id);
    expect(final.status).toBe("sent");
  });

  it("fails a stale 'sending' row outright once attempt_count reaches the max — never retried forever", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }
    const { sendQueuedEmailBatch } = await import("./send");

    const staleTimestamp = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const row = await insertMessage({ status: "sending", sending_started_at: staleTimestamp, attempt_count: 3 });

    const result = await sendQueuedEmailBatch(tenantId, [row.id]);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(sendMock).not.toHaveBeenCalled();

    const final = await readMessage(row.id);
    expect(final.status).toBe("failed");
    expect(final.error_code).toBe("stranded_max_attempts");
  });

  it("leaves a fresh (non-stale) 'sending' row untouched — it may genuinely be in flight elsewhere", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }
    const { sendQueuedEmailBatch } = await import("./send");

    const row = await insertMessage({ status: "sending", sending_started_at: new Date().toISOString(), attempt_count: 0 });

    const result = await sendQueuedEmailBatch(tenantId, [row.id]);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();

    const final = await readMessage(row.id);
    expect(final.status).toBe("sending"); // untouched
  });
});

describe("§5.3 — attribution: one row = one provider call", () => {
  it("a batch of N rows produces exactly N provider calls with exactly one recipient each, and a mid-batch failure leaves the rest correctly attributed", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }
    const { sendQueuedEmailBatch } = await import("./send");

    const row1 = await insertMessage({ to_email: `attr1.${Date.now()}@example.com` });
    const row2 = await insertMessage({ to_email: `attr2.${Date.now()}@example.com` });
    const row3 = await insertMessage({ to_email: `attr3.${Date.now()}@example.com` });

    sendMock.mockImplementation(async (payload: { to: string[] }) => {
      expect(payload.to).toHaveLength(1); // never more than one recipient per call
      if (payload.to[0] === row2.to_email) {
        return { data: null, error: { message: "simulated provider rejection" } };
      }
      return { data: { id: `resend-${payload.to[0]}` }, error: null };
    });

    const result = await sendQueuedEmailBatch(tenantId, [row1.id, row2.id, row3.id]);

    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);

    const [final1, final2, final3] = await Promise.all([readMessage(row1.id), readMessage(row2.id), readMessage(row3.id)]);

    // The row that failed is the row that was supposed to fail — no shift.
    expect(final1.status).toBe("sent");
    expect(final1.provider_message_id).toBe(`resend-${row1.to_email}`);
    expect(final2.status).toBe("failed");
    expect(final2.error_code).toBe("provider_error");
    expect(final3.status).toBe("sent");
    expect(final3.provider_message_id).toBe(`resend-${row3.to_email}`);
  });
});

describe("send.ts — suppression safety net and daily cap (§4.6)", () => {
  it("drops a suppressed recipient before the provider call, and still sends the rest", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }
    const { sendQueuedEmailBatch } = await import("./send");

    const suppressedEmail = `suppressed.${Date.now()}@example.com`;
    const okEmail = `notsuppressed.${Date.now()}@example.com`;

    const rowSuppressed = await insertMessage({ to_email: suppressedEmail });
    const rowOk = await insertMessage({ to_email: okEmail });

    // suppressEmail() itself is unit-tested against the ScopedClient contract
    // in suppression.test.ts — here we only need a suppression row to exist,
    // so insert it directly against the raw local client.
    const { error: suppressError } = await db
      .from("email_suppressions")
      .insert({ tenant_id: tenantId, email: suppressedEmail, reason: "unsubscribe", source: "test" });
    expect(suppressError).toBeNull();

    const result = await sendQueuedEmailBatch(tenantId, [rowSuppressed.id, rowOk.id]);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].to).toEqual([okEmail]);
    expect(result.suppressed).toBe(1);
    expect(result.sent).toBe(1);

    const finalSuppressed = await readMessage(rowSuppressed.id);
    expect(finalSuppressed.status).toBe("suppressed");
  });
});
