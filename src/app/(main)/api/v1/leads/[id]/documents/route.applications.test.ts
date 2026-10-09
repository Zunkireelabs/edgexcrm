// The student's Documents list also returns the names of the university applications its files are linked to,
// so the Documents section can group them under "University – Programme".
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const scopedClientMock = vi.fn();
const assertLeadVisibleMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/documents/access", () => ({ assertLeadVisible: assertLeadVisibleMock }));

const AUTH = { userId: "u1", tenantId: "t1", industryId: "education_consultancy" } as unknown as AuthContext;
const req = () => ({}) as unknown as NextRequest;
const params = () => ({ params: Promise.resolve({ id: "lead-1" }) });

function fakeDb(documents: Record<string, unknown>[], apps: Record<string, unknown>[] | "fail" = []) {
  const docQuery = { eq: vi.fn(() => docQuery), is: vi.fn(() => docQuery), order: vi.fn(async () => ({ data: documents, error: null })) };
  const appQuery = { in: vi.fn(async () => (apps === "fail" ? { data: null, error: { message: "x" } } : { data: apps, error: null })) };
  const from = vi.fn((t: string) => ({ select: vi.fn(() => (t === "applications" ? appQuery : docQuery)) }));
  return { db: { from }, from, appQuery };
}

beforeEach(() => {
  for (const m of [authenticateRequestMock, getFeatureAccessMock, scopedClientMock, assertLeadVisibleMock]) m.mockReset();
  authenticateRequestMock.mockResolvedValue(AUTH);
  getFeatureAccessMock.mockReturnValue(true);
  assertLeadVisibleMock.mockResolvedValue({ id: "lead-1" });
});

describe("GET /api/v1/leads/[id]/documents — application names", () => {
  it("returns the university and programme for each linked application, looked up once", async () => {
    const f = fakeDb(
      [
        { id: "d1", document_type: "conditional_offer", application_id: "app-1" },
        { id: "d2", document_type: "unconditional_offer", application_id: "app-1" },
        { id: "d3", document_type: "passport", application_id: null },
      ],
      [{ id: "app-1", university_name: "Arden University", program_name: "MSc Project Management" }],
    );
    scopedClientMock.mockResolvedValue(f.db);
    const { GET } = await import("./route");
    const json = await (await GET(req(), params())).json();
    expect(json.data.applications).toEqual({ "app-1": { university_name: "Arden University", program_name: "MSc Project Management" } });
    expect(f.appQuery.in).toHaveBeenCalledTimes(1);
    expect(f.appQuery.in).toHaveBeenCalledWith("id", ["app-1"]);
  });

  it("does not query applications at all when no document is linked", async () => {
    const f = fakeDb([{ id: "d1", document_type: "passport", application_id: null }]);
    scopedClientMock.mockResolvedValue(f.db);
    const { GET } = await import("./route");
    const json = await (await GET(req(), params())).json();
    expect(json.data.applications).toEqual({});
    expect(f.from).not.toHaveBeenCalledWith("applications");
  });

  it("still lists every document when the application lookup fails", async () => {
    const f = fakeDb([{ id: "d1", document_type: "conditional_offer", application_id: "app-1" }], "fail");
    scopedClientMock.mockResolvedValue(f.db);
    const { GET } = await import("./route");
    const res = await GET(req(), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.documents).toHaveLength(1);
    expect(json.data.applications).toEqual({});
  });

  it("puts the new offer types in the Application category", async () => {
    const f = fakeDb([
      { id: "d1", document_type: "conditional_offer", application_id: "app-1" },
      { id: "d2", document_type: "unconditional_offer", application_id: null },
    ]);
    scopedClientMock.mockResolvedValue(f.db);
    const { GET } = await import("./route");
    const json = await (await GET(req(), params())).json();
    expect(json.data.by_category.application).toHaveLength(2);
  });
});
