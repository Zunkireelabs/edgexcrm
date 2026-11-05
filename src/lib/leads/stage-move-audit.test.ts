import { describe, it, expect } from "vitest";
import { BULK_VIA, holderChange, listIdsChange } from "./stage-move-audit";

describe("listIdsChange", () => {
  it("keeps both ids", () => {
    expect(listIdsChange("a", "b")).toEqual({ old: "a", new: "b" });
  });
  it("normalises missing ids to null (a lead with no previous stage)", () => {
    expect(listIdsChange(undefined, "b")).toEqual({ old: null, new: "b" });
    expect(listIdsChange(null, null)).toEqual({ old: null, new: null });
  });
});

describe("existing helpers", () => {
  it("holderChange still records the new holder only", () => {
    expect(holderChange("u1")).toEqual({ old: null, new: "u1" });
  });
  it("BULK_VIA is the literal Pulse's SQL matches on", () => {
    expect(BULK_VIA).toBe("bulk");
  });
});
