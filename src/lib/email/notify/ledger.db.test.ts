import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { localRawClient } from "@/lib/email/outbound/test-support";
import { requireLocalDbInCi } from "@/lib/test-support/require-db-in-ci";
import { claimLedgerRow, settleLedgerRow, type LedgerKey } from "./ledger";

// DB-backed (REAL Postgres via the local Supabase stack — skips cleanly when it isn't up, or when migration 281 isn't
// applied yet; a hard failure in CI's "Test (database-backed)" job). Pins the guarantees the notification emails
// depend on, which the dispatcher's fake-database unit tests cannot prove: the UNIQUE (event, entity, recipient)
// key really rejects a second claim, the status CHECK is enforced, and settle() really updates the claimed row.

const db = localRawClient();
const EVENT = `ledger_test_${randomUUID().slice(0, 8)}`;

let available = false;
let tenantId: string;
const entityIds: string[] = [];

const keyFor = (entity: string, email: string): LedgerKey => ({ tenant_id: tenantId, event: EVENT, entity_id: entity, recipient_email: email });
const rowFor = async (k: LedgerKey) => {
  const { data } = await db
    .from("notification_email_log")
    .select("status, error, provider_message_id")
    .eq("tenant_id", k.tenant_id)
    .eq("event", k.event)
    .eq("entity_id", k.entity_id)
    .eq("recipient_email", k.recipient_email)
    .maybeSingle();
  return data as { status: string; error: string | null; provider_message_id: string | null } | null;
};
const newEntity = () => {
  const id = randomUUID();
  entityIds.push(id);
  return id;
};

beforeAll(async () => {
  try {
    const { data: t, error } = await db.from("tenants").select("id").limit(1).single();
    if (error || !t) return;
    tenantId = t.id;
    // Probe the ledger table itself: absent until migration 281 is applied (CI replays it).
    const { error: tableErr } = await db.from("notification_email_log").select("id").limit(1);
    if (tableErr) return;
    available = true;
  } catch {
    // Local Supabase stack not running.
  }
}, 5000);

beforeAll(() => requireLocalDbInCi(available, "notification email ledger"));

afterAll(async () => {
  if (!available) return;
  await db.from("notification_email_log").delete().eq("event", EVENT);
});

describe("notification_email_log — exactly-once ledger (real Postgres)", () => {
  it("the first claim wins and the SECOND claim for the same (event, entity, recipient) is a duplicate", async (ctx) => {
    if (!available) return ctx.skip();
    const k = keyFor(newEntity(), "boss@example.test");
    expect(await claimLedgerRow(db, k)).toBe("claimed");
    expect(await claimLedgerRow(db, k)).toBe("duplicate");
    expect((await rowFor(k))?.status).toBe("pending");
  });

  it("concurrent claims for the same slot: exactly ONE wins", async (ctx) => {
    if (!available) return ctx.skip();
    const k = keyFor(newEntity(), "race@example.test");
    const results = await Promise.all(Array.from({ length: 6 }, () => claimLedgerRow(db, k)));
    expect(results.filter((r) => r === "claimed")).toHaveLength(1);
    expect(results.filter((r) => r === "duplicate")).toHaveLength(5);
  });

  it("a different recipient, or a different lead, is a separate alert", async (ctx) => {
    if (!available) return ctx.skip();
    const entity = newEntity();
    expect(await claimLedgerRow(db, keyFor(entity, "a@example.test"))).toBe("claimed");
    expect(await claimLedgerRow(db, keyFor(entity, "b@example.test"))).toBe("claimed");
    expect(await claimLedgerRow(db, keyFor(newEntity(), "a@example.test"))).toBe("claimed");
  });

  it("settle() moves the claimed row to sent (with the provider id) or failed (with the reason)", async (ctx) => {
    if (!available) return ctx.skip();
    const sent = keyFor(newEntity(), "ok@example.test");
    await claimLedgerRow(db, sent);
    await settleLedgerRow(db, sent, { status: "sent", provider_message_id: "msg-123" });
    expect(await rowFor(sent)).toMatchObject({ status: "sent", provider_message_id: "msg-123" });

    const failed = keyFor(newEntity(), "bad@example.test");
    await claimLedgerRow(db, failed);
    await settleLedgerRow(db, failed, { status: "failed", error: "mailbox full" });
    expect(await rowFor(failed)).toMatchObject({ status: "failed", error: "mailbox full" });
  });

  it("the status CHECK rejects an invalid value", async (ctx) => {
    if (!available) return ctx.skip();
    const k = keyFor(newEntity(), "check@example.test");
    const { error } = await db.from("notification_email_log").insert({ ...k, status: "bogus" });
    expect(error).not.toBeNull();
  });
});
