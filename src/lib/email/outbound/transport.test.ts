import { describe, it, expect, afterEach } from "vitest";
import { getEmailTransportMode, sendStubEmail } from "./transport";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getEmailTransportMode", () => {
  it("defaults to stub when NODE_ENV is not production and EMAIL_TRANSPORT is unset", () => {
    process.env.NODE_ENV = "test";
    delete process.env.EMAIL_TRANSPORT;
    expect(getEmailTransportMode()).toBe("stub");
  });

  it("defaults to resend when NODE_ENV is production and EMAIL_TRANSPORT is unset", () => {
    process.env.NODE_ENV = "production";
    delete process.env.EMAIL_TRANSPORT;
    expect(getEmailTransportMode()).toBe("resend");
  });

  it("an explicit EMAIL_TRANSPORT=resend reaches the provider even outside production", () => {
    process.env.NODE_ENV = "development";
    process.env.EMAIL_TRANSPORT = "resend";
    expect(getEmailTransportMode()).toBe("resend");
  });

  it("an explicit EMAIL_TRANSPORT=stub stays stubbed even in production — a deliberate dry run", () => {
    process.env.NODE_ENV = "production";
    process.env.EMAIL_TRANSPORT = "stub";
    expect(getEmailTransportMode()).toBe("stub");
  });

  it("an unrecognized EMAIL_TRANSPORT value is ignored, falling back to the NODE_ENV default — fail closed, not fail open", () => {
    process.env.NODE_ENV = "test";
    process.env.EMAIL_TRANSPORT = "typo-value";
    expect(getEmailTransportMode()).toBe("stub");
  });
});

describe("sendStubEmail", () => {
  it("returns a synthetic provider id and never throws", () => {
    const result = sendStubEmail({ to: ["student@example.com"], from: "EdgeX <noreply@edgex.zunkireelabs.com>", subject: "Hi", html: "<p>hi</p>" });
    expect(result.error).toBeNull();
    expect(result.data.id).toMatch(/^stub_/);
  });

  it("produces a different id per call, even for identical input", () => {
    const payload = { to: ["a@example.com"], from: "EdgeX <noreply@edgex.zunkireelabs.com>", subject: "Hi", html: "<p>hi</p>" };
    const first = sendStubEmail(payload);
    const second = sendStubEmail(payload);
    expect(first.data.id).not.toBe(second.data.id);
  });
});
