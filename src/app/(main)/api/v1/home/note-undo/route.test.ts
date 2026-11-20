import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
const visibleMock = vi.fn();
const patchMock = vi.fn();
let draftRow: unknown = null;
const updates: unknown[] = [];

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/industries/education-consultancy/features/home/server/visible-lead", () => ({ loadVisibleLead: visibleMock }));
vi.mock("@/lib/leads/apply-lead-patch", () => ({ applyLeadPatch: patchMock }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: draftRow }) }) }) }),
      update: (v: unknown) => (updates.push(v), { eq: () => ({ eq: async () => ({ error: null }) }) }),
    }),
  }),
}));

const req = (body: unknown) => new NextRequest("http://x/api/v1/home/note-undo", { method: "POST", body: JSON.stringify(body) });
const UNDO = [
  { field: "ielts_score", kind: "column", key: "ielts_score", before: null, wrote: "6.5" },
  { field: "budget", kind: "custom", key: "budget", before: null, wrote: "NPR 25 lakh" },
];
const NOW_LEAD = { id: "L1", custom_fields: { stream: "Management", budget: "NPR 25 lakh" }, destinations: [], ielts_score: "6.5" };

describe("POST /api/v1/home/note-undo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updates.length = 0;
    authMock.mockResolvedValue({ userId: "u1", tenantId: "t1", industryId: "education_consultancy" });
    visibleMock.mockResolvedValue(NOW_LEAD);
    patchMock.mockResolvedValue({ kind: "ok", lead: NOW_LEAD, changes: {}, previousValues: {} });
    draftRow = { lead_id: "L1", kept: { undo: UNDO }, resolved_at: new Date().toISOString() };
  });

  it("restores ONLY Orca's fields, from the draft row (the client sends no values), and never the call, note or stage", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ draftId: "d1", fields: [{ field: "x", to: "evil" }] }));
    expect(res.status).toBe(200);
    expect(patchMock.mock.calls[0][2]).toEqual({ ielts_score: null, custom_fields: { stream: "Management" } });
    expect((await res.json()).data.restored.sort()).toEqual(["budget", "ielts_score"]);
  });
  it("skips a field the person edited since, and says so", async () => {
    visibleMock.mockResolvedValue({ ...NOW_LEAD, ielts_score: "7.0" });
    const { POST } = await import("./route");
    const d = (await (await POST(req({ draftId: "d1" }))).json()).data;
    expect(d.skipped).toEqual(["ielts_score"]);
    expect(patchMock.mock.calls[0][2]).toEqual({ custom_fields: { stream: "Management" } });
  });
  it("can't be undone twice, or long after", async () => {
    draftRow = { lead_id: "L1", kept: { undo: UNDO, undone_at: "2026-11-09T01:00:00.000Z" }, resolved_at: new Date().toISOString() };
    const { POST } = await import("./route");
    expect((await POST(req({ draftId: "d1" }))).status).toBe(422);
    draftRow = { lead_id: "L1", kept: { undo: UNDO }, resolved_at: new Date(Date.now() - 2 * 3_600_000).toISOString() };
    expect((await POST(req({ draftId: "d1" }))).status).toBe(422);
    expect(patchMock).not.toHaveBeenCalled();
  });
  it("404 when the draft isn't theirs or the lead isn't visible", async () => {
    const { POST } = await import("./route");
    draftRow = null;
    expect((await POST(req({ draftId: "d1" }))).status).toBe(404);
    draftRow = { lead_id: "L1", kept: { undo: UNDO }, resolved_at: new Date().toISOString() };
    visibleMock.mockResolvedValue(null);
    expect((await POST(req({ draftId: "d1" }))).status).toBe(404);
  });
});
