import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
const visibleMock = vi.fn();
const ctxMock = vi.fn();
const writeMock = vi.fn();
const gateMock = vi.fn();
const insertMock = vi.fn();
let keptRow: unknown = null;

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
const userMock = vi.fn();
vi.mock("@/lib/supabase/queries", () => ({ getCurrentUserTenant: async () => ({ tenant: { timezone: "UTC", name: "Admizz Education" } }) }));
vi.mock("@/lib/supabase/server", () => ({ getCachedUser: userMock }));
vi.mock("@/industries/education-consultancy/features/home/server/visible-lead", () => ({ loadVisibleLead: visibleMock }));
vi.mock("@/industries/education-consultancy/features/home/server/draft-context", () => ({ loadDraftContext: ctxMock }));
vi.mock("@/industries/education-consultancy/features/home/ai/gate", () => ({ homeAiEnabled: gateMock }));
vi.mock("@/industries/education-consultancy/features/home/ai/usage", () => ({ homeOverBudget: async () => false, recordHomeUsage: async () => {} }));
vi.mock("@/industries/education-consultancy/features/home/ai/draft", async (orig) => ({ ...(await orig<typeof import("@/industries/education-consultancy/features/home/ai/draft")>()), writeDraft: writeMock }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({ from: () => ({ select: () => { const q: Record<string, unknown> = {}; for (const k of ["eq", "is", "gte", "not", "order"]) q[k] = () => q; q.limit = async () => ({ data: keptRow ? [keptRow] : [] }); return q; }, insert: (v: unknown) => (insertMock(v), { select: () => ({ single: async () => ({ data: { id: "draft-1" } }) }) }), update: () => ({ eq: () => ({ eq: async () => ({}) }) }) }) }),
}));

const CTX = (o: Record<string, unknown> = {}) => ({
  lead: { firstName: "Sita", fullName: "Sita Gurung", phone: "+9779841234567", email: "sita@x.com", destinations: ["UK"], intakeTerm: null, fieldOfStudy: null },
  applications: [{ university: "Deakin", program: "Master of IT", deadline: "2026-11-15", daysLeft: 6, stageName: "Documents", missing: ["Bank statement"], docsAssessable: true }],
  lastCall: { at: "2026-11-04T05:00:00.000Z", outcome: "no_answer" }, notes: [], messages: [], lastReplyChannel: null, gmail: { accountId: "acc", email: "rita@x.com" }, recordsRead: ["Sita's record"], ...o,
});
const OK = { raw: { text: "Hi Sita, we need your bank statement before 15 November.", subject: null, why: "The deadline is in 6 days.", followUp: { title: "Check for the statement", inDays: 3 } }, usage: {} };
const req = (b: unknown) => new NextRequest("http://x/api/v1/home/draft", { method: "POST", body: JSON.stringify(b) });
const BODY = { leadId: "L1", kind: "deadline_docs" };

