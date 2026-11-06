import { describe, it, expect } from "vitest";
import { sentenceCase, roleChipText } from "./menu-text";

describe("role chip text", () => {
  it("capitalises only the first letter", () => {
    expect(sentenceCase("owner")).toBe("Owner");
    expect(sentenceCase("branch manager")).toBe("Branch manager");
    expect(sentenceCase("")).toBe("");
  });
  it("does not title-case the branch", () => {
    expect(roleChipText("owner", "All branches")).toBe("Owner · All branches");
    expect(roleChipText("counselor", "All branches")).toBe("Counselor · All branches");
  });
});
