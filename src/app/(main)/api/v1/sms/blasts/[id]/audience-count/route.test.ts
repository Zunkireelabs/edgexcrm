import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// SMS-PHASE4-FIX-F12-BRIEF.md — /audience-count is a lightweight sibling of
// /preview that answers "how many leads match this filter" WITHOUT requiring
// a message body. The whole point of the fix is that a request with no
// `body` field (unlike /preview, which hard-rejects that) still resolves.

const requireSmsAccessMock = vi.fn();
const resolveAudienceMock = vi.fn();

vi.mock("@/lib/sms/api-guard", () => ({ requireSmsAccess: requireSmsAccessMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn().mockResolvedValue({}), createServiceClient: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/sms/audience", () => ({ resolveAudience: resolveAudienceMock }));

const AUTH = { userId: "user-1", tenantId: "tenant-1", role: "owner" } as unknown as AuthContext;
const params = Promise.resolve({ id: "blast-1" });

function fakeReq(body?: unknown): NextRequest {
  return {
    json: () => (body === undefined ? Promise.reject(new Error("no body")) : Promise.resolve(body)),
  } as unknown as NextRequest;
}

function fakeDb(blastOverrides: Record<string, unknown> = {}) {
  const blastRow = { id: "blast-1", audience_filter: null, ...blastOverrides };
  return {
    from(table: string) {
      if (table === "sms_blasts") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { ...blastRow }, error: null }) }) }) };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function audienceOk(matched: number, sendableCount: number) {
  return {
    ok: true as const,
    audience: {
      matched,
      sendable: Array.from({ length: sendableCount }, (_, i) => ({
        leadId: `${i}`,
        phone: "9800000000",
        phoneE164: "+9779800000000",
        lead: { first_name: `First${i}`, last_name: `Last${i}` },
      })),
      suppressed: [],
      excluded: { noPhone: 0, foreignNumber: 0, malformed: 0, suppressed: 0, duplicatePhone: 0 },
    },
  };
}

describe("POST /api/v1/sms/blasts/[id]/audience-count", () => {
  beforeEach(() => {
    requireSmsAccessMock.mockReset();
    resolveAudienceMock.mockReset();
  });

  it("resolves matched/sendable counts with NO body field required in the request — unlike /preview", async () => {
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fakeDb() });
    resolveAudienceMock.mockResolvedValue(audienceOk(12, 10));
    const { POST } = await import("./route");

    // No `body` field at all in the request payload — /preview would 422 on this.
    const res = await POST(fakeReq({ audience_filter: undefined }), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ matched: 12, sendable: 10 });
    expect(json.data.sampleNames).toEqual(["First0 Last0", "First1 Last1", "First2 Last2"]);
  });

  it("resolves with an empty/absent request body too — audience resolution needs only the filter", async () => {
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fakeDb() });
    resolveAudienceMock.mockResolvedValue(audienceOk(3, 3));
    const { POST } = await import("./route");

    const res = await POST(fakeReq(undefined), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ matched: 3, sendable: 3 });
  });

  it("zero-match filter returns matched: 0 without erroring", async () => {
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fakeDb() });
    resolveAudienceMock.mockResolvedValue(audienceOk(0, 0));
    const { POST } = await import("./route");

    const res = await POST(fakeReq({}), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ matched: 0, sendable: 0 });
    expect(json.data.sampleNames).toEqual([]);
  });

  it("caps sampleNames at 3 even when more leads are sendable", async () => {
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fakeDb() });
    resolveAudienceMock.mockResolvedValue(audienceOk(261, 250));
    const { POST } = await import("./route");

    const res = await POST(fakeReq({}), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.sampleNames).toHaveLength(3);
  });

  it("falls back to 'Unnamed lead' when a sendable lead has no name", async () => {
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fakeDb() });
    resolveAudienceMock.mockResolvedValue({
      ok: true as const,
      audience: {
        matched: 1,
        sendable: [{ leadId: "0", phone: "9800000000", phoneE164: "+9779800000000", lead: {} }],
        suppressed: [],
        excluded: { noPhone: 0, foreignNumber: 0, malformed: 0, suppressed: 0, duplicatePhone: 0 },
      },
    });
    const { POST } = await import("./route");

    const res = await POST(fakeReq({}), { params });
    const json = await res.json();

    expect(json.data.sampleNames).toEqual(["Unnamed lead"]);
  });

  it("an invalid audience_filter override is rejected with a validation error", async () => {
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fakeDb() });
    const { POST } = await import("./route");

    const res = await POST(fakeReq({ audience_filter: { not: "a valid tree" } }), { params });

    expect(res.status).toBe(422);
    expect(resolveAudienceMock).not.toHaveBeenCalled();
  });

  it("404s when the blast doesn't exist for this tenant", async () => {
    requireSmsAccessMock.mockResolvedValue({
      ok: true,
      auth: AUTH,
      db: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) },
    });
    const { POST } = await import("./route");

    const res = await POST(fakeReq({}), { params });
    expect(res.status).toBe(404);
    expect(resolveAudienceMock).not.toHaveBeenCalled();
  });

  it("propagates the SMS access guard's rejection unchanged", async () => {
    const forbidden = new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "nope" } }), { status: 403 });
    requireSmsAccessMock.mockResolvedValue({ ok: false, response: forbidden });
    const { POST } = await import("./route");

    const res = await POST(fakeReq({}), { params });
    expect(res.status).toBe(403);
    expect(resolveAudienceMock).not.toHaveBeenCalled();
  });
});
