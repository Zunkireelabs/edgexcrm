import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { requireLocalDbInCi } from "@/lib/test-support/require-db-in-ci";

// DB-backed, same precedent as credits-idempotency.test.ts / optout.test.ts:
// skips cleanly when the local Supabase stack isn't up. CI's Test job has no
// database; stage/prod don't have migration 204 applied yet (HELD).

const API_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

let localDbAvailable = false;
let tenantId: string;

const db = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Minimal ScopedClient-shaped wrapper over the direct local connection above —
// see optout.test.ts for why this doesn't go through the app's
// scopedClientForTenant() (it needs env vars a fresh worktree doesn't have).
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
    // Local Supabase stack not running.
  }
}, 5000);


// Skipping is correct locally (no `supabase start`); in CI it is a hard failure.
// See src/lib/test-support/require-db-in-ci.ts for why.
beforeAll(() => requireLocalDbInCi(localDbAvailable, "sms suppression list"));
describe("loadSuppressedPhones / suppressPhone", () => {
  it("loadSuppressedPhones returns exactly the intersection of the batch and the suppression list", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }

    const { loadSuppressedPhones, suppressPhone } = await import("./suppression");
    const scoped = localScopedClient(tenantId);

    const suffix = Math.floor(Math.random() * 900000 + 100000);
    const suppressed = `+9779811${suffix}`;
    const notSuppressed = `+9779822${suffix}`;
    const alsoNotInBatch = `+9779833${suffix}`;

    await suppressPhone(scoped, tenantId, { phoneE164: suppressed, reason: "opt_out", source: "optout_link" });
    await suppressPhone(scoped, tenantId, { phoneE164: alsoNotInBatch, reason: "manual", source: "admin" });

    const result = await loadSuppressedPhones(scoped, tenantId, [suppressed, notSuppressed]);

    expect(result.has(suppressed)).toBe(true);
    expect(result.has(notSuppressed)).toBe(false);
    expect(result.has(alsoNotInBatch)).toBe(false); // not in the batch, even though it IS suppressed
    expect(result.size).toBe(1);
  });

  it("loadSuppressedPhones issues exactly one query for a batch under the chunk size, not one per recipient", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }

    const { loadSuppressedPhones } = await import("./suppression");
    const raw = localScopedClient(tenantId);

    let selectCalls = 0;
    const counting = {
      ...raw,
      from(table: string) {
        const inner = raw.from(table);
        return {
          ...inner,
          select: (...args: Parameters<typeof inner.select>) => {
            selectCalls += 1;
            return inner.select(...args);
          },
        };
      },
    };

    const phones = Array.from({ length: 50 }, (_, i) => `+9779800${String(i).padStart(6, "0")}`);
    await loadSuppressedPhones(counting as unknown as typeof raw, tenantId, phones);

    expect(selectCalls).toBe(1);
  });

  it("loadSuppressedPhones chunks a batch over the chunk size, and never 414s (URI too long)", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }

    // Reproduces a live bug found 2026-09-06 investigating "Failed to
    // materialize recipient rows": this function issued ONE unchunked
    // PostgREST `in` filter over the whole audience, which 414s ("URI too
    // long") between 400-450 bare +E.164 phone numbers against local
    // PostgREST — confirmed empirically, and a real Admizz SMS audience
    // (thousands of leads) exceeds that by a wide margin. Email's identical
    // twin (loadSuppressedEmails) already learned this lesson and chunks at
    // 150; this was never mirrored here despite this file's own header
    // calling them "direct analogues" of each other.
    const { loadSuppressedPhones } = await import("./suppression");
    const raw = localScopedClient(tenantId);

    let selectCalls = 0;
    const counting = {
      ...raw,
      from(table: string) {
        const inner = raw.from(table);
        return {
          ...inner,
          select: (...args: Parameters<typeof inner.select>) => {
            selectCalls += 1;
            return inner.select(...args);
          },
        };
      },
    };

    // 700 phones -> 3 chunks of 300 (300 + 300 + 100), never one 700-phone request.
    const phones = Array.from({ length: 700 }, (_, i) => `+97798${String(10000000 + i).padStart(8, "0")}`);
    const result = await loadSuppressedPhones(counting as unknown as typeof raw, tenantId, phones);

    expect(selectCalls).toBe(3);
    expect(result.size).toBe(0); // none of these synthetic phones are actually suppressed
  });

  it("suppressPhone is idempotent — a repeated suppress for the same phone does not error or duplicate", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }

    const { suppressPhone } = await import("./suppression");
    const scoped = localScopedClient(tenantId);

    const phone = `+9779844${Math.floor(Math.random() * 900000 + 100000)}`;

    await suppressPhone(scoped, tenantId, { phoneE164: phone, reason: "opt_out", source: "optout_link" });
    await suppressPhone(scoped, tenantId, { phoneE164: phone, reason: "opt_out", source: "optout_link" });

    const { count } = await db
      .from("sms_suppressions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("phone_e164", phone);
    expect(count).toBe(1);
  });
});
