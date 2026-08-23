import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// OUTREACH-PHASE1-BRIEF.md §8 items 2/3: idempotent materialization (a
// retried /send must produce exactly one email_messages row per lead) and
// suppressed materialization (a suppressed lead yields an auditable
// status='suppressed' row, not a silent drop). Mirrors the SMS precedent's
// send/route.test.ts pattern — mocked db, no real Supabase.

const requireEmailCampaignsAccessMock = vi.fn();
const resolveAudienceMock = vi.fn();
const inngestSendMock = vi.fn();

vi.mock("@/lib/email/outbound/api-guard", () => ({ requireEmailCampaignsAccess: requireEmailCampaignsAccessMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn().mockResolvedValue({}), createServiceClient: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/email/outbound/audience", () => ({ resolveAudience: resolveAudienceMock }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: inngestSendMock } }));

const AUTH = { userId: "user-1", tenantId: "tenant-1", role: "owner" } as unknown as AuthContext;
const params = Promise.resolve({ id: "blast-1" });

function fakeReq(): NextRequest {
  return {} as unknown as NextRequest;
}

function fakeDb(opts: { blastStatus?: string } = {}) {
  // key = `${source_id}:${lead_id}` — models the real DB's
  // uq_email_message_source_lead (source_id, lead_id) unique index.
  const messages = new Map<string, Record<string, unknown>>();
  let upsertCallCount = 0;
  const blastRow = {
    id: "blast-1",
    subject_template: "Hi {{first_name}}",
    body_template: "<p>Hi {{first_name}}</p>",
    from_name_override: null,
    audience_filter: null,
    status: opts.blastStatus ?? "draft",
  };

  const rawFrom = (table: string) => {
    if (table === "tenants") {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: "Test Tenant" }, error: null }) }) }) };
    }
    throw new Error(`unexpected raw() table: ${table}`);
  };

  const db = {
    raw: () => ({ from: rawFrom }),
    from(table: string) {
      if (table === "email_blasts") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { ...blastRow }, error: null }) }) }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              select: () => ({
                single: () => {
                  Object.assign(blastRow, patch);
                  return Promise.resolve({ data: { ...blastRow }, error: null });
                },
              }),
            }),
          }),
        };
      }
      if (table === "tenants") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: "Test Tenant" }, error: null }) }) }) };
      }
      if (table === "email_messages") {
        return {
          upsert: (rows: Record<string, unknown>[], options: { onConflict: string; ignoreDuplicates?: boolean }) => {
            upsertCallCount++;
            expect(options.onConflict).toBe("source_id,lead_id");
            for (const row of rows) {
              const key = `${row.source_id}:${row.lead_id}`;
              if (options.ignoreDuplicates && messages.has(key)) continue; // ON CONFLICT DO NOTHING
              messages.set(key, row);
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  return { db, messages, upsertCallCountGetter: () => upsertCallCount };
}

function audienceRow(leadId: string, email: string) {
  return { leadId, email, lead: { id: leadId, email, first_name: "Test" } };
}

describe("POST /api/v1/email-blasts/[id]/send", () => {
  beforeEach(() => {
    requireEmailCampaignsAccessMock.mockReset();
    resolveAudienceMock.mockReset();
    inngestSendMock.mockReset();
  });

  it("materializes exactly one row per lead, and a RETRIED /send call does not double-materialize", async () => {
    const fake = fakeDb();
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    resolveAudienceMock.mockResolvedValue({
      ok: true,
      audience: {
        matched: 2,
        sendable: [audienceRow("lead-1", "a@example.com"), audienceRow("lead-2", "b@example.com")],
        suppressed: [],
        excluded: { noEmail: 0, malformed: 0, suppressed: 0, duplicateEmail: 0 },
      },
    });

    const { POST } = await import("./route");

    await POST(fakeReq(), { params });
    expect(fake.messages.size).toBe(2);
    for (const row of fake.messages.values()) expect(row.status).toBe("queued");

    // Simulate a retry: blast is still 'draft' in this fake (the real flow
    // would have flipped it to 'queued', blocking a second /send — this test
    // isolates the materialization idempotency specifically).
    await POST(fakeReq(), { params });
    expect(fake.messages.size).toBe(2); // still exactly one row per lead — no duplicates
  });

  it("materializes a suppressed lead as status='suppressed', not a silent drop", async () => {
    const fake = fakeDb();
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    resolveAudienceMock.mockResolvedValue({
      ok: true,
      audience: {
        matched: 2,
        sendable: [audienceRow("lead-1", "a@example.com")],
        suppressed: [audienceRow("lead-2", "optedout@example.com")],
        excluded: { noEmail: 0, malformed: 0, suppressed: 1, duplicateEmail: 0 },
      },
    });

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });
    const body = (await res.json()) as { data: { suppressed: number } };

    expect(fake.messages.size).toBe(2);
    const suppressedRow = [...fake.messages.values()].find((r) => r.lead_id === "lead-2");
    expect(suppressedRow?.status).toBe("suppressed");
    expect(body.data.suppressed).toBe(1);
  });

  it("rejects sending a non-draft blast", async () => {
    const fake = fakeDb({ blastStatus: "queued" });
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });
    expect(res.status).toBe(409);
    expect(inngestSendMock).not.toHaveBeenCalled();
  });
});
