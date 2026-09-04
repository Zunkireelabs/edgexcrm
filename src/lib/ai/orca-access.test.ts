import { describe, it, expect } from "vitest";
import { requireOrcaAccess } from "./orca-access";

describe("requireOrcaAccess — interim owner-only Orca gate", () => {
  it("allows owner", () => {
    expect(requireOrcaAccess("owner")).toBe(true);
  });

  // The whole point of this PR: admin is NOT owner. If this test ever goes green
  // for "admin", the Orca API has silently reopened to admins — see #492.
  it.each(["admin", "counselor", "viewer"])("denies %s", (role) => {
    expect(requireOrcaAccess(role)).toBe(false);
  });

  it("denies unknown/empty roles (fail closed)", () => {
    expect(requireOrcaAccess("")).toBe(false);
    expect(requireOrcaAccess("superuser")).toBe(false);
  });
});
