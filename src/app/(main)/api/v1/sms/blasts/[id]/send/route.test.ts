import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// SMS-PHASE3A-FIXES-BRIEF.md F-3 — the highest-value gaps named in the
// original report: the app-layer idempotency check (replacing the ON
// CONFLICT upsert that 42P10'd against a partial index) had NO test at all,
// reserve-failure-blocks-the-event, and max_recipients_per_blast rejecting
// rather than truncating.

const requireSmsAccessMock = vi.fn();
const resolveAudienceMock = vi.fn();
const loadTenantSmsSettingsMock = vi.fn();
const composeRecipientMessageMock = vi.fn();
const inngestSendMock = vi.fn();

vi.mock("@/lib/sms/api-guard", () => ({ requireSmsAccess: requireSmsAccessMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn().mockResolvedValue({}), createServiceClient: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/sms/audience", () => ({ resolveAudience: resolveAudienceMock }));
vi.mock("@/lib/sms/settings", () => ({ loadTenantSmsSettings: loadTenantSmsSettingsMock }));
vi.mock("@/lib/sms/compose", () => ({ composeRecipientMessage: composeRecipientMessageMock }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: inngestSendMock } }));

const AUTH = { userId: "user-1", tenantId: "tenant-1", role: "owner" } as unknown as AuthContext;
const params = Promise.resolve({ id: "blast-1" });

function fakeReq(): NextRequest {
  return {} as unknown as NextRequest;
}

interface ReserveResult {
  ok: boolean;
  balance?: number;
  reserved?: number;
  shortfall?: number;
}

function fakeDb(opts: { blastStatus?: string; maxRecipients?: number; body?: string } = {}) {
  const messages: Record<string, unknown>[] = [];
  let insertCallCount = 0;
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  let reserveResult: ReserveResult = { ok: true, balance: 1000, reserved: 0 };
  const blastRow = { id: "blast-1", body: opts.body ?? "Hi {{first_name}}", audience_filter: null, status: opts.blastStatus ?? "draft" };

  const db = {
    from(table: string) {
      if (table === "sms_blasts") {
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
      if (table === "sms_messages") {
        return {
          select: (cols: string) => {
            if (cols === "lead_id") {
              return { eq: () => Promise.resolve({ data: messages.map((m) => ({ lead_id: m.lead_id })), error: null }) };
            }
            return {
              eq: () => ({
                eq: () =>
                  Promise.resolve({
                    data: messages
                      .filter((m) => m.status === "queued")
                      .map((m) => ({ estimated_credits: m.estimated_credits })),
                    error: null,
                  }),
              }),
            };
          },
          insert: (rows: Record<string, unknown>[]) => {
            insertCallCount++;
            messages.push(...rows);
            return Promise.resolve({ data: rows, error: null });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: { ...reserveResult }, error: null });
    },
  };

  return {
    db,
    messages,
    insertCallCount: () => insertCallCount,
    rpcCalls,
    setReserveResult: (r: ReserveResult) => {
      reserveResult = r;
    },
    blastRow,
  };
}

function sendableRow(leadId: string) {
  return { leadId, phone: `98000000${leadId}`, phoneE164: `+97798000000${leadId}`, lead: { id: leadId, phone: `+97798000000${leadId}` } };
}

describe("POST /api/v1/sms/blasts/[id]/send", () => {
  beforeEach(() => {
    requireSmsAccessMock.mockReset();
    resolveAudienceMock.mockReset();
    loadTenantSmsSettingsMock.mockReset().mockResolvedValue({
      sender_label: null,
      optout_footer: null,
      timezone: null,
      quiet_hours_start: 8,
      quiet_hours_end: 20,
      quiet_hours_enabled: true,
      max_recipients_per_blast: 500,
      low_credit_threshold: 200,
    });
    composeRecipientMessageMock.mockReset().mockImplementation(async (_db, _tenantId, _settings, _body, row) => ({
      text: `rendered for ${row.leadId}`,
      segments: { encoding: "gsm7", chars: 20, segments: 1, credits: 1, charsRemaining: 140 },
    }));
    inngestSendMock.mockReset().mockResolvedValue(undefined);
  });

  it("a re-POST is idempotent — no duplicate sms_messages rows, and reserve stays a safe no-op", async () => {
    const fake = fakeDb();
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    resolveAudienceMock.mockResolvedValue({
      ok: true,
      audience: { matched: 2, sendable: [sendableRow("1"), sendableRow("2")], suppressed: [], excluded: { noPhone: 0, foreignNumber: 0, malformed: 0, suppressed: 0, duplicatePhone: 0 } },
    });
    const { POST } = await import("./route");

    const first = await POST(fakeReq(), { params });
    expect(first.status).toBe(200);
    expect(fake.insertCallCount()).toBe(1);
    expect(fake.messages).toHaveLength(2);

    // Second call sees the SAME two leads already materialized — must not
    // insert them again. (In real usage the blast's status flip to 'queued'
    // would itself gate a retry via the draft-only check; this test isolates
    // the materialization idempotency contract specifically — the mechanism
    // that changed from a DB upsert to this app-layer check.)
    fake.blastRow.status = "draft";
    const second = await POST(fakeReq(), { params });
    expect(second.status).toBe(200);
    expect(fake.insertCallCount()).toBe(1); // no second insert call — nothing new to materialize
    expect(fake.messages).toHaveLength(2); // still exactly 2 rows, not 4

    // reserve was called twice (once per POST) but the RPC itself is
    // idempotent by ref_id on the real DB — both calls used the same amount.
    expect(fake.rpcCalls).toHaveLength(2);
    expect(fake.rpcCalls[0].args.p_ref_id).toBe(fake.rpcCalls[1].args.p_ref_id);
  });

  it("a reserve failure blocks the send — returns the shortfall and emits NO Inngest event", async () => {
    const fake = fakeDb();
    fake.setReserveResult({ ok: false, balance: 3, shortfall: 7 });
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    resolveAudienceMock.mockResolvedValue({
      ok: true,
      audience: { matched: 1, sendable: [sendableRow("1")], suppressed: [], excluded: { noPhone: 0, foreignNumber: 0, malformed: 0, suppressed: 0, duplicatePhone: 0 } },
    });
    const { POST } = await import("./route");

    const res = await POST(fakeReq(), { params });
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("INSUFFICIENT_CREDITS");
    expect(json.error.details).toMatchObject({ shortfall: 7, balance: 3 });
    expect(inngestSendMock).not.toHaveBeenCalled();
    // Rows were still materialized (order is fixed: materialize -> cap -> reserve).
    expect(fake.messages).toHaveLength(1);
  });

  it("max_recipients_per_blast REJECTS rather than truncates — no reserve, no Inngest event", async () => {
    const fake = fakeDb();
    loadTenantSmsSettingsMock.mockResolvedValue({
      sender_label: null,
      optout_footer: null,
      timezone: null,
      quiet_hours_start: 8,
      quiet_hours_end: 20,
      quiet_hours_enabled: true,
      max_recipients_per_blast: 1,
      low_credit_threshold: 200,
    });
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    resolveAudienceMock.mockResolvedValue({
      ok: true,
      audience: { matched: 2, sendable: [sendableRow("1"), sendableRow("2")], suppressed: [], excluded: { noPhone: 0, foreignNumber: 0, malformed: 0, suppressed: 0, duplicatePhone: 0 } },
    });
    const { POST } = await import("./route");

    const res = await POST(fakeReq(), { params });
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("MAX_RECIPIENTS_EXCEEDED");
    expect(json.error.details).toMatchObject({ count: 2, max: 1 });
    // Not truncated: both rows were materialized, not just 1.
    expect(fake.messages).toHaveLength(2);
    // Cap check happens BEFORE reserve — no RPC call, no event.
    expect(fake.rpcCalls).toHaveLength(0);
    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only body — 3B's ' ' draft placeholder must never be sendable", async () => {
    const fake = fakeDb({ body: "   " });
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    const { POST } = await import("./route");

    const res = await POST(fakeReq(), { params });
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(resolveAudienceMock).not.toHaveBeenCalled();
    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it("a non-draft blast is rejected before any audience re-resolution", async () => {
    const fake = fakeDb({ blastStatus: "queued" });
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    const { POST } = await import("./route");

    const res = await POST(fakeReq(), { params });

    expect(res.status).toBe(409);
    expect(resolveAudienceMock).not.toHaveBeenCalled();
  });
});
