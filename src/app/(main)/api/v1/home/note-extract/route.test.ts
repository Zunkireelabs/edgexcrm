import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
const visibleMock = vi.fn();
const extractMock = vi.fn();
const gateMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/industries/education-consultancy/features/home/server/visible-lead", async (orig) => ({
  ...(await orig<typeof import("@/industries/education-consultancy/features/home/server/visible-lead")>()),
  loadVisibleLead: visibleMock,
}));
vi.mock("@/industries/education-consultancy/features/home/ai/gate", () => ({ homeAiEnabled: gateMock }));
vi.mock("@/industries/education-consultancy/features/home/ai/note-extract", () => ({ extractFromNote: extractMock }));
vi.mock("@/industries/education-consultancy/features/home/ai/usage", () => ({ homeOverBudget: async () => false, recordHomeUsage: async () => {} }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({
    raw: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { timezone: "UTC" } }) }) }) }) }),
    from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: { id: "draft-1" } }) }) }) }),
  }),
}));

const req = (body: unknown) => new NextRequest("http://x/api/v1/home/note-extract", { method: "POST", body: JSON.stringify(body) });

describe("POST /api/v1/home/note-extract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "u1", tenantId: "t1", industryId: "education_consultancy" });
    gateMock.mockResolvedValue(true);
  });

  it("404 for a lead this person can't see, and the model is never called", async () => {
    visibleMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(req({ leadId: "L1", note: "planning UK, IELTS 6.5" }));
    expect(res.status).toBe(404);
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("AI off: answers ai:false without calling the model", async () => {
    visibleMock.mockResolvedValue({ id: "L1", first_name: "Sita", custom_fields: null, destinations: [] });
    gateMock.mockResolvedValue(false);
    const { POST } = await import("./route");
    const res = await POST(req({ leadId: "L1", note: "planning UK, IELTS 6.5" }));
    expect((await res.json()).data).toEqual({ ai: false });
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("a provider failure answers ai:false (the plain call log), never an error", async () => {
    visibleMock.mockResolvedValue({ id: "L1", first_name: "Sita", custom_fields: null, destinations: [] });
    extractMock.mockRejectedValue(new Error("timeout"));
    const { POST } = await import("./route");
    const res = await POST(req({ leadId: "L1", note: "planning UK, IELTS 6.5" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ ai: false });
  });

  it("a note with no facts returns no proposals, and the draft row is still written", async () => {
    visibleMock.mockResolvedValue({ id: "L1", first_name: "Sita", custom_fields: null, destinations: [] });
    extractMock.mockResolvedValue({ object: { fields: [], nextStep: { kind: "none", day: null, date: null, part: null, time: null } }, usage: {} });
    const { POST } = await import("./route");
    const res = await POST(req({ leadId: "L1", note: "call busy, will try later" }));
    const d = (await res.json()).data;
    expect(d).toMatchObject({ ai: true, proposals: [], callbackAt: null });
  });
});
