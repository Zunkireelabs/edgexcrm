import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendMock, resolveTenantSenderMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  resolveTenantSenderMock: vi.fn(),
}));

vi.mock("./index", () => ({
  getResendClient: () => ({ emails: { send: sendMock } }),
  EMAIL_FROM: "EdgeX <noreply@edgex.zunkireelabs.com>",
  APP_URL: "https://edgex.zunkireelabs.com",
}));

vi.mock("./sender", () => ({
  resolveTenantSender: resolveTenantSenderMock,
}));

import { sendConsentEmail } from "./send-consent";
import { sendInviteEmail } from "./send-invite";
import { sendLeadAssignedEmail } from "./send-lead-assigned";

describe("sendConsentEmail", () => {
  beforeEach(() => {
    sendMock.mockReset();
    resolveTenantSenderMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: "msg_1" }, error: null });
  });

  it("Tier 1 (unverified domain): sends from the platform address, tenant-branded, with reply-to", async () => {
    resolveTenantSenderMock.mockResolvedValue({
      from: "Admizz Education <noreply@edgex.zunkireelabs.com>",
      replyTo: "hello@admizz.com",
    });

    await sendConsentEmail({
      to: "student@example.com",
      studentName: "Jane Doe",
      tenantName: "Admizz Education",
      tenantId: "tenant-1",
      token: "tok",
      expiryDays: 7,
    });

    expect(resolveTenantSenderMock).toHaveBeenCalledWith("tenant-1");
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Admizz Education <noreply@edgex.zunkireelabs.com>",
        replyTo: "hello@admizz.com",
      })
    );
  });

  it("Tier 2 (verified domain): sends from the tenant's own address", async () => {
    resolveTenantSenderMock.mockResolvedValue({
      from: "Admizz Education <hello@admizz.com>",
      replyTo: "hello@admizz.com",
    });

    await sendConsentEmail({
      to: "student@example.com",
      studentName: "Jane Doe",
      tenantName: "Admizz Education",
      tenantId: "tenant-1",
      token: "tok",
      expiryDays: 7,
    });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Admizz Education <hello@admizz.com>",
        replyTo: "hello@admizz.com",
      })
    );
  });

  it("omits replyTo entirely when the resolver returns none", async () => {
    resolveTenantSenderMock.mockResolvedValue({
      from: "EdgeX <noreply@edgex.zunkireelabs.com>",
    });

    await sendConsentEmail({
      to: "student@example.com",
      studentName: "Jane Doe",
      tenantName: "Some Tenant",
      tenantId: "tenant-2",
      token: "tok",
      expiryDays: 7,
    });

    const call = sendMock.mock.calls[0][0];
    expect(call.from).toBe("EdgeX <noreply@edgex.zunkireelabs.com>");
    expect(call).not.toHaveProperty("replyTo");
  });
});

// Regression guard: invites and internal assignment pings are EdgeX product mail,
// not tenant-branded — they must stay on EMAIL_FROM and never route through the
// tenant sender resolver.
describe("send-invite / send-lead-assigned (regression: stay EdgeX-branded)", () => {
  beforeEach(() => {
    sendMock.mockReset();
    resolveTenantSenderMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: "msg_2" }, error: null });
  });

  it("sendInviteEmail sends from EMAIL_FROM and never calls resolveTenantSender", async () => {
    await sendInviteEmail({
      to: "newuser@example.com",
      inviterEmail: "admin@example.com",
      tenantName: "Admizz Education",
      role: "admin",
      token: "tok",
    });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: "EdgeX <noreply@edgex.zunkireelabs.com>" })
    );
    expect(resolveTenantSenderMock).not.toHaveBeenCalled();
  });

  it("sendLeadAssignedEmail sends from EMAIL_FROM and never calls resolveTenantSender", async () => {
    await sendLeadAssignedEmail({
      to: "staff@example.com",
      assignerEmail: "manager@example.com",
      tenantName: "Admizz Education",
      leadId: "lead-1",
      leadName: "John Smith",
    });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: "EdgeX <noreply@edgex.zunkireelabs.com>" })
    );
    expect(resolveTenantSenderMock).not.toHaveBeenCalled();
  });
});
