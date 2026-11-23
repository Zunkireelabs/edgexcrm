import { describe, it, expect } from "vitest";
import { statusChangeLabel, statusLabel } from "./status-label";

describe("status labels", () => {
  it("uses the tenant's label when there is one", () => expect(statusLabel("follow_up", { follow_up: "Follow-up call" })).toBe("Follow-up call"));
  it("falls back to the slug in sentence case, underscores as spaces", () => {
    expect(statusLabel("follow_up")).toBe("Follow up");
    expect(statusLabel("contacted")).toBe("Contacted");
    expect(statusLabel(null)).toBe("—");
  });
  it("maps both sides of a change", () => {
    expect(statusChangeLabel("contacted → follow_up")).toBe("Contacted → Follow up");
    expect(statusChangeLabel("new → contacted", { new: "New lead" })).toBe("New lead → Contacted");
    expect(statusChangeLabel(null)).toBeNull();
  });
});
