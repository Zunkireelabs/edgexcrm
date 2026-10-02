import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const bulkEnabledMock = vi.fn();
const sendDraftMock = vi.fn();
let draftRow: Record<string, unknown> | null = null;

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: () => authMock() }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/email/outbound/flag", () => ({ isBulkEmailEnabledForTenant: (...a: unknown[]) => bulkEnabledMock(...a) }));
vi.mock("@/industries/_shared/features/outreach/lib/send-draft", () => ({ sendDraftViaEdgeX: (...a: unknown[]) => sendDraftMock(...a) }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: draftRow }) }) }) }),
  }),
}));

import { POST } from "./route";
import type { NextRequest } from "next/server";

const call = () => POST({} as NextRequest, { params: Promise.resolve({ id: "d1" }) });
const education = { userId: "u1", tenantId: "t1", role: "counselor", industryId: "education_consultancy" };

describe("POST /api/v1/outreach/drafts/[id]/send", () => {
  beforeEach(() => {
    authMock.mockReset().mockResolvedValue(education);
    bulkEnabledMock.mockReset().mockResolvedValue(true);
    sendDraftMock.mockReset();
    draftRow = { id: "d1", lead_id: "l1", subject: "s", body_html: "<p/>", status: "pending", assigned_to: "u1" };
  });

  it("401 when signed out", async () => {
    authMock.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("403 for any industry other than education", async () => {
    authMock.mockResolvedValue({ ...education, industryId: "it_agency" });
    expect((await call()).status).toBe(403);
    expect(sendDraftMock).not.toHaveBeenCalled();
  });

  it("403 when a counselor sends a draft assigned to someone else", async () => {
    draftRow = { ...draftRow, assigned_to: "someone-else" };
    expect((await call()).status).toBe(403);
    expect(sendDraftMock).not.toHaveBeenCalled();
  });

  it("409 and no send when EdgeX sending is off for the tenant", async () => {
    bulkEnabledMock.mockResolvedValue(false);
    expect((await call()).status).toBe(409);
    expect(sendDraftMock).not.toHaveBeenCalled();
  });

  it("409 when the draft is no longer pending", async () => {
    draftRow = { ...draftRow, status: "sent" };
    expect((await call()).status).toBe(409);
    expect(sendDraftMock).not.toHaveBeenCalled();
  });

  it("422 and no send when the subject is blank", async () => {
    draftRow = { ...draftRow, subject: "   " };
    const res = await call();
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain("SUBJECT_REQUIRED");
    expect(sendDraftMock).not.toHaveBeenCalled();
  });

  it("200 on a real send", async () => {
    sendDraftMock.mockResolvedValue({ status: "sent", emailMessageId: "m1" });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { sent: true, email_message_id: "m1" } });
    expect(sendDraftMock.mock.calls[0][1]).toBe("t1");
  });

  it("maps no email, throttled and failed outcomes to clear errors", async () => {
    sendDraftMock.mockResolvedValueOnce({ status: "no_email" });
    expect((await call()).status).toBe(422);

    sendDraftMock.mockResolvedValueOnce({ status: "throttled" });
    expect((await call()).status).toBe(429);

    sendDraftMock.mockResolvedValueOnce({ status: "failed", suppressed: false, errorCode: "provider_error", errorMessage: "Mailbox unavailable" });
    const failed = await call();
    expect(failed.status).toBe(422);
    expect(JSON.stringify(await failed.json())).toContain("Mailbox unavailable");

    sendDraftMock.mockResolvedValueOnce({ status: "failed", suppressed: true, errorCode: null, errorMessage: null });
    const suppressed = await call();
    expect(JSON.stringify(await suppressed.json())).toContain("RECIPIENT_SUPPRESSED");
  });
});