describe("POST /api/v1/home/draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "u1", tenantId: "t1", industryId: "education_consultancy", email: "rita@x.com" });
    visibleMock.mockResolvedValue({ id: "L1" });
    gateMock.mockResolvedValue(true);
    ctxMock.mockResolvedValue(CTX());
    writeMock.mockResolvedValue(OK);
    keptRow = null;
    userMock.mockResolvedValue({ id: "u1", email: "admizzintern4@gmail.com", user_metadata: { name: "Rita Karki" } });
  });

  it("404 for a lead this person can't see: nothing loaded, the model never called", async () => {
    visibleMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    expect((await POST(req(BODY))).status).toBe(404);
    expect(ctxMock).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
  });
  it("AI off: ai:false, nothing drafted", async () => {
    gateMock.mockResolvedValue(false);
    const { POST } = await import("./route");
    expect((await (await POST(req(BODY))).json()).data).toEqual({ ai: false });
    expect(writeMock).not.toHaveBeenCalled();
  });
  it("an unknown row kind is refused (the model is never asked to write for an arbitrary reason)", async () => {
    const { POST } = await import("./route");
    expect((await POST(req({ leadId: "L1", kind: "new_uncalled" }))).status).toBe(422);
  });
  it("drafts when the panel opens: default WhatsApp, the draft saved on ai_drafts, records read named", async () => {
    const { POST } = await import("./route");
    const d = (await (await POST(req(BODY))).json()).data;
    expect(d.channel).toBe("whatsapp");
    expect(d.channels).toEqual(["whatsapp", "email"]);
    expect(d.draft).toMatchObject({ id: "draft-1", subject: null, followUp: { title: "Check for the statement", dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } });
    expect(d.recordsRead).toEqual(["Sita's record"]);
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ surface: "home_draft", channel: "whatsapp", draft_text: OK.raw.text }));
  });
  it("the default tab is the channel the lead last replied on", async () => {
    ctxMock.mockResolvedValue(CTX({ lastReplyChannel: "email" }));
    writeMock.mockResolvedValue({ ...OK, raw: { ...OK.raw, subject: "Your documents" } });
    const { POST } = await import("./route");
    const d = (await (await POST(req(BODY))).json()).data;
    expect(d.channel).toBe("email");
    expect(d.draft.subject).toBe("Your documents");
  });
  it("a number the facts don't hold refuses the draft (the panel says 'write your own')", async () => {
    writeMock.mockResolvedValue({ ...OK, raw: { ...OK.raw, text: "Hi Sita, your fee is 4,500." } });
    const { POST } = await import("./route");
    const d = (await (await POST(req(BODY))).json()).data;
    expect(d.draft).toBeNull();
    expect(insertMock).not.toHaveBeenCalled();
  });
  it("no phone and no Gmail: no tabs, nothing drafted, the model never called (Copy only)", async () => {
    ctxMock.mockResolvedValue(CTX({ lead: { ...CTX().lead, phone: null }, gmail: null }));
    const { POST } = await import("./route");
    const d = (await (await POST(req(BODY))).json()).data;
    expect(d).toMatchObject({ channels: [], channel: null, draft: null });
    expect(writeMock).not.toHaveBeenCalled();
  });
  it("a provider failure is a null draft, never an error", async () => {
    writeMock.mockRejectedValue(new Error("timeout"));
    const { POST } = await import("./route");
    const res = await POST(req(BODY));
    expect(res.status).toBe(200);
    expect((await res.json()).data.draft).toBeNull();
  });
  it("a different tone needs the previous text", async () => {
    const { POST } = await import("./route");
    expect((await POST(req({ ...BODY, tone: "shorter" }))).status).toBe(422);
  });

  it("S1/S3: the prompt facts carry the company's short name and the profile first name, never the email", async () => {
    const { POST } = await import("./route");
    await POST(req(BODY));
    const facts = (writeMock.mock.calls[0][0] as { facts: string[] }).facts.join("\n");
    expect(facts).toContain("Company: Admizz");
    expect(facts).toContain("Counsellor first name: Rita");
    expect(facts).not.toMatch(/admizzintern/);
  });
  it("S3: no profile name: the draft is written without a name, still never from the email", async () => {
    userMock.mockResolvedValue({ id: "u1", email: "admizzintern4@gmail.com", user_metadata: {} });
    const { POST } = await import("./route");
    await POST(req(BODY));
    const facts = (writeMock.mock.calls[0][0] as { facts: string[] }).facts.join("\n");
    expect(facts).toContain("do not sign with a name");
    expect(facts).not.toMatch(/admizzintern/);
  });
  it("S2: a draft saying 'yesterday' (no fact) is refused", async () => {
    writeMock.mockResolvedValue({ ...OK, raw: { ...OK.raw, text: "Hi Sita, I called yesterday." } });
    const { POST } = await import("./route");
    expect((await (await POST(req(BODY))).json()).data.draft).toBeNull();
  });
  it("S4/B8: a pronoun left only in the WHY after the retry is repaired, the card is kept", async () => {
    writeMock.mockResolvedValue({ ...OK, raw: { ...OK.raw, why: "Her deadline is close." } });
    const { POST } = await import("./route");
    const d = (await (await POST(req(BODY))).json()).data;
    expect(d.draft).not.toBeNull();
    expect(d.draft.why).toBe("Sita's deadline is close.");
    expect(d.draft.why).not.toMatch(/\b(he|she|his|her|hers|him)\b/i);
  });
  it("S4/B8: a pronoun in the message TEXT is still refused (never patched)", async () => {
    writeMock.mockResolvedValue({ ...OK, raw: { ...OK.raw, text: "Hi Sita, is her IELTS booked?" } });
    const { POST } = await import("./route");
    expect((await (await POST(req(BODY))).json()).data.draft).toBeNull();
  });

  it("C1: a failing first draft is retried once with the reason; the good second one is shown", async () => {
    writeMock.mockResolvedValueOnce({ ...OK, raw: { ...OK.raw, why: "Her deadline is close." } }).mockResolvedValueOnce(OK);
    const { POST } = await import("./route");
    const d = (await (await POST(req(BODY))).json()).data;
    expect(writeMock).toHaveBeenCalledTimes(2);
    expect((writeMock.mock.calls[1][0] as { fix: string[] }).fix.join(" ")).toContain("do not use he, she");
    expect(d.draft.text).toBe(OK.raw.text);
  });
  it("C1: two failures in a row is 'Write your own' (null), and never a third call", async () => {
    writeMock.mockResolvedValue({ ...OK, raw: { ...OK.raw, text: "Hi Sita, I called yesterday." } });
    const { POST } = await import("./route");
    expect((await (await POST(req(BODY))).json()).data.draft).toBeNull();
    expect(writeMock).toHaveBeenCalledTimes(2);
  });

  it("B5: an unticked 'Prepare all' draft kept within 24 h reopens from the row WITHOUT asking the model", async () => {
    keptRow = { id: "batch-1", draft_text: "Hi Sita, checking in.", channel: "whatsapp", proposed: { why: "Quiet for 9 days.", subject: null, followUp: { title: "Check back", dueDate: "2026-11-12" } } };
    const { POST } = await import("./route");
    const d = (await (await POST(req(BODY))).json()).data;
    expect(writeMock).not.toHaveBeenCalled();
    expect(d.draft).toMatchObject({ id: "batch-1", text: "Hi Sita, checking in.", why: "Quiet for 9 days.", kept: true });
  });
  it("B5: a different tone or a tab change (a draftId) always writes fresh", async () => {
    keptRow = { id: "batch-1", draft_text: "old", channel: "whatsapp", proposed: { why: "w" } };
    const { POST } = await import("./route");
    await POST(req({ ...BODY, tone: "shorter", previous: "old" }));
    expect(writeMock).toHaveBeenCalled();
  });
  it("B5: a kept draft on a channel the person can no longer use is ignored", async () => {
    keptRow = { id: "batch-1", draft_text: "old", channel: "email", proposed: { why: "w" } };
    ctxMock.mockResolvedValue(CTX({ gmail: null }));
    const { POST } = await import("./route");
    await POST(req(BODY));
    expect(writeMock).toHaveBeenCalled();
  });
});
