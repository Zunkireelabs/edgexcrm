import { describe, it, expect, vi, beforeEach } from "vitest";

const createNotification = vi.fn();
const dispatch = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/notifications", () => ({ createNotification: (a: unknown) => createNotification(a), NotificationTypes: { CONSENT_SIGNED: "lead.consent_signed" } }));
vi.mock("@/lib/email/notify", () => ({ dispatchNotificationEmail: (...a: unknown[]) => dispatch(...a), consentSignedEvent: { id: "consent_signed" } }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.maybeSingle = () => Promise.resolve({ data: { first_name: "Aashish", last_name: "Sunuwar" } });
    return { from: () => chain };
  },
}));

import { notifyConsentSigned } from "./notify-signed";

const A = { tenantId: "t1", leadId: "lead-1", consentId: "c1", senderUserId: "u1", signerName: "A S", signedAt: "2026-11-06T10:00:00Z" };

beforeEach(() => { vi.clearAllMocks(); dispatch.mockResolvedValue({ sent: 1, failed: 0, duplicates: 0 }); });

describe("notifyConsentSigned", () => {
  it("sends the bell to the sender, linking to the lead, and the email once", async () => {
    await notifyConsentSigned(A);
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "t1", userId: "u1", type: "lead.consent_signed", link: "/leads/lead-1", message: "Aashish Sunuwar signed the consent form",
    }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][1]).toMatchObject({ consentId: "c1", senderUserId: "u1", leadId: "lead-1" });
  });

  it("does nothing when no sender was recorded", async () => {
    await notifyConsentSigned({ ...A, senderUserId: null });
    expect(createNotification).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("never throws, and still sends the email, when the bell fails", async () => {
    createNotification.mockRejectedValueOnce(new Error("db down"));
    await expect(notifyConsentSigned(A)).resolves.toBeUndefined();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("never throws when the email dispatch rejects", async () => {
    dispatch.mockRejectedValueOnce(new Error("boom"));
    await expect(notifyConsentSigned(A)).resolves.toBeUndefined();
  });
});
