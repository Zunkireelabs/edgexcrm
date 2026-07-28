import { describe, it, expect, vi, beforeEach } from "vitest";

const getMock = vi.fn();
const forwardMock = vi.fn();

vi.mock("@/lib/email", () => ({
  getResendClient: vi.fn(() => resendClient),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let resendClient: any = null;

import { getResendClient } from "@/lib/email";
import { getReceivingEmail, forwardReceivingEmail } from "./resend-client";

beforeEach(() => {
  getMock.mockReset();
  forwardMock.mockReset();
  resendClient = { emails: { receiving: { get: getMock, forward: forwardMock } } };
  vi.mocked(getResendClient).mockReturnValue(resendClient);
});

describe("getReceivingEmail", () => {
  it("returns the parsed data on success", async () => {
    const data = { id: "email-1", from: "a@b.com", to: ["c@d.com"], html: "<p>hi</p>" };
    getMock.mockResolvedValue({ data, error: null });

    const result = await getReceivingEmail("email-1");

    expect(result).toBe(data);
    expect(getMock).toHaveBeenCalledWith("email-1");
  });

  it("throws when Resend returns an error", async () => {
    getMock.mockResolvedValue({ data: null, error: { message: "not found" } });
    await expect(getReceivingEmail("missing")).rejects.toThrow(/not found/);
  });

  it("throws when the Resend client is unavailable (no API key)", async () => {
    resendClient = null;
    vi.mocked(getResendClient).mockReturnValue(null);
    await expect(getReceivingEmail("email-1")).rejects.toThrow(/RESEND_API_KEY/);
  });
});

describe("forwardReceivingEmail", () => {
  it("returns true on success and forwards with passthrough:true", async () => {
    forwardMock.mockResolvedValue({ data: { id: "fwd-1" }, error: null });

    const ok = await forwardReceivingEmail({ emailId: "email-1", to: "rep@gmail.com", from: "noreply@x.com" });

    expect(ok).toBe(true);
    expect(forwardMock).toHaveBeenCalledWith({
      emailId: "email-1",
      to: "rep@gmail.com",
      from: "noreply@x.com",
      passthrough: true,
    });
  });

  it("returns false (never throws) when Resend returns an error", async () => {
    forwardMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const ok = await forwardReceivingEmail({ emailId: "email-1", to: "rep@gmail.com", from: "noreply@x.com" });
    expect(ok).toBe(false);
  });

  it("returns false (never throws) when the Resend client is unavailable", async () => {
    vi.mocked(getResendClient).mockReturnValue(null);
    const ok = await forwardReceivingEmail({ emailId: "email-1", to: "rep@gmail.com", from: "noreply@x.com" });
    expect(ok).toBe(false);
  });

  it("returns false (never throws) when the SDK call itself throws", async () => {
    forwardMock.mockRejectedValue(new Error("network error"));
    const ok = await forwardReceivingEmail({ emailId: "email-1", to: "rep@gmail.com", from: "noreply@x.com" });
    expect(ok).toBe(false);
  });
});
