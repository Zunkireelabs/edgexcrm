import { describe, it, expect, vi, beforeEach } from "vitest";

const { visibleMock, ctxMock, produceMock } = vi.hoisted(() => ({ visibleMock: vi.fn(), ctxMock: vi.fn(), produceMock: vi.fn() }));
const inserts: unknown[] = [];
const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: warnMock, info: vi.fn(), error: vi.fn() } }));

vi.mock("./visible-lead", () => ({ loadVisibleLead: visibleMock }));
vi.mock("./draft-context", () => ({ loadDraftContext: ctxMock }));
vi.mock("../ai/usage", () => ({ recordHomeUsage: async () => {} }));
vi.mock("../ai/draft", async (orig) => ({ ...(await orig<typeof import("../ai/draft")>()), produceDraft: produceMock }));

import { draftOneForBatch, mapLimit, notOnWhatsApp, skipSource } from "./draft-batch";

const db = { from: () => ({ insert: (v: unknown) => (inserts.push(v), { select: () => ({ single: async () => ({ data: { id: "d1" } }) }) }) }) } as never;
const CTX = (o: Record<string, unknown> = {}) => ({
  lead: { firstName: "Sita", fullName: "Sita Gurung", phone: "+9779841234567", email: "s@x.com", destinations: [], intakeTerm: null, fieldOfStudy: null },
  applications: [], lastCall: null, notes: [], messages: [], lastReplyChannel: null, gmail: null, recordsRead: ["Sita's record"], ...o,
});
const P = { auth: { userId: "u1", tenantId: "t1" } as never, db, entry: { leadId: "L1", kind: "going_quiet" }, counsellorFirstName: "Rita", company: "Admizz", tz: "UTC", now: new Date("2026-11-09T08:00:00Z") };
const RAW = { text: "Hi Sita, checking in.", subject: null, why: "Quiet for 9 days.", followUp: { title: "Check back", inDays: 3 } };

describe("draftOneForBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inserts.length = 0;
    visibleMock.mockResolvedValue({ id: "L1" });
    ctxMock.mockResolvedValue(CTX());
    produceMock.mockResolvedValue({ raw: RAW, usages: [{}], failed: [[]] });
  });
  it("a lead the person can't open is a not_visible card: no context loaded, no model", async () => {
    visibleMock.mockResolvedValue(null);
    const c = await draftOneForBatch(P);
    expect(c.error).toBe("not_visible");
    expect(ctxMock).not.toHaveBeenCalled();
    expect(produceMock).not.toHaveBeenCalled();
  });
  it("drafts on the channel rules, and keeps it on ai_drafts as home_batch with why + follow-up (so it can reopen)", async () => {
    const c = await draftOneForBatch(P);
    expect(c.channel).toBe("whatsapp");
    expect(c.draft).toEqual({ id: "d1", text: RAW.text, subject: null, why: RAW.why });
    expect(inserts[0]).toMatchObject({ surface: "home_batch", channel: "whatsapp", draft_text: RAW.text, proposed: { why: RAW.why, followUp: { title: "Check back" } } });
  });
  it("the reason comes from the row kind (going quiet = checking in)", async () => {
    await draftOneForBatch(P);
    expect(produceMock.mock.calls[0][0].kind).toContain("gone quiet");
  });
  it("no phone and no Gmail: a no_channel card, nothing drafted", async () => {
    ctxMock.mockResolvedValue(CTX({ lead: { ...CTX().lead, phone: null } }));
    const c = await draftOneForBatch(P);
    expect(c.error).toBe("no_channel");
    expect(produceMock).not.toHaveBeenCalled();
  });
  it("a failed check on both tries is draft:null ('write your own') and writes nothing", async () => {
    produceMock.mockResolvedValue({ raw: null, usages: [{}, {}], failed: [["pronoun"], ["pronoun"]] });
    const c = await draftOneForBatch(P);
    expect(c.draft).toBeNull();
    expect(inserts).toEqual([]);
  });
  it("P2: a check that tripped is logged by NAME at warn (no text); a first-try pass logs nothing", async () => {
    produceMock.mockResolvedValue({ raw: RAW, usages: [{}, {}], failed: [["pronoun", "length"], []] });
    await draftOneForBatch(P);
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0][0]).toEqual({ rowKind: "going_quiet", attempts: [["pronoun", "length"], []], shown: true });
    expect(JSON.stringify(warnMock.mock.calls[0])).not.toContain("Hi Sita");
    warnMock.mockClear();
    produceMock.mockResolvedValue({ raw: RAW, usages: [{}], failed: [[]] });
    await draftOneForBatch(P);
    expect(warnMock).not.toHaveBeenCalled();
  });
  it("P1: the row kind reaches the draft pipeline so check-ins get the short-and-specific rules", async () => {
    await draftOneForBatch(P);
    expect(produceMock.mock.calls[0][0].rowKind).toBe("going_quiet");
  });
  it("anything thrown is this card only: draft:null", async () => {
    ctxMock.mockRejectedValue(new Error("db"));
    expect((await draftOneForBatch(P)).draft).toBeNull();
  });
});

