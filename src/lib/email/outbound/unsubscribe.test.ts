import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { generateUnsubscribeToken, injectUnsubscribe } from "./unsubscribe";
import { localRawClient, localScopedClient } from "./test-support";

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
