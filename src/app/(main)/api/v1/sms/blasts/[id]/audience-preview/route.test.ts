import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// SMS-PHASE4-PHASE3-BRIEF.md Piece B — /audience-preview is an on-demand,
// paginated slice of resolveAudience()'s in-memory sendable array. Same
// guard/resolve setup as /audience-count; the new surface is the pagination
// math and the Name/Phone/Source row shape.

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

function audienceOkWithRows(sendableCount: number) {
  return {
    ok: true as const,
    audience: {
      matched: sendableCount,
      sendable: Array.from({ length: sendableCount }, (_, i) => ({
        leadId: `${i}`,
        phone: "9800000000",
        phoneE164: `+97798000000${String(i).padStart(2, "0")}`,
        lead: { first_name: `First${i}`, last_name: `Last${i}`, intake_source: "Facebook Ad" },
      })),
      suppressed: [],
      excluded: { noPhone: 0, foreignNumber: 0, malformed: 0, suppressed: 0, duplicatePhone: 0 },
    },
  };
}

describe("POST /api/v1/sms/blasts/[id]/audience-preview", () => {
  beforeEach(() => {
    requireSmsAccessMock.mockReset();
    resolveAudienceMock.mockReset();
  });

  it("returns page 1 with default pageSize 25 rows and the full total", async () => {
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fakeDb() });
    resolveAudienceMock.mockResolvedValue(audienceOkWithRows(30));
    const { POST } = await import("./route");

    const res = await POST(fakeReq({}), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.rows).toHaveLength(25);
    expect(json.data.page).toBe(1);
    expect(json.data.pageSize).toBe(25);
    expect(json.data.total).toBe(30);
    expect(json.data.rows[0]).toMatchObject({ name: "First0 Last0", phone: "+9779800000000", source: "Facebook Ad" });
  });

  it("returns the remaining rows on page 2 of a 30-row audience with pageSize 25", async () => {
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fakeDb() });
    resolveAudienceMock.mockResolvedValue(audienceOkWithRows(30));
    const { POST } = await import("./route");

    const res = await POST(fakeReq({ page: 2, pageSize: 25 }), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.rows).toHaveLength(5);
    expect(json.data.page).toBe(2);
    expect(json.data.total).toBe(30);
  });

  it("caps pageSize at 100 even when a larger value is requested", async () => {
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fakeDb() });
    resolveAudienceMock.mockResolvedValue(audienceOkWithRows(150));
    const { POST } = await import("./route");

    const res = await POST(fakeReq({ pageSize: 500 }), { params });
    const json = await res.json();

    expect(json.data.pageSize).toBe(100);
    expect(json.data.rows).toHaveLength(100);
  });

  it("empty-audience case returns rows: [] cleanly", async () => {
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fakeDb() });
    resolveAudienceMock.mockResolvedValue(audienceOkWithRows(0));
    const { POST } = await import("./route");

    const res = await POST(fakeReq({}), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ rows: [], total: 0 });
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
