import { describe, it, expect, afterEach } from "vitest";
import { isEmailOutboundEnabled, isEmailOutboundSandbox } from "./flag";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("isEmailOutboundEnabled", () => {
  it("is false by default", () => {
    delete process.env.EMAIL_OUTBOUND_ENABLED;
    expect(isEmailOutboundEnabled()).toBe(false);
  });

  it("is true only for the exact literal 'true'", () => {
    process.env.EMAIL_OUTBOUND_ENABLED = "true";
    expect(isEmailOutboundEnabled()).toBe(true);
    process.env.EMAIL_OUTBOUND_ENABLED = "1";
    expect(isEmailOutboundEnabled()).toBe(false);
  });
});

describe("isEmailOutboundSandbox", () => {
  it("defaults to sandboxed when unset", () => {
    delete process.env.EMAIL_OUTBOUND_SANDBOX;
    expect(isEmailOutboundSandbox()).toBe(true);
  });

  it("stays sandboxed for any value other than the exact literal 'false'", () => {
    process.env.EMAIL_OUTBOUND_SANDBOX = "no";
    expect(isEmailOutboundSandbox()).toBe(true);
    process.env.EMAIL_OUTBOUND_SANDBOX = "FALSE";
    expect(isEmailOutboundSandbox()).toBe(true);
  });

  it("is only disabled by the exact literal 'false'", () => {
    process.env.EMAIL_OUTBOUND_SANDBOX = "false";
    expect(isEmailOutboundSandbox()).toBe(false);
  });
});
