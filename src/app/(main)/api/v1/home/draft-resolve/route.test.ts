import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
const visibleMock = vi.fn();
const noteMock = vi.fn();
let draftRow: unknown = null;
const updates: unknown[] = [];

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/leads/create-lead-note", () => ({ createLeadNote: noteMock }));
vi.mock("@/industries/education-consultancy/features/home/server/visible-lead", () => ({ loadVisibleLead: visibleMock }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: draftRow }) }) }) }),
      update: (v: unknown) => (updates.push(v), { eq: () => ({ eq: async () => ({ error: null }) }) }),
    }),
  }),
}));

const req = (b: unknown) => new NextRequest("http://x/api/v1/home/draft-resolve", { method: "POST", body: JSON.stringify(b) });
const DRAFT = "Hi Sita, please send your bank statement.";

describe("POST /api/v1/home/draft-resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updates.length = 0;
    authMock.mockResolvedValue({ userId: "u1", tenantId: "t1", industryId: "education_consultancy" });
    visibleMock.mockResolvedValue({ id: "L1" });
    noteMock.mockResolvedValue({ kind: "ok", note: {} });
    draftRow = { lead_id: "L1", draft_text: DRAFT, channel: "whatsapp", outcome: null };
  });

  it("'Did you send it?' No: WhatsApp was only opened. NOTHING is written to the timeline", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ draftId: "d1", action: "opened", channel: "whatsapp" }));
    expect(res.status).toBe(200);
    expect(noteMock).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ outcome: "opened" });
    expect(JSON.stringify(updates)).not.toContain("final_text");
  });
  it("Yes, WhatsApp: logs 'WhatsApp message (sent from your phone)' with the text, once", async () => {
    const { POST } = await import("./route");
    await POST(req({ draftId: "d1", action: "sent", channel: "whatsapp", finalText: DRAFT }));
    expect(noteMock).toHaveBeenCalledTimes(1);
    expect(noteMock.mock.calls[0][2]).toEqual({ content: `WhatsApp message (sent from your phone):\n${DRAFT}` });
    expect(updates[0]).toMatchObject({ outcome: "sent_as_is", final_text: DRAFT });
  });
  it("sent as is vs edited: whitespace-insensitive", async () => {
    const { POST } = await import("./route");
    await POST(req({ draftId: "d1", action: "sent", channel: "whatsapp", finalText: `  Hi Sita,\nplease send your bank statement.\n` }));
    expect(updates[0]).toMatchObject({ outcome: "sent_as_is" });
    updates.length = 0;
    await POST(req({ draftId: "d1", action: "sent", channel: "whatsapp", finalText: "Hi Sita, please send your passport." }));
    expect(updates[0]).toMatchObject({ outcome: "edited" });
  });
  it("email: /email/send already logged it, so no note is written here", async () => {
    draftRow = { lead_id: "L1", draft_text: DRAFT, channel: "email", outcome: null };
    const { POST } = await import("./route");
    await POST(req({ draftId: "d1", action: "sent", channel: "email", finalText: DRAFT }));
    expect(noteMock).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ outcome: "sent_as_is", channel: "email" });
  });
  it("closing without sending records 'discarded' and writes nothing else", async () => {
    const { POST } = await import("./route");
    await POST(req({ draftId: "d1", action: "discarded" }));
    expect(noteMock).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ outcome: "discarded" });
  });
  it("a double click on Yes never logs twice", async () => {
    draftRow = { lead_id: "L1", draft_text: DRAFT, channel: "whatsapp", outcome: "sent_as_is" };
    const { POST } = await import("./route");
    const d = (await (await POST(req({ draftId: "d1", action: "sent", channel: "whatsapp", finalText: DRAFT }))).json()).data;
    expect(d.already).toBe(true);
    expect(noteMock).not.toHaveBeenCalled();
  });
  it("404 when the draft isn't theirs; a lead they can no longer see logs nothing", async () => {
    const { POST } = await import("./route");
    draftRow = null;
    expect((await POST(req({ draftId: "d1", action: "opened" }))).status).toBe(404);
    draftRow = { lead_id: "L1", draft_text: DRAFT, channel: "whatsapp", outcome: null };
    visibleMock.mockResolvedValue(null);
    expect((await POST(req({ draftId: "d1", action: "sent", channel: "whatsapp", finalText: DRAFT }))).status).toBe(404);
    expect(noteMock).not.toHaveBeenCalled();
  });
});
