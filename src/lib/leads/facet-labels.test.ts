import { describe, it, expect } from "vitest";
import { countSuffix, isOfferedByCount, sortByCountDesc, formerCollaboratorOptions } from "./facet-labels";

describe("facet label helpers", () => {
  const counts = new Map([["a", 1234], ["b", 0]]);

  it("prints a locale-formatted count when known, including 0 for an absent key", () => {
    expect(countSuffix(counts, "a")).toBe(" (1,234)");
    expect(countSuffix(counts, "zzz")).toBe(" (0)");
  });

  it("prints NO number when counts are unknown — never a guessed 0", () => {
    expect(countSuffix(null, "a")).toBe("");
  });

  it("hides zero-count options only when counts are known", () => {
    expect(isOfferedByCount(counts, "a")).toBe(true);
    expect(isOfferedByCount(counts, "b")).toBe(false);
    expect(isOfferedByCount(counts, "b", true)).toBe(true); // currently-selected stays
  });

  it("offers every option when counts are unknown — hiding on an unknown count would drop real people", () => {
    expect(isOfferedByCount(null, "b")).toBe(true);
  });

  it("sortByCountDesc: biggest count first, zeros/ties alphabetical, nobody dropped", () => {
    const people = [["b", "Bea"], ["a", "Al"], ["c", "Cy"], ["d", "Di"]] as const;
    const out = sortByCountDesc([...people], new Map([["c", 9], ["b", 2]]), ([id]) => id, ([, name]) => name);
    expect(out.map(([id]) => id)).toEqual(["c", "b", "a", "d"]);
  });

  it("sortByCountDesc: unknown counts keep the caller's order", () => {
    const people = [["b"], ["a"]];
    expect(sortByCountDesc(people, null, ([id]) => id, ([id]) => id)).toBe(people);
  });

  it("formerCollaboratorOptions: lists only former members the team can't name, labelled (former) with their count", () => {
    const facet = [
      { name: "team", count: 5 },
      { name: "gone", count: 2, former: true, label: "ex@example.com" },
      { name: "gone2", count: 1, former: true },
      { name: "rejoined", count: 4, former: true, label: "R" },
    ];
    const out = formerCollaboratorOptions(facet, (id) => id === "rejoined"); // rejoined is on the team again
    expect(out).toEqual([
      { value: "gone", label: "ex@example.com (former) (2)" },
      { value: "gone2", label: "Former member (former) (1)" },
    ]);
  });

  it("formerCollaboratorOptions: no facet (server gave no answer) => no extra entries", () => {
    expect(formerCollaboratorOptions(null, () => false)).toEqual([]);
  });
});
