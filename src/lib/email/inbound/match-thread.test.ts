import { describe, it, expect, vi } from "vitest";
import { matchInboundToThread } from "./match-thread";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSupabase(config: { emails?: any[]; threads?: any[] }) {
  const emails = config.emails ?? [];
  const threads = config.threads ?? [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function chain(rows: any[]) {
    const filters: Record<string, unknown> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = {};
    c.select = vi.fn(() => c);
    c.eq = vi.fn((col: string, val: unknown) => {
      filters[col] = val;
      return c;
    });
    c.maybeSingle = vi.fn(async () => {
      const match = rows.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
      return { data: match ?? null, error: null };
    });
    return c;
  }

  return {
    from: vi.fn((table: string) => {
      if (table === "emails") return chain(emails);
      if (table === "email_threads") return chain(threads);
      throw new Error(`unexpected table ${table}`);
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("matchInboundToThread", () => {
  it("matches on the primary (accountId, gmailThreadId) path when both are supplied", async () => {
    const supabase = makeSupabase({
      threads: [
        { id: "t1", tenant_id: "tenant-a", connected_email_account_id: "acct-1", gmail_thread_id: "gm-1", message_count: 2, lead_id: null, contact_id: null },
      ],
    });

    const result = await matchInboundToThread(supabase, {
      tenantId: "tenant-a",
      accountId: "acct-1",
      gmailThreadId: "gm-1",
    });

    expect(result?.id).toBe("t1");
  });

  it("does NOT use the primary path when accountId/gmailThreadId are absent (Resend-inbound lane)", async () => {
    const supabase = makeSupabase({
      threads: [
        { id: "t1", tenant_id: "tenant-a", connected_email_account_id: null, gmail_thread_id: null, message_count: 2, lead_id: null, contact_id: null },
      ],
    });

    const result = await matchInboundToThread(supabase, { tenantId: "tenant-a" });
    expect(result).toBeNull();
  });

  it("falls back to In-Reply-To when the primary match misses", async () => {
    const supabase = makeSupabase({
      emails: [{ tenant_id: "tenant-a", rfc_message_id: "<msg-1@x>", thread_id: "t2" }],
      threads: [{ id: "t2", tenant_id: "tenant-a", connected_email_account_id: null, gmail_thread_id: null, message_count: 1, lead_id: "lead-9", contact_id: null }],
    });

    const result = await matchInboundToThread(supabase, {
      tenantId: "tenant-a",
      inReplyTo: "<msg-1@x>",
    });

    expect(result?.id).toBe("t2");
    expect(result?.lead_id).toBe("lead-9");
  });

  it("falls back to the References chain, most specific (last) entry first", async () => {
    const supabase = makeSupabase({
      emails: [
        { tenant_id: "tenant-a", rfc_message_id: "<ref-older@x>", thread_id: "t-older" },
        { tenant_id: "tenant-a", rfc_message_id: "<ref-newer@x>", thread_id: "t-newer" },
      ],
      threads: [
        { id: "t-older", tenant_id: "tenant-a", connected_email_account_id: null, gmail_thread_id: null, message_count: 1, lead_id: null, contact_id: null },
        { id: "t-newer", tenant_id: "tenant-a", connected_email_account_id: null, gmail_thread_id: null, message_count: 1, lead_id: null, contact_id: null },
      ],
    });

    // references[] is chronological oldest->newest; matcher reverses so the
    // most specific (last / newest) reference is tried first.
    const result = await matchInboundToThread(supabase, {
      tenantId: "tenant-a",
      references: ["<ref-older@x>", "<ref-newer@x>"],
    });

    expect(result?.id).toBe("t-newer");
  });

  it("CROSS-TENANT NEGATIVE: an In-Reply-To that matches another tenant's rfc_message_id never resolves", async () => {
    const supabase = makeSupabase({
      emails: [{ tenant_id: "tenant-VICTIM", rfc_message_id: "<shared-id@x>", thread_id: "victim-thread" }],
      threads: [{ id: "victim-thread", tenant_id: "tenant-VICTIM", connected_email_account_id: null, gmail_thread_id: null, message_count: 1, lead_id: null, contact_id: null }],
    });

    const result = await matchInboundToThread(supabase, {
      tenantId: "tenant-ATTACKER",
      inReplyTo: "<shared-id@x>",
    });

    expect(result).toBeNull();
  });

  it("CROSS-TENANT NEGATIVE: same invariant holds for the References fallback", async () => {
    const supabase = makeSupabase({
      emails: [{ tenant_id: "tenant-VICTIM", rfc_message_id: "<shared-ref@x>", thread_id: "victim-thread" }],
      threads: [{ id: "victim-thread", tenant_id: "tenant-VICTIM", connected_email_account_id: null, gmail_thread_id: null, message_count: 1, lead_id: null, contact_id: null }],
    });

    const result = await matchInboundToThread(supabase, {
      tenantId: "tenant-ATTACKER",
      references: ["<shared-ref@x>"],
    });

    expect(result).toBeNull();
  });

  it("CROSS-TENANT NEGATIVE: primary (accountId, gmailThreadId) match is also tenant-filtered", async () => {
    const supabase = makeSupabase({
      threads: [
        { id: "victim-thread", tenant_id: "tenant-VICTIM", connected_email_account_id: "shared-acct-id", gmail_thread_id: "gm-shared", message_count: 1, lead_id: null, contact_id: null },
      ],
    });

    const result = await matchInboundToThread(supabase, {
      tenantId: "tenant-ATTACKER",
      accountId: "shared-acct-id",
      gmailThreadId: "gm-shared",
    });

    expect(result).toBeNull();
  });

  it("returns null when nothing matches at all", async () => {
    const supabase = makeSupabase({});
    const result = await matchInboundToThread(supabase, { tenantId: "tenant-a", inReplyTo: "<nope@x>" });
    expect(result).toBeNull();
  });

  it("defense-in-depth: an emails row found in-tenant but whose thread_id points to a different tenant's thread never resolves", async () => {
    // Pathological/corrupt-data case: emails row itself is tenant-a-scoped (passes the
    // tenant filter on the emails query) but its thread_id happens to reference a
    // thread row belonging to a different tenant. The second query's own tenant_id
    // filter must still catch this.
    const supabase = makeSupabase({
      emails: [{ tenant_id: "tenant-a", rfc_message_id: "<msg@x>", thread_id: "other-tenant-thread" }],
      threads: [{ id: "other-tenant-thread", tenant_id: "tenant-b", connected_email_account_id: null, gmail_thread_id: null, message_count: 1, lead_id: null, contact_id: null }],
    });

    const result = await matchInboundToThread(supabase, { tenantId: "tenant-a", inReplyTo: "<msg@x>" });
    expect(result).toBeNull();
  });
});
