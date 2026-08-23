import { describe, it, expect, afterEach } from "vitest";
import { applyEmailEnvGuard } from "./env-guard";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("applyEmailEnvGuard", () => {
  it("passes through untouched when EMAIL_OUTBOUND_SANDBOX=false", () => {
    process.env.EMAIL_OUTBOUND_SANDBOX = "false";
    const result = applyEmailEnvGuard("student@example.com", "Welcome");
    expect(result).toEqual({
      to: ["student@example.com"],
      intendedTo: "student@example.com",
      subject: "Welcome",
      sandboxed: false,
    });
  });

  it("redirects to EMAIL_TEST_RECIPIENTS and prefixes the subject when sandboxed", () => {
    delete process.env.EMAIL_OUTBOUND_SANDBOX; // default stays sandboxed
    process.env.EMAIL_TEST_RECIPIENTS = "test1@edgex.invalid, test2@edgex.invalid";

    const result = applyEmailEnvGuard("student@example.com", "Welcome");

    expect(result.to).toEqual(["test1@edgex.invalid", "test2@edgex.invalid"]);
    expect(result.intendedTo).toBe("student@example.com");
    expect(result.subject).toBe("[SANDBOX intended: student@example.com] Welcome");
    expect(result.sandboxed).toBe(true);
  });

  it("throws — never falls through to the real recipient — when sandboxed with no test recipients configured", () => {
    delete process.env.EMAIL_OUTBOUND_SANDBOX;
    delete process.env.EMAIL_TEST_RECIPIENTS;

    expect(() => applyEmailEnvGuard("student@example.com", "Welcome")).toThrow(/EMAIL_TEST_RECIPIENTS is empty/);
  });

  it("naive-implementation regression guard: a naive guard that silently sends to the real address instead of throwing must fail this test", () => {
    // This test exists to prove the previous test is load-bearing, not a
    // no-op — a "naive" guard (comment-only sandbox, no enforced redirect)
    // would let this call through with a real recipient. Assert the throw
    // AND that no real address ever appears in a returned `to`.
    delete process.env.EMAIL_OUTBOUND_SANDBOX;
    delete process.env.EMAIL_TEST_RECIPIENTS;

    let thrown = false;
    let result: ReturnType<typeof applyEmailEnvGuard> | undefined;
    try {
      result = applyEmailEnvGuard("real-student@example.com", "Welcome");
    } catch {
      thrown = true;
    }

    expect(thrown).toBe(true);
    expect(result).toBeUndefined();
  });
});
