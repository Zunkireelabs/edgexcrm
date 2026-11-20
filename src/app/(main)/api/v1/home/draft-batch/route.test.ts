import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
const gateMock = vi.fn();
const oneMock = vi.fn();
const budgetMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/supabase/queries", () => ({ getCurrentUserTenant: async () => ({ tenant: { timezone: "UTC", name: "Admizz Education" } }) }));
vi.mock("@/lib/supabase/server", () => ({ getCachedUser: async () => ({ id: "u1", email: "x@y.com", user_metadata: { name: "Rita Karki" } }) }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: async () => ({}) }));
vi.mock("@/industries/education-consultancy/features/home/ai/gate", () => ({ homeAiEnabled: gateMock }));
vi.mock("@/industries/education-consultancy/features/home/ai/usage", () => ({ homeOverBudget: budgetMock }));
vi.mock("@/industries/education-consultancy/features/home/server/draft-batch", async (orig) => ({ ...(await orig<typeof import("@/industries/education-consultancy/features/home/server/draft-batch")>()), draftOneForBatch: oneMock }));

const req = (b: unknown) => new NextRequest("http://x/api/v1/home/draft-batch", { method: "POST", body: JSON.stringify(b) });
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ leadId: `l${i}`, kind: "going_quiet" }));

describe("POST /api/v1/home/draft-batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "u1", tenantId: "t1", industryId: "education_consultancy" });
    gateMock.mockResolvedValue(true);
    budgetMock.mockResolvedValue(false);
    oneMock.mockImplementation(async ({ entry }: { entry: { leadId: string } }) => ({ leadId: entry.leadId, draft: { id: "d", text: "Hi", subject: null, why: "w" } }));
  });
  it("12 is the limit: 12 is fine, 13 is refused before any model call", async () => {
    const { POST } = await import("./route");
    expect((await POST(req({ items: items(12) }))).status).toBe(200);
    expect(oneMock).toHaveBeenCalledTimes(12);
    oneMock.mockClear();
    expect((await POST(req({ items: items(13) }))).status).toBe(422);
    expect(oneMock).not.toHaveBeenCalled();
  });
  it("an empty list, an unknown kind or a missing lead id is refused", async () => {
    const { POST } = await import("./route");
    expect((await POST(req({ items: [] }))).status).toBe(422);
    expect((await POST(req({ items: [{ leadId: "l", kind: "new_uncalled" }] }))).status).toBe(422);
    expect((await POST(req({ items: [{ kind: "going_quiet" }] }))).status).toBe(422);
  });
  it("one message per lead: a repeated lead is drafted once", async () => {
    const { POST } = await import("./route");
    await POST(req({ items: [{ leadId: "a", kind: "going_quiet" }, { leadId: "a", kind: "reply_waiting" }, { leadId: "b", kind: "going_quiet" }] }));
    expect(oneMock).toHaveBeenCalledTimes(2);
  });
  it("a failure on one card doesn't touch the others: the failed one comes back with draft:null", async () => {
    oneMock.mockImplementation(async ({ entry }: { entry: { leadId: string } }) => (entry.leadId === "l1" ? { leadId: "l1", draft: null } : { leadId: entry.leadId, draft: { id: "d", text: "Hi", subject: null, why: "w" } }));
    const { POST } = await import("./route");
    const cards = (await (await POST(req({ items: items(3) }))).json()).data.cards;
    expect(cards.map((c: { draft: unknown }) => !!c.draft)).toEqual([true, false, true]);
  });
  it("AI off: ai:false and nothing drafted; over budget: paused with no cards", async () => {
    const { POST } = await import("./route");
    gateMock.mockResolvedValue(false);
    expect((await (await POST(req({ items: items(2) }))).json()).data).toEqual({ ai: false });
    gateMock.mockResolvedValue(true);
    budgetMock.mockResolvedValue(true);
    expect((await (await POST(req({ items: items(2) }))).json()).data).toMatchObject({ paused: true, cards: [] });
    expect(oneMock).not.toHaveBeenCalled();
  });
});
