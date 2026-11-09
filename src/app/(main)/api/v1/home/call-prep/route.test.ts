import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
const visibleMock = vi.fn();
const leadMock = vi.fn();
const gateMock = vi.fn();
const openingMock = vi.fn();
const restateMock = vi.fn();
const retrieveMock = vi.fn();
const budgetMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/supabase/queries", () => ({ getCurrentUserTenant: async () => ({ tenant: { timezone: "UTC", name: "Admizz Education" } }) }));
vi.mock("@/lib/supabase/server", () => ({ getCachedUser: async () => ({ id: "u1", email: "x@y.com", user_metadata: { name: "Rita Karki" } }) }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: async () => ({}) }));
vi.mock("@/lib/ai/retrieval/retrieve", () => ({ retrieve: retrieveMock }));
vi.mock("@/industries/education-consultancy/features/home/server/visible-lead", () => ({ loadVisibleLead: visibleMock }));
vi.mock("@/industries/education-consultancy/features/home/server/call-prep", async (orig) => ({ ...(await orig<typeof import("@/industries/education-consultancy/features/home/server/call-prep")>()), loadCallPrepLead: leadMock }));
vi.mock("@/industries/education-consultancy/features/home/ai/gate", () => ({ homeAiEnabled: gateMock }));
vi.mock("@/industries/education-consultancy/features/home/ai/usage", () => ({ homeOverBudget: budgetMock, recordHomeUsage: async () => {} }));
vi.mock("@/industries/education-consultancy/features/home/ai/call-prep", async (orig) => ({ ...(await orig<typeof import("@/industries/education-consultancy/features/home/ai/call-prep")>()), writeOpening: openingMock, restateKb: restateMock }));

const LEAD = {
  firstName: "Sujan", fullName: "Sujan Rai", phone: "+977 9841234412", source: "facebook ad: Nursing in Australia", createdAt: "2026-11-09T07:00:00.000Z",
  destinations: ["Australia"], intakeTerm: "February 2027", fieldOfStudy: "Bachelor of Nursing", plusTwoStream: "Science", plusTwoGpa: "3.2", bachelorGpa: null, mastersGpa: null, ieltsScore: null, customFields: { school: "Budhanilkantha" },
  record: { destinations: "Australia", intake_term: "February 2027", field_of_study: "Bachelor of Nursing", plus_two_gpa: "3.2" },
};
const req = (b: unknown) => new NextRequest("http://x/api/v1/home/call-prep", { method: "POST", body: JSON.stringify(b) });
const CHUNK = (score: number) => ({ chunkId: "c", kbItemId: "k", knowledgeBaseId: "kb", chunkIndex: 0, content: "4 partner universities take nursing students in February 2027. IELTS 7.0 is needed.", score, title: "Australia partners 2027.pdf", type: "file", url: null, createdVia: "human", page: 3 });

