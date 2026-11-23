import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
const visibleMock = vi.fn();
const patchMock = vi.fn();
const draftUpdate = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/industries/education-consultancy/features/home/server/visible-lead", () => ({ loadVisibleLead: visibleMock }));
vi.mock("@/lib/leads/apply-lead-patch", () => ({ applyLeadPatch: patchMock }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({ from: () => ({ update: (v: unknown) => (draftUpdate(v), { eq: () => ({ eq: async () => ({ error: null }) }) }) }) }),
}));

const LEAD = { id: "L1", custom_fields: { stream: "Management" }, destinations: ["Australia"], ielts_score: null, sponsor_name: null };
const req = (body: unknown) => new NextRequest("http://x/api/v1/home/note-save", { method: "POST", body: JSON.stringify(body) });
const BODY = { leadId: "L1", draftId: "d1", fields: [{ field: "ielts_score", to: "6.5" }, { field: "budget", to: "NPR 25 lakh" }], callbackAt: "2026-11-11T04:15:00.000Z", nextListId: "list-prospects" };
const ACADEMIC = { kind: "validation", errors: { academic: ["Add the student's highest qualification (%/GPA) before moving to Prospects."] } };

describe("POST /api/v1/home/note-save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "u1", tenantId: "t1", industryId: "education_consultancy" });
    visibleMock.mockResolvedValue(LEAD);
  });

  it("everything accepted: fields + call-back + stage go in ONE patch, stamped aiSuggested, and Undo is offered", async () => {
    patchMock.mockResolvedValue({ kind: "ok", lead: LEAD, changes: {}, previousValues: {} });
    const { POST } = await import("./route");
    const d = (await (await POST(req(BODY))).json()).data;
    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(patchMock.mock.calls[0][2]).toMatchObject({ ielts_score: "6.5", custom_fields: { stream: "Management", budget: "NPR 25 lakh" }, callback_due_at: "2026-11-11T04:15:00.000Z", list_id: "list-prospects" });
    expect(patchMock.mock.calls[0][3]).toMatchObject({ aiSuggested: true });
    expect(d).toMatchObject({ stageBlocked: null, undoDraftId: "d1" });
  });

  it("F1: only the stage is refused (Prospects rule): the fields and the call-back are still saved, with the reason", async () => {
    patchMock.mockResolvedValueOnce(ACADEMIC).mockResolvedValueOnce({ kind: "ok", lead: LEAD, changes: {}, previousValues: {} });
    const { POST } = await import("./route");
    const res = await POST(req(BODY));
    expect(res.status).toBe(200);
    const d = (await res.json()).data;
    expect(patchMock).toHaveBeenCalledTimes(2);
    const second = patchMock.mock.calls[1][2];
    expect(second.list_id).toBeUndefined();
    expect(second).toMatchObject({ ielts_score: "6.5", custom_fields: { budget: "NPR 25 lakh" }, callback_due_at: "2026-11-11T04:15:00.000Z" });
    expect(d.stageBlocked).toBe("Add the student's highest qualification (%/GPA) before moving to Prospects.");
    expect(d.undoDraftId).toBe("d1");
  });

  it("F1: a stage move that is merely forbidden also saves the rest", async () => {
    patchMock.mockResolvedValueOnce({ kind: "forbidden", message: "Not yours to move" }).mockResolvedValueOnce({ kind: "ok", lead: LEAD, changes: {}, previousValues: {} });
    const { POST } = await import("./route");
    const d = (await (await POST(req(BODY))).json()).data;
    expect(d.stageBlocked).toBe("Not yours to move");
  });

  it("F1: a stage-only save that is refused saves nothing and returns the reason (no second patch)", async () => {
    patchMock.mockResolvedValueOnce(ACADEMIC);
    const { POST } = await import("./route");
    const d = (await (await POST(req({ leadId: "L1", fields: [], nextListId: "list-prospects" }))).json()).data;
    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(d.stageBlocked).toContain("highest qualification");
  });

  it("an error that is NOT about the stage still fails the save (nothing is hidden)", async () => {
    patchMock.mockResolvedValueOnce({ kind: "validation", errors: { ielts_score: ["Bad value"] } });
    const { POST } = await import("./route");
    expect((await POST(req(BODY))).status).toBe(422);
  });

  it("the undo snapshot holds the BEFORE values and what was written, per ticked field only", async () => {
    patchMock.mockResolvedValue({ kind: "ok", lead: LEAD, changes: {}, previousValues: {} });
    const { POST } = await import("./route");
    await POST(req(BODY));
    const kept = draftUpdate.mock.calls[0][0].kept;
    expect(kept.undo).toEqual([
      { field: "ielts_score", kind: "column", key: "ielts_score", before: null, wrote: "6.5" },
      { field: "budget", kind: "custom", key: "budget", before: null, wrote: "NPR 25 lakh" },
    ]);
  });

  it("404 for a lead this person can't see", async () => {
    visibleMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    expect((await POST(req(BODY))).status).toBe(404);
    expect(patchMock).not.toHaveBeenCalled();
  });
});
