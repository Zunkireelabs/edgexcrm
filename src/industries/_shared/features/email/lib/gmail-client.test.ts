import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ConnectedEmailAccount } from "@/types/database";

interface SendArgs {
  userId: string;
  requestBody: { raw: string; threadId?: string };
}

const sendMock = vi.fn(async (args: SendArgs) => {
  void args;
  return { data: { id: "gmail-msg-1", threadId: "gmail-thread-1" } };
});

// EDGEX-128: a spy on the token refresh, so the stub-mode tests can prove it never runs.
const refreshAccessTokenMock = vi.fn(async () => ({
  credentials: { access_token: "fresh-access-token", expiry_date: 4102444800000 },
}));

vi.mock("googleapis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("googleapis")>();
  class FakeOAuth2 {
    setCredentials() {}
    refreshAccessToken() {
      return refreshAccessTokenMock();
    }
  }
  return {
    ...actual,
    google: {
      ...actual.google,
      auth: { ...actual.google.auth, OAuth2: FakeOAuth2 },
      gmail: () => ({ users: { messages: { send: sendMock } } }),
    },
  };
});

import { sendMessage } from "./gmail-client";

function decodeRaw(raw: string): string {
  const base64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

const ACCOUNT: ConnectedEmailAccount = {
  id: "acct-1",
  tenant_id: "tenant-a",
  user_id: "user-1",
  provider: "gmail",
  email: "rep@zunkireelabs.com",
  display_name: "Rep",
  refresh_token: "refresh-token",
  access_token: "access-token",
  // Far in the future so refreshAccessTokenIfNeeded() short-circuits — no OAuth network call.
  token_expiry: "2099-01-01T00:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const ORIGINAL_EMAIL_TRANSPORT = process.env.EMAIL_TRANSPORT;

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  // The MIME-shape tests below exercise the real-send path (EDGEX-128 gates it).
  process.env.EMAIL_TRANSPORT = "resend";
  sendMock.mockClear();
  refreshAccessTokenMock.mockClear();
});

afterEach(() => {
  if (ORIGINAL_EMAIL_TRANSPORT === undefined) delete process.env.EMAIL_TRANSPORT;
  else process.env.EMAIL_TRANSPORT = ORIGINAL_EMAIL_TRANSPORT;
  vi.unstubAllEnvs();
});

// Expired token: a real-send path would refresh it before calling Gmail.
const EXPIRED_ACCOUNT: ConnectedEmailAccount = { ...ACCOUNT, token_expiry: "2000-01-01T00:00:00.000Z" };

