import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const bulkEnabledMock = vi.fn();
const updateMock = vi.fn();
let draftRow: Record<string, unknown> | null = null;

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: () => authMock() }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/email/outbound/flag", () => ({ isBulkEmailEnabledForTenant: (...a: unknown[]) => bulkEnabledMock(...a) }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: draftRow }) }) }),
      update: (patch: unknown) => ({
        eq: async (_col: string, id: string) => {
          updateMock(patch, id);
          return { error: null };
        },
      }),
    }),
  }),
}));

import { POST, DELETE } from "./route";
import type { NextRequest } from "next/server";

const education = { userId: "u1", tenantId: "t1", role: "counselor", industryId: "education_consultancy" };
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const post = (send_at?: string) =>
  POST({ json: async () => ({ send_at }) } as unknown as NextRequest, { params: Promise.resolve({ id: "d1" }) });
const del = () => DELETE({} as NextRequest, { params: Promise.resolve({ id: "d1" }) });

describe("POST /api/v1/outreach/drafts/[id]/schedule", () => {
  beforeEach(() => {
    authMock.mockReset().mockResolvedValue(education);
    bulkEnabledMock.mockReset().mockResolvedValue(true);
    updateMock.mockReset();
    draftRow = { id: "d1", subject: "Hi", status: "pending", assigned_to: "u1" };
  });

  it("401 when signed out", async () => {
    authMock.mockResolvedValue(null);
    expect((await post(inMinutes(60))).status).toBe(401);
  });

  it("403 for any industry other than education", async () => {
    authMock.mockResolvedValue({ ...education, industryId: "it_agency" });
    expect((await post(inMinutes(60))).status).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("403 when a counselor schedules someone else's draft", async () => {
    draftRow = { ...draftRow, assigned_to: "someone-else" };
    expect((await post(inMinutes(60))).status).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects a missing/invalid time, a past or too-soon time, and one more than 90 days out", async () => {
    // apiValidationError answers 422 in this API.
    expect((await post(undefined)).status).toBe(422);
    expect((await post("not a date")).status).toBe(422);
    expect((await post(inMinutes(-10))).status).toBe(422);
    expect((await post(inMinutes(2))).status).toBe(422);
    expect((await post(inMinutes(91 * 24 * 60))).status).toBe(422);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("409 when sending is off, or the draft is no longer pending", async () => {
    bulkEnabledMock.mockResolvedValue(false);
    expect((await post(inMinutes(60))).status).toBe(409);
    bulkEnabledMock.mockResolvedValue(true);
    draftRow = { ...draftRow, status: "sent" };
    expect((await post(inMinutes(60))).status).toBe(409);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("422 when the subject is blank", async () => {
    draftRow = { ...draftRow, subject: "  " };
    const res = await post(inMinutes(60));
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain("SUBJECT_REQUIRED");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("200 saves the time, who scheduled it, and clears any old error", async () => {
    const at = inMinutes(60);
    const res = await post(at);
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      { scheduled_send_at: new Date(at).toISOString(), scheduled_by: "u1", scheduled_error: null },
      "d1"
    );
  });
});

describe("DELETE /api/v1/outreach/drafts/[id]/schedule", () => {
  beforeEach(() => {
    authMock.mockReset().mockResolvedValue(education);
    updateMock.mockReset();
    draftRow = { id: "d1", subject: "Hi", status: "pending", assigned_to: "u1" };
  });

  it("clears the schedule", async () => {
    expect((await del()).status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({ scheduled_send_at: null, scheduled_by: null, scheduled_error: null }, "d1");
  });

  it("403 for a non-education industry and 409 when already sent", async () => {
    authMock.mockResolvedValue({ ...education, industryId: "it_agency" });
    expect((await del()).status).toBe(403);
    authMock.mockResolvedValue(education);
    draftRow = { ...draftRow, status: "sent" };
    expect((await del()).status).toBe(409);
  });
});