describe("mapLimit", () => {
  it("keeps order and never exceeds the limit", async () => {
    let live = 0, peak = 0;
    const r = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (x) => { live++; peak = Math.max(peak, live); await new Promise((ok) => setTimeout(ok, 5)); live--; return x * 2; });
    expect(r).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("Q1: 'don't send' cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inserts.length = 0;
    visibleMock.mockResolvedValue({ id: "L1" });
    ctxMock.mockResolvedValue(CTX());
    produceMock.mockResolvedValue({ raw: RAW, usages: [{}], failed: [[]] });
  });
  {
    const NOTE = { text: "Already in Korea. Number is not registered on WhatsApp.", at: "2026-09-07T05:00:00Z" };
    it("the model's skip becomes a skip card with the note's date: no draft, nothing written to ai_drafts", async () => {
      ctxMock.mockResolvedValue(CTX({ notes: [{ text: "He is already in Korea", at: "2026-09-07T05:00:00Z" }] }));
      produceMock.mockResolvedValue({ raw: { skip: { reason: "Already abroad.", quote: "already in Korea" }, text: "", subject: null, why: "", followUp: { title: "", inDays: 3 } }, usages: [{}], failed: [[]] });
      const c = await draftOneForBatch(P);
      expect(c.draft).toBeNull();
      expect(c.skip).toEqual({ reason: "Already abroad.", quote: "already in Korea", source: "note, 7 Sep" });
      expect(inserts).toEqual([]);
      expect(produceMock.mock.calls[0][0].allowSkip).toBe(true);
    });
    it("a note that says the number is not on WhatsApp skips a WhatsApp card by code: no model call", async () => {
      ctxMock.mockResolvedValue(CTX({ notes: [NOTE] }));
      const c = await draftOneForBatch(P);
      expect(produceMock).not.toHaveBeenCalled();
      expect(c.skip).toEqual({ reason: "Call or email instead.", quote: "Number is not registered on WhatsApp", source: "note, 7 Sep" });
      expect(c.draft).toBeNull();
    });
    it("notOnWhatsApp: only on the WhatsApp channel, and not when the lead has written to us on WhatsApp", () => {
      const ctx = { notes: [NOTE], lastReplyChannel: null } as never;
      expect(notOnWhatsApp(ctx, "email")).toBeNull();
      expect(notOnWhatsApp({ notes: [NOTE], lastReplyChannel: "whatsapp" } as never, "whatsapp")).toBeNull();
      expect(notOnWhatsApp(ctx, "whatsapp")?.quote).toBe("Number is not registered on WhatsApp");
      expect(notOnWhatsApp({ notes: [{ text: "Asked about WhatsApp updates", at: "2026-09-07T05:00:00Z" }], lastReplyChannel: null } as never, "whatsapp")).toBeNull();
    });
    it("skipSource names a note or a message with its date, in the tenant's zone, and never invents one", () => {
      const ctx = { notes: [{ text: "Already in Korea", at: "2026-09-07T20:00:00Z" }], messages: [{ text: "I will study in Canada", at: "2026-09-02T05:00:00Z" }] };
      expect(skipSource("already in korea", ctx, "Asia/Kathmandu")).toBe("note, 8 Sep");
      expect(skipSource("study in Canada", ctx, "UTC")).toBe("message, 2 Sep");
      expect(skipSource("nothing like it", ctx, "UTC")).toBe("note");
    });
  }
});
