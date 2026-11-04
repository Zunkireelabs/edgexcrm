import { describe, it, expect } from "vitest";
import { leadPatchErrorResult } from "./lead-patch-result";

describe("leadPatchErrorResult — Applications gate", () => {
  it("reads the gate message once (the structured applications_missing list is left out)", () => {
    const out = leadPatchErrorResult({
      kind: "validation",
      errors: {
        applications: ["Before moving to Applications, complete: Processing fee, Consent signed."],
        applications_missing: ["Processing fee", "Consent signed"],
      },
    });
    expect(out.error).toBe("applications: Before moving to Applications, complete: Processing fee, Consent signed.");
  });
  it("still joins ordinary validation errors as before", () => {
    const out = leadPatchErrorResult({ kind: "validation", errors: { email: ["bad"], phone: ["worse"] } });
    expect(out.error).toBe("email: bad; phone: worse");
  });
});
