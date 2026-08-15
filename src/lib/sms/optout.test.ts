import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { generateOptOutToken, optOutUrl } from "./optout";

// Token-format/composition tests run everywhere (no DB). The
// getOrCreateOptOutToken concurrency test hits the real local Postgres, same
// precedent as credits-idempotency.test.ts: skips cleanly, not a failure,
// when the local Supabase stack (127.0.0.1) isn't up. CI's Test job has no
// database; stage/prod don't have migration 204 applied yet (HELD).

const API_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

let localDbAvailable = false;
let tenantId: string;

const db = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Minimal ScopedClient-shaped wrapper over the direct local connection above —
// the app's scopedClientForTenant() goes through createServiceClient(), which
// reads NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY from the process
// env; those aren't loaded when running `vitest` directly (no .env.local in a
// fresh worktree), so it throws "supabaseUrl is required" here. This mirrors
// just enough of scoped.ts's from() to exercise the real getOrCreateOptOutToken
// code path against the real local Postgres.
function localScopedClient(tenantId: string) {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          return db.from(table).select(columns).eq("tenant_id", tenantId);
        },
        upsert(rows: Record<string, unknown>, options: { onConflict: string; ignoreDuplicates?: boolean }) {
          const withTenant = { ...rows, tenant_id: tenantId };
          return db.from(table).upsert(withTenant, options);
        },
      };
    },
  } as unknown as import("@/lib/supabase/scoped").ScopedClient;
}

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

describe("generateOptOutToken", () => {
  it("is 10 characters, base62, and varies between calls", () => {
    const a = generateOptOutToken();
    const b = generateOptOutToken();
    expect(a).toHaveLength(10);
    expect(a).toMatch(/^[0-9A-Za-z]{10}$/);
    expect(a).not.toBe(b);
  });
});

describe("optOutUrl", () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("prefers SMS_OPTOUT_BASE_URL over NEXT_PUBLIC_APP_URL", () => {
    process.env.SMS_OPTOUT_BASE_URL = "https://edgex.zunkireelabs.com";
    process.env.NEXT_PUBLIC_APP_URL = "https://should-not-be-used.example.com";
    expect(optOutUrl("aB3dEf9k1x")).toBe("https://edgex.zunkireelabs.com/u/aB3dEf9k1x");
  });

  it("falls back to NEXT_PUBLIC_APP_URL when SMS_OPTOUT_BASE_URL is unset", () => {
    delete process.env.SMS_OPTOUT_BASE_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    expect(optOutUrl("aB3dEf9k1x")).toBe("https://app.example.com/u/aB3dEf9k1x");
  });

  it("strips a trailing slash from the base URL", () => {
    process.env.SMS_OPTOUT_BASE_URL = "https://edgex.zunkireelabs.com/";
    expect(optOutUrl("aB3dEf9k1x")).toBe("https://edgex.zunkireelabs.com/u/aB3dEf9k1x");
  });
});

describe("getOrCreateOptOutToken — race safety", () => {
  it("concurrent calls for the same (tenant, phone) return the same token", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }

    const { getOrCreateOptOutToken } = await import("./optout");
    const scoped = localScopedClient(tenantId);

    const phone = `+9779800${Math.floor(Math.random() * 900000 + 100000)}`;

    const [t1, t2, t3] = await Promise.all([
      getOrCreateOptOutToken(scoped, tenantId, phone, null),
      getOrCreateOptOutToken(scoped, tenantId, phone, null),
      getOrCreateOptOutToken(scoped, tenantId, phone, null),
    ]);

    expect(t1).toBe(t2);
    expect(t2).toBe(t3);

    const { count } = await db
      .from("sms_optout_tokens")
      .select("token", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("phone_e164", phone);
    expect(count).toBe(1);
  });

  it("is reusable after being marked used — used_at is a record, not a gate", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }

    const { getOrCreateOptOutToken } = await import("./optout");
    const scoped = localScopedClient(tenantId);

    const phone = `+9779800${Math.floor(Math.random() * 900000 + 100000)}`;
    const first = await getOrCreateOptOutToken(scoped, tenantId, phone, null);

    await db.from("sms_optout_tokens").update({ used_at: new Date().toISOString() }).eq("token", first);

    const second = await getOrCreateOptOutToken(scoped, tenantId, phone, null);
    expect(second).toBe(first);
  });
});
