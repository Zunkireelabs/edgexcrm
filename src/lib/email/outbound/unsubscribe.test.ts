import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { generateUnsubscribeToken, injectUnsubscribe } from "./unsubscribe";
import { localRawClient, localScopedClient } from "./test-support";
import { requireLocalDbInCi } from "@/lib/test-support/require-db-in-ci";

// Token-format/composition tests run everywhere (no DB). The
// getOrCreateUnsubscribeToken concurrency test hits the real local Postgres,
// same precedent as src/lib/sms/optout.test.ts: skips cleanly when the local
// stack isn't up.

const db = localRawClient();

let localDbAvailable = false;
let tenantId: string;

beforeAll(async () => {
  try {
    const { data, error } = await db.from("tenants").select("id").limit(1).single();
    if (error || !data) return;
    tenantId = data.id;
    localDbAvailable = true;
  } catch {
    // Local Supabase stack not running — DB-touching tests below skip.
  }
}, 5000);


// Skipping is correct locally (no `supabase start`); in CI it is a hard failure.
// See src/lib/test-support/require-db-in-ci.ts for why.
beforeAll(() => requireLocalDbInCi(localDbAvailable, "email outbound unsubscribe"));
describe("generateUnsubscribeToken", () => {
  it("is 10 characters, base62, and varies between calls", () => {
    const a = generateUnsubscribeToken();
    const b = generateUnsubscribeToken();
    expect(a).toHaveLength(10);
    expect(a).toMatch(/^[0-9A-Za-z]{10}$/);
    expect(a).not.toBe(b);
  });
});

describe("unsubscribeUrl", () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("builds a /e/u/<token> URL under APP_URL", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://edgex.zunkireelabs.com";
    // APP_URL is captured at module-init time in src/lib/email/index.ts, so
    // re-import both modules fresh under the env override.
    const mod = await import("./unsubscribe");
    expect(mod.unsubscribeUrl("aB3dEf9k1x")).toMatch(/\/e\/u\/aB3dEf9k1x$/);
  });
});

describe("injectUnsubscribe", () => {
  it("includes the unsubscribe link and org name, omits the address when unset", () => {
    const html = injectUnsubscribe("<p>Hi</p>", "https://example.com/e/u/abc123", {
      orgName: "Admizz Education",
      mailingAddress: null,
    });
    expect(html).toContain("<p>Hi</p>");
    expect(html).toContain('href="https://example.com/e/u/abc123"');
    expect(html).toContain("Admizz Education");
    expect(html).not.toContain("&middot;");
  });

  it("includes the mailing address when set, and escapes HTML in both fields", () => {
    const html = injectUnsubscribe("<p>Hi</p>", "https://example.com/e/u/abc123", {
      orgName: "A & B <Corp>",
      mailingAddress: "123 Main St, Kathmandu",
    });
    expect(html).toContain("A &amp; B &lt;Corp&gt;");
    expect(html).toContain("123 Main St, Kathmandu");
    expect(html).toContain("&middot;");
  });
});

describe("getOrCreateUnsubscribeToken — race safety", () => {
  it("concurrent calls for the same (tenant, email) return the same token", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }

    const { getOrCreateUnsubscribeToken } = await import("./unsubscribe");
    const scoped = localScopedClient(tenantId);

    const email = `race.${Math.floor(Math.random() * 900000 + 100000)}@example.com`;

    const [t1, t2, t3] = await Promise.all([
      getOrCreateUnsubscribeToken(scoped, tenantId, email, null),
      getOrCreateUnsubscribeToken(scoped, tenantId, email, null),
      getOrCreateUnsubscribeToken(scoped, tenantId, email, null),
    ]);

    expect(t1).toBe(t2);
    expect(t2).toBe(t3);

    const { count } = await db
      .from("email_unsubscribe_tokens")
      .select("token", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("email", email);
    expect(count).toBe(1);
  });

  it("is reusable after being marked used — used_at is a record, not a gate", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }

    const { getOrCreateUnsubscribeToken } = await import("./unsubscribe");
    const scoped = localScopedClient(tenantId);

    const email = `reuse.${Math.floor(Math.random() * 900000 + 100000)}@example.com`;
    const first = await getOrCreateUnsubscribeToken(scoped, tenantId, email, null);

    await db.from("email_unsubscribe_tokens").update({ used_at: new Date().toISOString() }).eq("token", first);

    const second = await getOrCreateUnsubscribeToken(scoped, tenantId, email, null);
    expect(second).toBe(first);
  });
});

// PROD INCIDENT (2026-09-24) — sendQueuedEmailBatch used to call
// getOrCreateUnsubscribeToken once per recipient inside its concurrency-5
// send loop: 6,000+ extra round trips on a 3,131-recipient blast, the exact
// shape SMS's ensureOptOutTokens (§F2) was already fixed for. Same coverage
// shape as src/lib/sms/optout.test.ts's "ensureOptOutTokens — bulk mint/read".
describe("ensureUnsubscribeTokens — bulk mint/read", () => {
  it("returns a stable token for an email that already has one", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }

    const { ensureUnsubscribeTokens } = await import("./unsubscribe");
    const scoped = localScopedClient(tenantId);
    const email = `bulk.${Math.floor(Math.random() * 900000 + 100000)}@example.com`;

    const first = await ensureUnsubscribeTokens(scoped, [{ email, leadId: null }]);
    const second = await ensureUnsubscribeTokens(scoped, [{ email, leadId: null }]);

    expect(first.get(email)).toBeTruthy();
    expect(second.get(email)).toBe(first.get(email));
  });

  it("resolves a duplicate email in one batch to a single row and token", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }

    const { ensureUnsubscribeTokens } = await import("./unsubscribe");
    const scoped = localScopedClient(tenantId);
    const email = `dup.${Math.floor(Math.random() * 900000 + 100000)}@example.com`;

    const result = await ensureUnsubscribeTokens(scoped, [
      { email, leadId: null },
      { email, leadId: null },
    ]);

    expect(result.size).toBe(1);
    expect(result.get(email)).toBeTruthy();

    const { count } = await db
      .from("email_unsubscribe_tokens")
      .select("token", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("email", email);
    expect(count).toBe(1);
  });

  it("resolves every email across >1,000 distinct emails (proves the pagination)", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }

    const { ensureUnsubscribeTokens } = await import("./unsubscribe");
    const scoped = localScopedClient(tenantId);
    const base = Math.floor(Math.random() * 900000 + 100000);
    const emails = Array.from({ length: 1200 }, (_, i) => `bulk.${base}.${i}@example.com`);

    const result = await ensureUnsubscribeTokens(
      scoped,
      emails.map((email) => ({ email, leadId: null }))
    );

    expect(result.size).toBe(emails.length);
    for (const email of emails) {
      expect(result.get(email)).toBeTruthy();
    }
  }, 30000);
});
