import { describe, it, expect } from "vitest";
import { isEmail } from "./validation";

describe("isEmail", () => {
  it("returns null for a valid email address", () => {
    expect(isEmail()("sadin@example.com")).toBeNull();
  });

  it("returns an error message for an invalid email address", () => {
    expect(isEmail()("not-an-email")).toBe("Invalid email address");
  });
});