describe("POST /api/v1/home/call-prep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "u1", tenantId: "t1", industryId: "education_consultancy" });
    visibleMock.mockResolvedValue({ id: "L1" });
    leadMock.mockResolvedValue(LEAD);
    gateMock.mockResolvedValue(true);
    budgetMock.mockResolvedValue(false);
    openingMock.mockResolvedValue({ line: "Hi Sujan, this is Rita from Admizz. You asked about nursing in Australia for February. Have you got a few minutes?", usage: {} });
    restateMock.mockResolvedValue({ text: "4 partner universities take nursing students in February 2027.", usage: {} });
    retrieveMock.mockResolvedValue({ chunks: [CHUNK(0.03)], degraded: false });
  });

  it("404 for a lead this person can't see: nothing loaded, no model, no search", async () => {
    visibleMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    expect((await POST(req({ leadId: "L1" }))).status).toBe(404);
    expect(leadMock).not.toHaveBeenCalled();
    expect(openingMock).not.toHaveBeenCalled();
    expect(retrieveMock).not.toHaveBeenCalled();
  });
  it("AI off: ai:false", async () => {
    gateMock.mockResolvedValue(false);
    const { POST } = await import("./route");
    expect((await (await POST(req({ leadId: "L1" }))).json()).data).toEqual({ ai: false });
  });
  it("what we know and ask-about come from the record; the phone is MASKED and never whole in the response", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ leadId: "L1" }));
    const text = await res.text();
    const d = JSON.parse(text).data;
    expect(d.chips.phone).toBe("+977 98•• ••• 412");
    expect(text).not.toContain("9841234412");
    expect(d.known[0]).toEqual({ k: "Wants", v: "Bachelor of Nursing · Australia · February 2027" });
    expect(d.ask.map((a: { key: string }) => a.key)).toEqual(["english_test", "decision_maker", "budget"]);
  });
  it("the opening line and a real knowledge-base match, with the file and page", async () => {
    const { POST } = await import("./route");
    const d = (await (await POST(req({ leadId: "L1" }))).json()).data;
    expect(d.opening).toContain("Rita from Admizz");
    expect(d.kb).toEqual({ text: "4 partner universities take nursing students in February 2027.", source: "Australia partners 2027.pdf", page: 3 });
    expect(retrieveMock.mock.calls[0][2]).toBe("Bachelor of Nursing Australia");
  });
  it("D4: no knowledge-base hit shows no box (and the model is not asked to restate)", async () => {
    retrieveMock.mockResolvedValue({ chunks: [], degraded: false });
    const { POST } = await import("./route");
    const d = (await (await POST(req({ leadId: "L1" }))).json()).data;
    expect(d.kb).toBeNull();
    expect(restateMock).not.toHaveBeenCalled();
    expect(d.opening).not.toBeNull();
  });
  it("a chunk below the relevance bar (found by one search arm only) is not shown", async () => {
    retrieveMock.mockResolvedValue({ chunks: [CHUNK(1 / 61)], degraded: false });
    const { POST } = await import("./route");
    expect((await (await POST(req({ leadId: "L1" }))).json()).data.kb).toBeNull();
    expect(restateMock).not.toHaveBeenCalled();
  });
  it("a keyword-only (degraded) search never shows a box", async () => {
    retrieveMock.mockResolvedValue({ chunks: [CHUNK(0.5)], degraded: true });
    const { POST } = await import("./route");
    expect((await (await POST(req({ leadId: "L1" }))).json()).data.kb).toBeNull();
  });
  it("a restatement with a number the passage doesn't hold is dropped", async () => {
    restateMock.mockResolvedValue({ text: "9 partner universities take nursing students.", usage: {} });
    const { POST } = await import("./route");
    expect((await (await POST(req({ leadId: "L1" }))).json()).data.kb).toBeNull();
  });
  it("nothing to search for (no course, no country): no search at all", async () => {
    leadMock.mockResolvedValue({ ...LEAD, fieldOfStudy: null, destinations: [] });
    const { POST } = await import("./route");
    await POST(req({ leadId: "L1" }));
    expect(retrieveMock).not.toHaveBeenCalled();
  });
  it("an opening line saying 'yesterday' (no fact) or 'her' is dropped; the rest still shows", async () => {
    openingMock.mockResolvedValue({ line: "Hi Sujan, you enquired yesterday.", usage: {} });
    const { POST } = await import("./route");
    const d = (await (await POST(req({ leadId: "L1" }))).json()).data;
    expect(d.opening).toBeNull();
    expect(d.known.length).toBeGreaterThan(0);
  });
  it("provider failures leave those boxes out, never an error", async () => {
    openingMock.mockRejectedValue(new Error("timeout"));
    retrieveMock.mockRejectedValue(new Error("db"));
    const { POST } = await import("./route");
    const res = await POST(req({ leadId: "L1" }));
    expect(res.status).toBe(200);
    const d = (await res.json()).data;
    expect(d).toMatchObject({ opening: null, kb: null });
    expect(d.known.length).toBeGreaterThan(0);
  });
  it("over budget: paused, with the record still there and no model or search", async () => {
    budgetMock.mockResolvedValue(true);
    const { POST } = await import("./route");
    const d = (await (await POST(req({ leadId: "L1" }))).json()).data;
    expect(d).toMatchObject({ paused: true, opening: null, kb: null });
    expect(openingMock).not.toHaveBeenCalled();
    expect(retrieveMock).not.toHaveBeenCalled();
  });
});
