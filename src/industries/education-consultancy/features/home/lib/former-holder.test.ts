import { describe, expect, it } from "vitest";
import { decodeFilterTree } from "@/lib/filters/serialize";
import { formerHolderHref, formerHolderRow } from "./needs-you";

const base = { total: 13, byStage: [{ name: "Applications", count: 13 }], applications: 25, byHolder: [{ name: "Ravi Sah", count: 13 }], href: "/leads?x" };

describe("formerHolderRow", () => {
  it("nothing when no lead is held by a former member", () => {
    expect(formerHolderRow({ ...base, total: 0 })).toBeNull();
  });
  it("plural and singular titles", () => {
    expect(formerHolderRow(base)?.title).toBe("13 leads are held by people who left");
    expect(formerHolderRow({ ...base, total: 1 })?.title).toBe("1 lead is held by someone who left");
  });
  it("shape: warn tone, chip, one primary Reassign N link", () => {
    const r = formerHolderRow(base)!;
    expect(r).toMatchObject({ key: "former_holder", icon: "user-switch", tone: "warn", chip: { text: "Nobody working them", tone: "warn" } });
    expect(r.actions).toEqual([{ type: "link", label: "Reassign 13", href: "/leads?x", primary: true }]);
  });
  it("why: stage spread, applications, last holder", () => {
    expect(formerHolderRow(base)!.why).toBe("Applications 13 \u00B7 25 applications \u00B7 last held by Ravi Sah 13");
  });
  it("names at most 2 holders, biggest first, then 'and N more'", () => {
    const r = formerHolderRow({ ...base, byHolder: [{ name: "A", count: 1 }, { name: "B", count: 5 }, { name: "C", count: 3 }, { name: "D", count: 2 }] })!;
    expect(r.why).toContain("last held by B 5, C 3 and 2 more");
  });
  it("a user that no longer exists is 'a former team member', never Unknown or an id", () => {
    const r = formerHolderRow({ ...base, byHolder: [{ name: null, count: 13 }] })!;
    expect(r.why).toContain("last held by a former team member 13");
    expect(r.why).not.toMatch(/unknown/i);
  });
  it("one application is singular; none hides the part", () => {
    expect(formerHolderRow({ ...base, applications: 1 })!.why).toContain("1 application \u00B7");
    expect(formerHolderRow({ ...base, applications: 0 })!.why).not.toContain("application");
  });
});

describe("formerHolderHref", () => {
  it("filters to the ex-member ids AND the active lists", () => {
    const href = formerHolderHref(["u1", "u2"], ["l1"]);
    expect(href.startsWith("/leads?f=")).toBe(true);
    const res = decodeFilterTree(new URLSearchParams(href.split("?")[1]).get("f")!);
    if (!res.ok) throw new Error("did not decode");
    expect(res.tree.conditions).toEqual([
      { id: "home:former-holders", field: "assignees", op: "is_any_of", value: ["u1", "u2"] },
      { id: "home:active-lists", field: "stage", op: "is_any_of", value: ["l1"] },
    ]);
  });
});
