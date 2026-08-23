import { describe, it, expect, beforeAll } from "vitest";
import { localRawClient, localScopedClient } from "./test-support";

// DB-backed, same precedent as src/lib/sms/suppression.test.ts: skips cleanly
// when the local Supabase stack isn't up. CI's Test job has no database.

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
    // Local Supabase stack not running.
  }
}, 5000);

describe("loadSuppressedEmails / suppressEmail", () => {
  it("loadSuppressedEmails returns exactly the intersection of the batch and the suppression list, normalized", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }

    const { loadSuppressedEmails, suppressEmail } = await import("./suppression");
    const scoped = localScopedClient(tenantId);

    const suffix = Math.floor(Math.random() * 900000 + 100000);
    const suppressed = `Suppressed.${suffix}@Example.com`; // mixed case + spacing on purpose
    const notSuppressed = `notsuppressed.${suffix}@example.com`;
    const alsoNotInBatch = `alsonotinbatch.${suffix}@example.com`;

    await suppressEmail(scoped, tenantId, { email: suppressed, reason: "unsubscribe", source: "unsubscribe_link" });
    await suppressEmail(scoped, tenantId, { email: alsoNotInBatch, reason: "manual", source: "admin" });

    // Query with the un-normalized (mixed-case) form — the batch a caller
    // passes will usually come straight from leads.email, not pre-lowercased.
    const result = await loadSuppressedEmails(scoped, tenantId, [suppressed, notSuppressed]);

    expect(result.has(suppressed.trim().toLowerCase())).toBe(true);
    expect(result.has(notSuppressed)).toBe(false);
    expect(result.has(alsoNotInBatch)).toBe(false); // not in the batch, even though it IS suppressed
    expect(result.size).toBe(1);
  });

  it("loadSuppressedEmails issues one query per 250-chunk, not one per recipient", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }

    const { loadSuppressedEmails } = await import("./suppression");
    const rawScoped = localScopedClient(tenantId);

    let selectCalls = 0;
    const counting = {
      ...rawScoped,
      from(table: string) {
        const inner = rawScoped.from(table);
        return {
          ...inner,
          select: (...args: Parameters<typeof inner.select>) => {
            selectCalls += 1;
            return inner.select(...args);
          },
        };
      },
    };

    // 1,200 emails -> 5 chunks of 250, never 1,200 individual lookups.
    const emails = Array.from({ length: 1200 }, (_, i) => `bulk${i}@example.com`);
    await loadSuppressedEmails(counting as unknown as typeof rawScoped, tenantId, emails);

    expect(selectCalls).toBe(5);
  });

  it("suppressEmail is idempotent — a repeated suppress for the same email does not error or duplicate", async (ctx) => {
    if (!localDbAvailable) {
      ctx.skip();
      return;
    }

    const { suppressEmail } = await import("./suppression");
    const scoped = localScopedClient(tenantId);

    const email = `idempotent.${Math.floor(Math.random() * 900000 + 100000)}@example.com`;

    await suppressEmail(scoped, tenantId, { email, reason: "unsubscribe", source: "unsubscribe_link" });
    await suppressEmail(scoped, tenantId, { email, reason: "unsubscribe", source: "unsubscribe_link" });

    const { count } = await db
      .from("email_suppressions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("email", email);
    expect(count).toBe(1);
  });
});
