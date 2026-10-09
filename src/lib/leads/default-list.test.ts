import { describe, expect, it } from "vitest";
import { pickDefaultListForStaff, type DefaultListCandidate } from "./default-list";

const list = (id: string, sort_order: number, over: Partial<DefaultListCandidate> = {}): DefaultListCandidate => ({
  id,
  sort_order,
  is_staging: false,
  is_archive: false,
  access: { mode: "all" },
  ...over,
});

describe("pickDefaultListForStaff", () => {
  it("returns the lowest sort_order list the creator can access", () => {
    const lists = [list("qualified", 2), list("pre", 1), list("prospects", 3)];
    expect(pickDefaultListForStaff(lists, () => true)).toBe("pre");
  });

  it("never picks a staging or archive list", () => {
    const lists = [list("new", 0, { is_staging: true }), list("bin", 1, { is_archive: true }), list("pre", 2)];
    expect(pickDefaultListForStaff(lists, () => true)).toBe("pre");
  });

  it("skips lists the creator cannot access", () => {
    const lists = [list("pre", 1), list("qualified", 2)];
    expect(pickDefaultListForStaff(lists, (l) => l.id === "qualified")).toBe("qualified");
  });

  it("returns null when nothing is eligible", () => {
    expect(pickDefaultListForStaff([list("new", 0, { is_staging: true })], () => true)).toBeNull();
    expect(pickDefaultListForStaff([], () => true)).toBeNull();
  });
});
