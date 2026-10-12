import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const bulkEnabledMock = vi.fn();
const sendDraftMock = vi.fn();
const sendSmsMock = vi.fn();
let draftRow: Record<string, unknown> | null = null;

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: () => authMock() }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/email/outbound/flag", () => ({ isBulkEmailEnabledForTenant: (...a: unknown[]) => bulkEnabledMock(...a) }));
vi.mock("@/industries/_shared/features/outreach/lib/send-draft", () => ({ sendDraftViaEdgeX: (...a: unknown[]) => sendDraftMock(...a) }));
vi.mock("@/industries/_shared/features/outreach/lib/send-draft-sms", () => ({ sendDraftViaSms: (...a: unknown[]) => sendSmsMock(...a) }));
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
    sendSmsMock.mockReset();
    draftRow = {
      id: "d1", lead_id: "l1", subject: "s", body_html: "<p/>", status: "pending", assigned_to: "u1",
      leads: { deleted_at: null }, sequence_enrollments: { status: "active" },
    };
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

  it("409 for a deleted lead or an enrollment that is not active, without sending", async () => {
    draftRow = { ...draftRow, leads: { deleted_at: "2026-10-01T00:00:00Z" } };
    expect((await call()).status).toBe(409);
    draftRow = { ...draftRow, leads: { deleted_at: null }, sequence_enrollments: { status: "paused" } };
    expect((await call()).status).toBe(409);
    expect(sendDraftMock).not.toHaveBeenCalled();
  });

  it("409 (not a failure) when the same email is already being sent by another run", async () => {
    sendDraftMock.mockResolvedValue({ status: "in_progress" });
    const res = await call();
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toContain("already being sent");
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

  describe("text (SMS) drafts", () => {
    beforeEach(() => {
      draftRow = {
        id: "d1", lead_id: "l1", subject: "", body_html: "Hi Sita, checking in", channel: "sms", sms_message_id: null, status: "pending",
        assigned_to: "u1", leads: { deleted_at: null }, sequence_enrollments: { status: "active" },
      };
      bulkEnabledMock.mockResolvedValue(false); // email sending being off must not block a text
    });

    it("goes through the SMS sender, never the email one, and needs no subject or bulk-email grant", async () => {
      sendSmsMock.mockResolvedValue({ status: "sent", smsMessageId: "m1" });
      const res = await call();
      expect(res.status).toBe(200);
      expect((await res.json()).data).toMatchObject({ sent: true, sms_message_id: "m1" });
      expect(sendSmsMock).toHaveBeenCalledTimes(1);
      expect(sendDraftMock).not.toHaveBeenCalled();
      expect(bulkEnabledMock).not.toHaveBeenCalled();
    });

    it("an empty message is refused before anything is sent", async () => {
      draftRow = { ...draftRow, body_html: "  " };
      expect((await call()).status).toBe(422);
      expect(sendSmsMock).not.toHaveBeenCalled();
    });

    it("still honours the shared gates: 403 for another rep's draft, 409 when no longer pending or the lead's sequence is not active", async () => {
      draftRow = { ...draftRow, assigned_to: "someone-else" };
      expect((await call()).status).toBe(403);
      draftRow = { ...draftRow, assigned_to: "u1", status: "sent" };
      expect((await call()).status).toBe(409);
      draftRow = { ...draftRow, status: "pending", sequence_enrollments: { status: "paused" } };
      expect((await call()).status).toBe(409);
      expect(sendSmsMock).not.toHaveBeenCalled();
    });

    it.each([
      [{ status: "already_sent" }, 409],
      [{ status: "in_progress" }, 409],
      [{ status: "sms_disabled" }, 409],
      [{ status: "no_phone", reason: "missing" }, 422],
      [{ status: "no_credits" }, 402],
      [{ status: "already_handled", messageStatus: "failed", errorCode: "x", errorMessage: "boom" }, 409],
      [{ status: "failed", suppressed: true, errorCode: null, errorMessage: null }, 422],
      [{ status: "failed", suppressed: false, errorCode: "provider_error", errorMessage: "Provider said no" }, 422],
    ])("maps the sender result %j to HTTP %i and keeps the draft pending", async (result, status) => {
      sendSmsMock.mockResolvedValue(result);
      const res = await call();
      expect(res.status).toBe(status);
      expect((await res.json()).data?.sent).not.toBe(true);
    });

    it("tells the rep the number opted out, and not-enough-credits in plain words", async () => {
      sendSmsMock.mockResolvedValue({ status: "failed", suppressed: true, errorCode: null, errorMessage: null });
      expect((await (await call()).json()).error.code).toBe("RECIPIENT_SUPPRESSED");
      sendSmsMock.mockResolvedValue({ status: "no_credits" });
      expect((await (await call()).json()).error.code).toBe("INSUFFICIENT_SMS_CREDITS");
    });
  });
});

