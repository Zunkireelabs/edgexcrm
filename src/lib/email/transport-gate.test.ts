import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// EDGEX-125: every email goes through EMAIL_TRANSPORT. Only the provider SDKs are faked: the gate under test is the real one.
const { providerSend, webhookVerify, receivingGet, receivingForward, createTransport, smtpSend } = vi.hoisted(() => ({
  providerSend: vi.fn(),
  webhookVerify: vi.fn(),
  receivingGet: vi.fn(),
  receivingForward: vi.fn(),
  createTransport: vi.fn(),
  smtpSend: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: providerSend, receiving: { get: receivingGet, forward: receivingForward } };
    webhooks = { verify: webhookVerify };
  },
}));
vi.mock("nodemailer", () => ({ default: { createTransport } }));
vi.mock("@/lib/logger", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger: log, createRequestLogger: () => log };
});

import { getResendClient } from "./index";
import { sendBulkAssignedEmail, sendLeadAssignedEmail } from "./send-lead-assigned";
import { sendTaskAssignedEmail } from "./send-task-assigned";
import { sendInviteEmail } from "./send-invite";
import { sendGmailOAuth2Email, sendSmtpEmail } from "./smtp-sender";

const REAL = "staff@admizz.example";
const senders: Array<[string, () => Promise<{ success: boolean; messageId?: string }>]> = [
  ["lead assigned", () => sendLeadAssignedEmail({ to: REAL, assignerEmail: "a@x.test", tenantName: "T", leadId: "l1", leadName: "Sujan" })],
  ["bulk assigned", () => sendBulkAssignedEmail({ to: REAL, assignerEmail: "a@x.test", tenantName: "T", leadCount: 3 })],
  ["task assigned", () => sendTaskAssignedEmail({ to: REAL, actorEmail: "a@x.test", tenantName: "T", taskId: "t1", taskTitle: "Call", taskPath: "/tasks" })],
  ["invite", () => sendInviteEmail({ to: REAL, inviterEmail: "a@x.test", tenantName: "T", role: "viewer", token: "tok" })],
];

const smtp = { smtpEmail: "me@x.test", smtpPassword: "p", smtpHost: "smtp.x.test", smtpPort: 587, to: REAL, subject: "S", body: "<p>b</p>" };
const gmail = { email: "me@x.test", refreshToken: "r", to: REAL, subject: "S", body: "<p>b</p>" };

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("GOOGLE_CLIENT_ID", "id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  providerSend.mockReset().mockResolvedValue({ data: { id: "re_1" }, error: null });
  webhookVerify.mockReset().mockReturnValue({ type: "email.delivered" });
  receivingGet.mockReset().mockResolvedValue({ data: { id: "in_1" }, error: null });
  receivingForward.mockReset().mockResolvedValue({ data: { id: "fw_1" }, error: null });
  smtpSend.mockReset().mockResolvedValue({ messageId: "smtp_1" });
  createTransport.mockReset().mockReturnValue({ sendMail: smtpSend });
});
afterEach(() => vi.unstubAllEnvs());

describe.each(senders)("%s", (_name, send) => {
  it("stub: reports success with a stub id and never reaches the provider", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "stub");
    const r = await send();
    expect(r.success).toBe(true);
    expect(r.messageId).toMatch(/^stub_/);
    expect(providerSend).not.toHaveBeenCalled();
  });
  it("resend: calls the provider once, with the real recipient", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "resend");
    await send();
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(providerSend.mock.calls[0][0]).toMatchObject({ to: REAL });
  });
});

describe("the mode", () => {
  it("unset in production resolves to resend, so production's mail is unchanged", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "");
    vi.stubEnv("NODE_ENV", "production");
    await senders[0][1]();
    expect(providerSend).toHaveBeenCalledTimes(1);
  });
  it("unset on a laptop resolves to stub", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "");
    vi.stubEnv("NODE_ENV", "development");
    await senders[0][1]();
    expect(providerSend).not.toHaveBeenCalled();
  });
  it("is read per send: the cached client follows a change", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "stub");
    await senders[0][1]();
    vi.stubEnv("EMAIL_TRANSPORT", "resend");
    await senders[0][1]();
    expect(providerSend).toHaveBeenCalledTimes(1);
  });
});

describe("the client", () => {
  it("is still null with no API key", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(getResendClient()).toBeNull();
  });
  it("accepts a list of recipients and a text-only body under stub", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "stub");
    const r = await getResendClient()!.emails.send({ from: "a@x.test", to: ["b@x.test", "c@x.test"], subject: "S", text: "plain" });
    expect(r.data?.id).toMatch(/^stub_/);
    expect(providerSend).not.toHaveBeenCalled();
  });
  it("under stub, webhooks and inbound reads still reach the real client", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "stub");
    const client = getResendClient()!;
    const args = { payload: "{}", headers: { id: "1", timestamp: "2", signature: "3" }, webhookSecret: "s" };
    expect(client.webhooks.verify(args)).toEqual({ type: "email.delivered" });
    expect(webhookVerify).toHaveBeenCalledWith(args);
    await client.emails.receiving.get("in_1");
    expect(receivingGet).toHaveBeenCalledWith("in_1");
  });
});

describe("the inbound forward", () => {
  const forward = { emailId: "in_1", to: REAL, from: "noreply@x.test", passthrough: true as const };

  it("stub: never reaches the provider and returns the provider's success shape", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "stub");
    const r = await getResendClient()!.emails.receiving.forward(forward);
    expect(r).toMatchObject({ data: { id: expect.stringMatching(/^stub_/) }, error: null });
    expect(receivingForward).not.toHaveBeenCalled();
  });
  it("resend: calls the provider once, with the real arguments", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "resend");
    const r = await getResendClient()!.emails.receiving.forward(forward);
    expect(r.data?.id).toBe("fw_1");
    expect(receivingForward).toHaveBeenCalledTimes(1);
    expect(receivingForward).toHaveBeenCalledWith(forward);
  });
  it("unset in production reaches the provider", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "");
    vi.stubEnv("NODE_ENV", "production");
    await getResendClient()!.emails.receiving.forward(forward);
    expect(receivingForward).toHaveBeenCalledTimes(1);
  });
  it("stub: receiving.get still reaches the provider", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "stub");
    await getResendClient()!.emails.receiving.get("in_1");
    expect(receivingGet).toHaveBeenCalledWith("in_1");
  });
});

describe("SMTP and Gmail", () => {
  it("SMTP under stub opens no transport and returns the normal success shape", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "stub");
    const r = await sendSmtpEmail(smtp);
    expect(r).toEqual({ success: true, messageId: expect.stringMatching(/^stub_/) });
    expect(createTransport).not.toHaveBeenCalled();
  });
  it("Gmail under stub opens no transport and returns the normal success shape", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "stub");
    const r = await sendGmailOAuth2Email(gmail);
    expect(r).toEqual({ success: true, messageId: expect.stringMatching(/^stub_/) });
    expect(createTransport).not.toHaveBeenCalled();
  });
  it("Gmail with no Google config still says so under stub", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "stub");
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    expect(await sendGmailOAuth2Email(gmail)).toEqual({ success: false, error: "Google OAuth not configured" });
  });
  it("resend: both still send for real", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "resend");
    expect(await sendSmtpEmail(smtp)).toEqual({ success: true, messageId: "smtp_1" });
    expect(await sendGmailOAuth2Email(gmail)).toEqual({ success: true, messageId: "smtp_1" });
    expect(smtpSend).toHaveBeenCalledTimes(2);
  });
});
