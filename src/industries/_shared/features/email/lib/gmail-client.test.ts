import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConnectedEmailAccount } from "@/types/database";

interface SendArgs {
  userId: string;
  requestBody: { raw: string; threadId?: string };
}

const sendMock = vi.fn(async (args: SendArgs) => {
  void args;
  return { data: { id: "gmail-msg-1", threadId: "gmail-thread-1" } };
});

vi.mock("googleapis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("googleapis")>();
  return {
    ...actual,
    google: {
      ...actual.google,
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

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  sendMock.mockClear();
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
