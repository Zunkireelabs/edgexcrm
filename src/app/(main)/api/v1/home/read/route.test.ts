import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
const gateMock = vi.fn();
const storedMock = vi.fn();
const makeReadMock = vi.fn();
const updateMock = vi.fn();

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/industries/education-consultancy/features/home/ai/gate", () => ({ homeAiEnabled: gateMock }));
vi.mock("@/lib/supabase/queries", () => ({ getCurrentUserTenant: async () => ({ tenant: { id: "t1", name: "Admizz", timezone: "UTC", config: null } }) }));
vi.mock("@/industries/education-consultancy/features/home/server/stored-read", () => ({ loadStoredRead: storedMock }));
vi.mock("@/industries/education-consultancy/features/home/server/orca-read", () => ({
  resolveReadScope: async () => ({ scope: "me", home: { mode: "own" } }),
  buildReadFacts: async () => [{ id: "f", text: "x", href: "/home", linkLabel: "Open →" }],
  makeRead: makeReadMock,
}));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({ from: () => ({ update: (v: unknown) => (updateMock(v), { eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }) }) }),
}));

const req = (body: unknown) => new NextRequest("http://x/api/v1/home/read", { method: "POST", body: JSON.stringify(body) });
const READ = { points: [{ claim: "c", reason: "r", factIds: ["f"], link: { href: "/home", label: "Open →" } }], madeAt: "2026-11-09T01:15:00.000Z", refreshes: 0, feedback: null };

describe("POST /api/v1/home/read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "u1", tenantId: "t1", industryId: "education_consultancy" });
    gateMock.mockResolvedValue(true);
    storedMock.mockResolvedValue(null);
  });

  it("AI off: ai:false, nothing loaded or made", async () => {
    gateMock.mockResolvedValue(false);
    const { POST } = await import("./route");
    expect((await (await POST(req({}))).json()).data).toEqual({ ai: false });
    expect(makeReadMock).not.toHaveBeenCalled();
  });
  it("open with no read yet makes one (first open of the day), counted as a real open", async () => {
    makeReadMock.mockResolvedValue({ kind: "made", read: READ });
    const { POST } = await import("./route");
    const d = (await (await POST(req({ action: "open" }))).json()).data;
    expect(d.read.points).toHaveLength(1);
    expect(makeReadMock).toHaveBeenCalledWith(expect.objectContaining({ refreshes: 0, opened: true }));
  });
  it("open with a stored read does NOT call the model: it only records the open", async () => {
    storedMock.mockResolvedValue(READ);
    const { POST } = await import("./route");
    await POST(req({}));
    expect(makeReadMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ opened_at: expect.any(String) }));
  });
  it("a 4th refresh in a day is refused (429) and never calls the model", async () => {
    storedMock.mockResolvedValue({ ...READ, refreshes: 3 });
    const { POST } = await import("./route");
    const res = await POST(req({ action: "refresh" }));
    expect(res.status).toBe(429);
    expect(makeReadMock).not.toHaveBeenCalled();
  });
  it("a refresh under the limit remakes it with refreshes + 1", async () => {
    storedMock.mockResolvedValue({ ...READ, refreshes: 2 });
    makeReadMock.mockResolvedValue({ kind: "made", read: { ...READ, refreshes: 3 } });
    const { POST } = await import("./route");
    await POST(req({ action: "refresh" }));
    expect(makeReadMock).toHaveBeenCalledWith(expect.objectContaining({ refreshes: 3 }));
  });
  it("a provider failure hides the card (ai:false), never an error", async () => {
    makeReadMock.mockResolvedValue({ kind: "failed" });
    const { POST } = await import("./route");
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ ai: false });
  });
  it("over budget: paused, with today's earlier read if there is one", async () => {
    storedMock.mockResolvedValueOnce(null);
    makeReadMock.mockResolvedValue({ kind: "paused" });
    const { POST } = await import("./route");
    expect((await (await POST(req({}))).json()).data).toMatchObject({ ai: true, paused: true });
  });
  it("feedback must be 1 or -1", async () => {
    storedMock.mockResolvedValue(READ);
    const { POST } = await import("./route");
    expect((await POST(req({ action: "feedback", value: 5 }))).status).toBe(422);
    expect((await POST(req({ action: "feedback", value: -1 }))).status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ feedback: -1 }));
  });
});