describe("sendMessage — EMAIL_TRANSPORT gate (EDGEX-128)", () => {
  it("stub: never refreshes the token or calls messages.send, returns stub_ ids and the real rfc id", async () => {
    process.env.EMAIL_TRANSPORT = "stub";

    const result = await sendMessage(EXPIRED_ACCOUNT, {
      from: "rep@zunkireelabs.com",
      to: ["lead@example.com"],
      cc: ["cc@example.com"],
      subject: "Hello",
      bodyHtml: "<p>Hi</p>",
    });

    expect(sendMock).not.toHaveBeenCalled();
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
    expect(result.gmail_message_id).toMatch(/^stub_[0-9a-f-]{36}$/);
    expect(result.gmail_thread_id).toMatch(/^stub_[0-9a-f-]{36}$/);
    expect(result.gmail_thread_id).not.toBe(result.gmail_message_id);
    expect(result.rfc_message_id).toMatch(/^<[0-9a-f-]{36}@edgex-crm\.com>$/);
    expect(result.refreshed_credentials).toBeNull();
  });

  it("stub: keeps the passed threadId so a reply stays on its thread", async () => {
    process.env.EMAIL_TRANSPORT = "stub";

    const result = await sendMessage(EXPIRED_ACCOUNT, {
      from: "rep@zunkireelabs.com",
      to: ["lead@example.com"],
      subject: "Re: Hello",
      bodyHtml: "<p>Hi</p>",
      threadId: "existing-thread-9",
    });

    expect(sendMock).not.toHaveBeenCalled();
    expect(result.gmail_thread_id).toBe("existing-thread-9");
    expect(result.gmail_message_id).toMatch(/^stub_/);
  });

  it("resend: refreshes the expired token and calls messages.send once with the real raw message", async () => {
    process.env.EMAIL_TRANSPORT = "resend";

    const result = await sendMessage(EXPIRED_ACCOUNT, {
      from: "rep@zunkireelabs.com",
      to: ["lead@example.com"],
      subject: "Hello",
      bodyHtml: "<p>Hi</p>",
      threadId: "existing-thread-9",
    });

    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const body = sendMock.mock.calls[0][0].requestBody;
    expect(body.threadId).toBe("existing-thread-9");
    const raw = decodeRaw(body.raw);
    expect(raw).toMatch(/^To: lead@example\.com/im);
    expect(raw).toMatch(/^Subject: Hello/im);
    expect(raw).toContain(`Message-ID: ${result.rfc_message_id}`);
    expect(result.gmail_message_id).toBe("gmail-msg-1");
    expect(result.gmail_thread_id).toBe("gmail-thread-1");
    expect(result.refreshed_credentials).toEqual({ access_token: "fresh-access-token", expiry_date: 4102444800000 });
  });

  it("unset + NODE_ENV=production reaches Gmail (fail-closed default only stubs outside production)", async () => {
    delete process.env.EMAIL_TRANSPORT;
    vi.stubEnv("NODE_ENV", "production");

    await sendMessage(ACCOUNT, {
      from: "rep@zunkireelabs.com",
      to: ["lead@example.com"],
      subject: "Hello",
      bodyHtml: "<p>Hi</p>",
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("unset outside production stubs (the vitest default)", async () => {
    delete process.env.EMAIL_TRANSPORT;
    vi.stubEnv("NODE_ENV", "test");

    const result = await sendMessage(ACCOUNT, {
      from: "rep@zunkireelabs.com",
      to: ["lead@example.com"],
      subject: "Hello",
      bodyHtml: "<p>Hi</p>",
    });

    expect(sendMock).not.toHaveBeenCalled();
    expect(result.gmail_message_id).toMatch(/^stub_/);
  });
});

describe("sendMessage — replyTo (inbound spine)", () => {
  it("omits Reply-To when replyTo is not passed (flag-off / unchanged default behavior)", async () => {
    await sendMessage(ACCOUNT, {
      from: "rep@zunkireelabs.com",
      to: ["lead@example.com"],
      subject: "Hello",
      bodyHtml: "<p>Hi</p>",
    });

    const raw = decodeRaw(sendMock.mock.calls[0][0].requestBody.raw);
    expect(raw).not.toMatch(/^Reply-To:/im);
  });

  it("sets the Reply-To header on the built RFC822 message when replyTo is passed", async () => {
    const replyTo = "reply+labcdef123456@inbound.edgex.zunkireelabs.com";

    await sendMessage(ACCOUNT, {
      from: "rep@zunkireelabs.com",
      to: ["lead@example.com"],
      subject: "Hello",
      bodyHtml: "<p>Hi</p>",
      replyTo,
    });

    const raw = decodeRaw(sendMock.mock.calls[0][0].requestBody.raw);
    expect(raw).toContain(`Reply-To: ${replyTo}`);
  });
});

describe("sendMessage — Bcc delivery (keepBcc)", () => {
  it("keeps the Bcc header in the built raw MIME when bcc is passed", async () => {
    await sendMessage(ACCOUNT, {
      from: "rep@zunkireelabs.com",
      to: ["lead@example.com"],
      subject: "Hello",
      bodyHtml: "<p>Hi</p>",
      bcc: ["someone@example.com"],
    });

    const raw = decodeRaw(sendMock.mock.calls[0][0].requestBody.raw);
    expect(raw).toMatch(/^Bcc: someone@example\.com/im);
  });

  it("omits the Bcc header when no bcc is passed", async () => {
    await sendMessage(ACCOUNT, {
      from: "rep@zunkireelabs.com",
      to: ["lead@example.com"],
      subject: "Hello",
      bodyHtml: "<p>Hi</p>",
    });

    const raw = decodeRaw(sendMock.mock.calls[0][0].requestBody.raw);
    expect(raw).not.toMatch(/^Bcc:/im);
  });

  it("joins multiple bcc addresses, all present in the Bcc header", async () => {
    await sendMessage(ACCOUNT, {
      from: "rep@zunkireelabs.com",
      to: ["lead@example.com"],
      subject: "Hello",
      bodyHtml: "<p>Hi</p>",
      bcc: ["one@example.com", "two@example.com"],
    });

    const raw = decodeRaw(sendMock.mock.calls[0][0].requestBody.raw);
    expect(raw).toMatch(/^Bcc: one@example\.com, two@example\.com/im);
  });

  it("does not perturb the Reply-To header when both are set", async () => {
    const replyTo = "reply+labcdef123456@inbound.edgex.zunkireelabs.com";

    await sendMessage(ACCOUNT, {
      from: "rep@zunkireelabs.com",
      to: ["lead@example.com"],
      subject: "Hello",
      bodyHtml: "<p>Hi</p>",
      bcc: ["someone@example.com"],
      replyTo,
    });

    const raw = decodeRaw(sendMock.mock.calls[0][0].requestBody.raw);
    expect(raw).toMatch(/^Bcc: someone@example\.com/im);
    expect(raw).toContain(`Reply-To: ${replyTo}`);
  });
});
