import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// EDGEX-154: the list response carries the tenant's per-file cap so the upload dialog can say "up to N MB each".
const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();
const assertLeadVisibleMock = vi.fn();
const loadMaxMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/documents/access", () => ({ assertLeadVisible: assertLeadVisibleMock }));
vi.mock("@/lib/documents/settings", () => ({ loadMaxDocumentSizeBytes: loadMaxMock }));

const AUTH = { userId: "u1", tenantId: "t1", industryId: "education_consultancy" } as unknown as AuthContext;
function fakeDb() {
  const query = { eq: vi.fn(() => query), is: vi.fn(() => query), order: vi.fn(() => Promise.resolve({ data: [], error: null })) };
  return { from: vi.fn(() => ({ select: vi.fn(() => query) })) };
}
const call = async () => {
  const { GET } = await import("./route");
  return (await GET({} as unknown as NextRequest, { params: Promise.resolve({ id: "lead-1" }) })).json();
};

beforeEach(() => {
  authenticateRequestMock.mockResolvedValue(AUTH);
  scopedClientMock.mockResolvedValue(fakeDb());
  assertLeadVisibleMock.mockResolvedValue({ id: "lead-1" });
  loadMaxMock.mockReset();
});

describe("GET /api/v1/leads/[id]/documents — max_file_bytes", () => {
  it("returns the tenant's cap (read from the existing setting)", async () => {
    loadMaxMock.mockResolvedValue(10 * 1024 * 1024);
    expect((await call()).data.max_file_bytes).toBe(10 * 1024 * 1024);
  });
  it("a failed settings read never fails the list: the cap is null (the dialog then omits the hint)", async () => {
    loadMaxMock.mockRejectedValue(new Error("boom"));
    const json = await call();
    expect(json.data.max_file_bytes).toBeNull();
    expect(json.data.documents).toEqual([]);
  });
});
